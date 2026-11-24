// ══════════════════════════════════════════════════════════════════════════════
//  « Affaires à signaler » (console ADV) — décision du 23/11/2026
//
//  La page ne montre plus toutes les affaires à planifier : seulement celles
//  qui ont un dysfonctionnement, c'est-à-dire qui demandent une action de
//  l'ADV ou révèlent un désaccord entre Livrial et le suivi d'affaires.
//
//  Ce fichier décide, pour chaque stop ouvert (à livrer, en cours), quelles
//  anomalies il porte. Fonctions pures, sans accès à la base : ce sont elles
//  que l'on teste. La lecture en base est dans api/stops/index.js.
// ══════════════════════════════════════════════════════════════════════════════

// Ordre d'affichage : ce que l'ADV doit traiter d'abord. Le libellé est celui
// du titre de groupe ; le détail de chaque ligne est calculé plus bas.
const ANOMALIES = [
  { code: 'ADRESSE_MANQUANTE', libelle: 'Adresse de livraison manquante' },
  { code: 'NON_PLANIFIE',      libelle: 'À placer dans une tournée' },
  { code: 'DATE_DEPASSEE',     libelle: 'Date de tournée dépassée, pas livré' },
  { code: 'DATE_DIFFERENTE',   libelle: 'Date différente de celle du suivi d’affaires' },
  { code: 'PAS_FINIE',         libelle: 'Stop créé alors que l’affaire n’est pas finie dans le suivi' },
  { code: 'DOUBLON',           libelle: 'Plusieurs stops ouverts pour la même commande' },
  { code: 'ARC_INTROUVABLE',   libelle: 'Commande ARC introuvable' },
  { code: 'ANNULEE_SUIVI',     libelle: 'Annulée dans le suivi, stop encore ouvert' },
  { code: 'LIVREE_SUIVI',      libelle: 'Livrée dans le suivi, stop encore ouvert' },
  { code: 'FINIE_SANS_STOP',   libelle: 'Affaire finie sans stop' },   // commandes ARC, pas des stops
];

// Libellés du statut envoyé par le suivi d'affaires (arc_commandes.statut_suivi)
const STATUTS_SUIVI = {
  attente: 'en attente', appro: 'en appro', planifie: 'planifiée', fabrication: 'en fabrication',
  attente_solde: 'en attente de solde', fini: 'finie', livre: 'livrée', annule: 'annulée',
};

const estOuvert = s => s.statut === 'A_LIVRER' || s.statut === 'EN_COURS';

// L'adresse de facturation de l'ARC vaut adresse de livraison : seule une
// adresse absente est une anomalie (même règle que public/js/adv.js).
function adresseManquante(s) {
  const a = String(s.adresse || '').trim();
  return !a || /^adresse à compléter/i.test(a);
}

const dateFr = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

// Anomalies d'un stop ouvert : [{ code, detail }], vide si tout va bien.
//   stop        ligne de stops, avec `arc` (sa commande ARC ou null)
//   aujourdhui  AAAA-MM-JJ, heure française
//   doublons    Set des arc_reference portées par plusieurs stops ouverts
function anomaliesDuStop(stop, aujourdhui, doublons) {
  if (!estOuvert(stop)) return [];
  const arc = stop.arc || null;
  const suivi = arc ? arc.statut_suivi : null;

  // Le suivi dit que l'affaire est close : c'est LE désaccord à régler, les
  // autres remarques (date dépassée, à planifier…) n'ont plus d'objet.
  if (suivi === 'livre')  return [{ code: 'LIVREE_SUIVI',  detail: 'Le suivi d’affaires indique que l’affaire est livrée.' }];
  if (suivi === 'annule') return [{ code: 'ANNULEE_SUIVI', detail: 'Le suivi d’affaires indique que l’affaire est annulée.' }];

  const liste = [];
  const enlevement = stop.societe_livraison === 'ENLEVEMENT';

  if (!enlevement && adresseManquante(stop)) {
    liste.push({ code: 'ADRESSE_MANQUANTE', detail: 'Aucune adresse sur l’ARC : à saisir.' });
  }

  // À placer : il manque la date ; ou, pour une livraison Atrial, la tournée
  // ou la place dans la tournée (ordre 99). Un enlèvement ou un transporteur
  // daté n'a pas de place à prendre dans une tournée : rien à signaler.
  if (stop.statut === 'A_LIVRER') {
    const atrial = (stop.societe_livraison || 'ATRIAL') === 'ATRIAL';
    const manque = [];
    if (!stop.date_tournee) manque.push('date');
    if (atrial && !String(stop.tournee || '').trim()) manque.push('tournée');
    if (manque.length) liste.push({ code: 'NON_PLANIFIE', detail: `Manque : ${manque.join(' et ')}.` });
    else if (atrial && stop.ordre === 99) liste.push({ code: 'NON_PLANIFIE', detail: 'Pas encore placé dans la tournée.' });
  }

  if (stop.date_tournee && stop.date_tournee < aujourdhui) {
    liste.push({ code: 'DATE_DEPASSEE', detail: `Prévu le ${dateFr(stop.date_tournee)}.` });
  }

  if (stop.statut === 'A_LIVRER' && arc && arc.date_sortie_suivi && stop.date_tournee
      && stop.date_tournee !== arc.date_sortie_suivi) {
    liste.push({ code: 'DATE_DIFFERENTE',
      detail: `Livrial : ${dateFr(stop.date_tournee)} · suivi : ${dateFr(arc.date_sortie_suivi)}.` });
  }

  if (suivi && suivi !== 'fini') {
    liste.push({ code: 'PAS_FINIE', detail: `Affaire ${STATUTS_SUIVI[suivi] || suivi} dans le suivi.` });
  }

  if (stop.arc_reference && doublons && doublons.has(stop.arc_reference)) {
    liste.push({ code: 'DOUBLON', detail: 'Un autre stop ouvert porte la même commande.' });
  }

  if (stop.arc_reference && !arc) {
    liste.push({ code: 'ARC_INTROUVABLE', detail: `Référence « ${stop.arc_reference} » inconnue : ARC réémis sous un autre nom ?` });
  }

  return liste;
}

// Passe tous les stops ouverts en revue.
// Renvoie { stops: [stop + anomalies], compteurs: { CODE: n } } — seuls les
// stops qui ont au moins une anomalie sont gardés, rangés dans l'ordre de
// leur anomalie la plus prioritaire, puis par date.
function detecter(stops, aujourdhui) {
  const ouverts = (stops || []).filter(estOuvert);
  const vus = {};
  for (const s of ouverts) if (s.arc_reference) vus[s.arc_reference] = (vus[s.arc_reference] || 0) + 1;
  const doublons = new Set(Object.keys(vus).filter(r => vus[r] > 1));

  const rang = Object.fromEntries(ANOMALIES.map((a, i) => [a.code, i]));
  const compteurs = {};
  const gardes = [];
  for (const s of ouverts) {
    const anomalies = anomaliesDuStop(s, aujourdhui, doublons).sort((a, b) => rang[a.code] - rang[b.code]);
    if (!anomalies.length) continue;
    for (const a of anomalies) compteurs[a.code] = (compteurs[a.code] || 0) + 1;
    gardes.push({ ...s, anomalies });
  }
  gardes.sort((a, b) =>
    (rang[a.anomalies[0].code] - rang[b.anomalies[0].code])
    || String(a.date_tournee || '9999').localeCompare(String(b.date_tournee || '9999'))
    || String(a.societe || '').localeCompare(String(b.societe || ''), 'fr'));
  return { stops: gardes, compteurs };
}

module.exports = { ANOMALIES, STATUTS_SUIVI, estOuvert, adresseManquante, anomaliesDuStop, detecter };
