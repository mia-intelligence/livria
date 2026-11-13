// LIVRIAL — Planning des sorties (bêta) : classement des lignes d'ARC.
// Les règles sont dans lib/sorties-config.js ; ce fichier ne fait que les appliquer.

const CONFIG = require('./sorties-config');

// Minuscules, sans accent, espaces simples : « Châssis  FIXE » → « chassis fixe ».
function simplifier(texte) {
  return String(texte || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’`]/g, "'")
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

const REGLES = CONFIG.REGLES_DESIGNATION.map(r => ({ ...r, regex: new RegExp(r.motif) }));
// « OF2: … » ou « OF2 : … » en début de désignation
const REGEX_CODE = new RegExp('^(' + CONFIG.CODES_ARC.join('|') + ')\\s*:', 'i');

// Classe une désignation.
// Renvoie { famille, code } ; famille = 'INCONNU' si aucune règle ne correspond.
function classerDesignation(designation) {
  const brut = String(designation || '').trim();
  const avecCode = REGEX_CODE.exec(brut);
  if (avecCode) return { famille: 'MENUISERIE', code: avecCode[1].toUpperCase() };

  const texte = simplifier(brut);
  for (const r of REGLES) {
    if (r.regex.test(texte)) return { famille: r.famille, code: r.code || null };
  }
  return { famille: 'INCONNU', code: null };
}

// Vrai pour une ligne de titre « Ensemble(s) comprenant : ».
const REGEX_ENSEMBLE = /^ensemble(\(s\))?( comprenant| compose)?[ :]*$/;
function estEnsemble(designation) { return REGEX_ENSEMBLE.test(simplifier(designation)); }

// Éléments d'un ensemble, lus dans le champ « specifications » de sa ligne :
// « 1 Habillage… | 1 F: Châssis FIXE rectangulaire 582 1160 | DV Warmedge… ».
// Un élément commence par sa quantité ; les autres morceaux sont des options.
// Seules les familles de FAMILLES_COMPTEES_DANS_ENSEMBLE sont retenues.
function elementsEnsemble(article) {
  const fois = CONFIG.MULTIPLIER_PAR_ENSEMBLE ? (Number(article.quantite) || 1) : 1;
  const elements = [];
  for (const morceau of String(article.specifications || '').split('|')) {
    const m = /^\s*(\d+)\s+(\D.*)$/.exec(morceau);
    if (!m) continue;
    const c = classerDesignation(m[2]);
    if (!CONFIG.FAMILLES_COMPTEES_DANS_ENSEMBLE.includes(c.famille)) continue;
    elements.push({ quantite: Number(m[1]) * fois, designation: m[2].trim(), famille: c.famille, code: c.code });
  }
  return elements;
}

// Lignes utiles d'une commande, dans l'ordre de l'ARC : chaque ensemble est
// remplacé par ses éléments, les lignes ignorées (remises, teintes…) sont retirées.
// Renvoie [{ quantite, designation, famille, code }] ; famille 'INCONNU' = non classée.
function lignesUtiles(articles) {
  const lignes = [];
  for (const a of [...(articles || [])].sort((x, y) => (x.ligne || 0) - (y.ligne || 0))) {
    if (estEnsemble(a.designation)) { lignes.push(...elementsEnsemble(a)); continue; }
    const c = classerDesignation(a.designation);
    if (c.famille === 'IGNORE') continue;
    lignes.push({ quantite: a.quantite, designation: a.designation, famille: c.famille, code: c.code });
  }
  return lignes;
}

// Résume les lignes d'une commande.
//   articles : lignes de arc_articles (designation, quantite, ligne, specifications)
//   gamme    : arc_commandes.gamme (ALU, PVC, MIXTE ou vide)
// Renvoie { alu, pvc, autres, vr, contenu: [{ code, qte }], lignes, inconnues: [désignations] }.
function resumerCommande(articles, gamme) {
  const total = { alu: 0, pvc: 0, autres: 0, vr: 0 };
  const parCode = {};
  const inconnues = [];
  const familleMenuiserie = (gamme === 'ALU' || gamme === 'PVC' ? gamme : CONFIG.GAMME_PAR_DEFAUT).toLowerCase();

  const lignes = lignesUtiles(articles);
  for (const l of lignes) {
    if (l.famille === 'INCONNU') { inconnues.push(l.designation); continue; }
    const qte = Number(l.quantite) || 0;
    if (l.famille === 'MENUISERIE')  total[familleMenuiserie] += qte;
    else if (l.famille === 'VR')     total.vr += qte;
    else                             total.autres += qte;
    if (l.code) parCode[l.code] = (parCode[l.code] || 0) + qte;
  }

  const rang = c => { const i = CONFIG.ORDRE_CODES.indexOf(c); return i === -1 ? 999 : i; };
  const contenu = Object.keys(parCode)
    .sort((x, y) => rang(x) - rang(y) || x.localeCompare(y))
    .map(code => ({ code, qte: parCode[code] }));

  return { ...total, contenu, lignes, inconnues, gamme_incertaine: !(gamme === 'ALU' || gamme === 'PVC') };
}

// ══════════════════════════════════════════════════════════════════════════════
//  Lecture des sorties d'une période
//
//  Deux sources, une seule liste :
//    - les stops LIVRIAL (affaires finies), à leur date_tournee ;
//    - les commandes ARC sans stop (pas encore finies), à leur date_livraison_prevue.
//  Une affaire présente dans les deux n'apparaît qu'une fois : le stop l'emporte.
// ══════════════════════════════════════════════════════════════════════════════

const STOP_COLS = [
  'id', 'societe', 'numero_affaire', 'reference_client', 'arc_reference',
  'societe_livraison', 'vehicule', 'statut', 'magasin_valide', 'date_tournee', 'livre_le',
].join(',');

const ARC_COLS = [
  'reference_complete', 'numero_document', 'reference', 'type_document', 'societe',
  'gamme', 'mode_livraison', 'date_livraison_prevue', 'statut_suivi',
].join(',');

const REGEX_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Date du jour en heure française, au format AAAA-MM-JJ (le serveur tourne en UTC).
function aujourdhuiParis() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

// Clé de rapprochement par numéro d'affaire (stops créés sans commande ARC).
const cleNumero = n => String(n || '').trim().toUpperCase();

// PostgREST plafonne une réponse à 1 000 lignes : on lit par pages.
async function toutesLesLignes(construire) {
  const PAGE = 1000;
  let lignes = [];
  for (let debut = 0; ; debut += PAGE) {
    const { data, error } = await construire().range(debut, debut + PAGE - 1);
    if (error) throw error;
    lignes = lignes.concat(data || []);
    if (!data || data.length < PAGE) return lignes;
  }
}

// Lit une table par paquets de clés (une liste « in » trop longue dépasse la
// taille d'URL acceptée).
async function lireParPaquets(db, table, colonnes, colonneCle, cles, tri) {
  const PAQUET = 40;
  let lignes = [];
  for (let i = 0; i < cles.length; i += PAQUET) {
    const paquet = cles.slice(i, i + PAQUET);
    lignes = lignes.concat(await toutesLesLignes(() => {
      let q = db.from(table).select(colonnes).in(colonneCle, paquet);
      for (const t of tri) q = q.order(t, { ascending: true });
      return q;
    }));
  }
  return lignes;
}

// Mode de sortie : PL / VL (livraison ATRIAL), TRANS (transporteur), ENLEV (client).
function modeSortie(stop, arc) {
  const societe = stop ? stop.societe_livraison : (arc && arc.mode_livraison);
  if (societe === 'TRANSPORTEUR') return 'TRANS';
  if (societe === 'ENLEVEMENT')   return 'ENLEV';
  // Livraison ATRIAL : le véhicule n'est connu que sur le stop. PL par défaut,
  // comme à la création automatique du stop.
  return stop && stop.vehicule === 'VL' ? 'VL' : 'PL';
}

// Assemble la liste des sorties à partir des lignes lues en base.
// Fonction pure (aucun accès à la base) : c'est elle que l'on teste.
//   stops        stops de la période (non annulés)
//   arcsPeriode  commandes ARC dont la date prévue tombe dans la période
//   arcsStops    commandes ARC rattachées aux stops de la période
//   tousStops    tous les stops non annulés (arc_reference, numero_affaire) : dédoublonnage
//   articles     lignes arc_articles des commandes concernées
//   aujourdhui   AAAA-MM-JJ
function assemblerSorties({ stops, arcsPeriode, arcsStops, tousStops, articles, aujourdhui }) {
  const arcParRef = {};
  for (const c of [...(arcsStops || []), ...(arcsPeriode || [])]) arcParRef[c.reference_complete] = c;

  const articlesParRef = {};
  for (const a of articles || []) (articlesParRef[a.reference_complete] = articlesParRef[a.reference_complete] || []).push(a);

  const refsAvecStop     = new Set((tousStops || []).map(s => s.arc_reference).filter(Boolean));
  const affairesAvecStop = new Set((tousStops || []).map(s => cleNumero(s.numero_affaire)).filter(Boolean));

  const sorties = [];
  const nonReconnues = [];   // { affaire, designation } pour les logs
  const ecartees = [];       // statuts de suivi inconnus, pour les logs

  const construire = (stop, arc, date) => {
    const suivi = arc ? arc.statut_suivi : null;

    // Statut Production. Un stop sans commande ARC (ou non suivie) est dans
    // LIVRIAL : il est fini par définition.
    let production;
    if (suivi == null) {
      if (!stop) return;                       // commande non suivie, sans stop : non affichée
      production = 'FINI';
    } else if (Object.prototype.hasOwnProperty.call(CONFIG.STATUT_PRODUCTION, suivi)) {
      production = CONFIG.STATUT_PRODUCTION[suivi];
      if (!production) return;                 // attente, annule : non affichée
    } else {
      ecartees.push({ affaire: arc.numero_document, statut_suivi: suivi });
      return;                                  // statut inconnu : non affichée, signalée
    }

    const mode = modeSortie(stop, arc);
    const realisee = (stop && stop.statut === 'LIVRE') || suivi === CONFIG.SUIVI_SORTIE_REALISEE;

    // Statut Sortie (phases LIVRIAL)
    let sortie;
    if (realisee)                              sortie = mode === 'TRANS' || mode === 'ENLEV' ? 'ENLEVEE' : 'LIVREE';
    else if (!stop || production !== 'FINI')   sortie = 'NON_PRETE';
    else if (stop.statut === 'EN_COURS')       sortie = 'EN_LIVRAISON';
    else                                       sortie = stop.magasin_valide ? 'PRETE' : 'PREPARATION';

    // Retard (règle provisoire, voir sorties-config.js)
    const retard = !realisee && (
      date < aujourdhui
      || (date === aujourdhui && (production !== 'FINI' || CONFIG.RETARD_DES_LE_JOUR_MEME)));

    const ref = arc ? arc.reference_complete : null;
    const lignesArc = ref ? (articlesParRef[ref] || []) : [];
    const resume = resumerCommande(lignesArc, arc ? arc.gamme : null);
    const numero = (stop && stop.numero_affaire) || (arc && arc.numero_document) || '';
    for (const d of resume.inconnues) nonReconnues.push({ affaire: numero, designation: d });

    sorties.push({
      cle:           stop ? 'stop:' + stop.id : 'arc:' + ref,
      source:        stop ? 'stop' : 'arc',
      stop_id:       stop ? stop.id : null,
      arc_reference: ref,
      date,
      client:        (stop && stop.societe) || (arc && arc.societe) || '',
      chantier:      (stop && stop.reference_client) || (arc && arc.reference) || '',
      numero,
      mode,
      production,
      sortie,
      realisee,
      retard,
      // Bande verte : prête au départ en livraison ATRIAL
      prete_au_depart: production === 'FINI' && sortie === 'PRETE' && (mode === 'PL' || mode === 'VL'),
      alu: resume.alu, pvc: resume.pvc, autres: resume.autres, vr: resume.vr,
      contenu: resume.contenu,
      lignes: resume.lignes,
      // La date n'est modifiable que sur un stop pas encore sorti
      date_modifiable: !!stop && !realisee,
      livre_le: stop ? stop.livre_le : null,
    });
  };

  // 1. Les stops, à leur date de tournée
  for (const s of stops || []) {
    if (!s.date_tournee || s.statut === 'ANNULE') continue;
    construire(s, s.arc_reference ? (arcParRef[s.arc_reference] || null) : null, s.date_tournee);
  }

  // 2. Les commandes ARC sans stop, à leur date de livraison prévue
  for (const c of arcsPeriode || []) {
    if (!c.date_livraison_prevue) continue;
    if (c.type_document && c.type_document !== 'ARC') continue;        // devis
    if (!cleNumero(c.numero_document)) continue;                        // document hors sujet
    if (refsAvecStop.has(c.reference_complete)) continue;               // le stop est prioritaire
    if (affairesAvecStop.has(cleNumero(c.numero_document))) continue;   // idem, stop ancien sans clé ARC
    construire(null, c, c.date_livraison_prevue);
  }

  return { sorties, nonReconnues, ecartees };
}

// Lit en base puis assemble. from / to : AAAA-MM-JJ, bornes incluses.
async function lireSorties(db, from, to) {
  if (!REGEX_DATE.test(from || '') || !REGEX_DATE.test(to || '') || from > to) {
    const e = new Error('Paramètres from et to requis (AAAA-MM-JJ)'); e.status = 400; throw e;
  }
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > CONFIG.PERIODE_MAX_JOURS) {
    const e = new Error(`Période limitée à ${CONFIG.PERIODE_MAX_JOURS} jours`); e.status = 400; throw e;
  }

  const [stops, arcsPeriode, tousStops] = await Promise.all([
    toutesLesLignes(() => db.from('stops').select(STOP_COLS)
      .gte('date_tournee', from).lte('date_tournee', to).neq('statut', 'ANNULE').order('id')),
    toutesLesLignes(() => db.from('arc_commandes').select(ARC_COLS)
      .gte('date_livraison_prevue', from).lte('date_livraison_prevue', to)
      .not('statut_suivi', 'is', null).order('reference_complete')),
    toutesLesLignes(() => db.from('stops').select('arc_reference, numero_affaire')
      .neq('statut', 'ANNULE').order('id')),
  ]);

  // Commandes ARC des stops de la période (pour le statut Production et la gamme)
  const refsStops = [...new Set(stops.map(s => s.arc_reference).filter(Boolean))];
  const arcsStops = await lireParPaquets(db, 'arc_commandes', ARC_COLS, 'reference_complete', refsStops, ['reference_complete']);

  // Lignes d'articles de toutes les commandes concernées
  const refs = [...new Set([...refsStops, ...arcsPeriode.map(c => c.reference_complete)])];
  const articles = await lireParPaquets(db, 'arc_articles', 'reference_complete, ligne, quantite, designation, specifications',
    'reference_complete', refs, ['reference_complete', 'ligne']);

  const aujourdhui = aujourdhuiParis();
  const { sorties, nonReconnues, ecartees } = assemblerSorties({ stops, arcsPeriode, arcsStops, tousStops, articles, aujourdhui });

  // Désignations non reconnues : signalées dans les logs Vercel, jamais comptées.
  if (nonReconnues.length) {
    console.warn('[sorties] désignations non reconnues (non comptées) :',
      JSON.stringify(nonReconnues.slice(0, 50)), nonReconnues.length > 50 ? `… (${nonReconnues.length} au total)` : '');
  }
  if (ecartees.length) console.warn('[sorties] statut_suivi inconnu (affaires non affichées) :', JSON.stringify(ecartees));

  return {
    from, to, aujourdhui,
    genere_le: new Date().toISOString(),
    sorties,
    non_reconnues: nonReconnues.length,
    libelles: { production: CONFIG.LIBELLES_PRODUCTION, sortie: CONFIG.LIBELLES_SORTIE },
    legende: CONFIG.LEGENDE_CODES,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  Modification de la date de sortie (affaire qui a un stop)
//
//  On modifie stops.date_tournee, comme le bouton « Reporter » du planning
//  actuel. Chaque modification est tracée dans activity_logs.
// ══════════════════════════════════════════════════════════════════════════════

const ACTION_DATE_MODIFIEE = 'SORTIE_DATE_MODIFIEE';

function erreur(status, message) { const e = new Error(message); e.status = status; return e; }

// Vrai pour un samedi ou un dimanche. La date AAAA-MM-JJ est lue en UTC pour
// que le jour de la semaine ne dépende pas du fuseau du serveur.
function estWeekEnd(dateIso) {
  const jour = new Date(dateIso + 'T00:00:00Z').getUTCDay();
  return jour === 0 || jour === 6;
}

// Contrôles sans accès à la base (testables seuls).
function controlerNouvelleDate(stop, nouvelleDate) {
  if (!REGEX_DATE.test(nouvelleDate || '') || Number.isNaN(Date.parse(nouvelleDate + 'T00:00:00Z'))) {
    throw erreur(400, 'Date invalide (format attendu : AAAA-MM-JJ)');
  }
  if (estWeekEnd(nouvelleDate)) throw erreur(400, 'Les samedis et dimanches sont refusés.');
  if (!stop) throw erreur(404, 'Stop introuvable');
  if (stop.statut === 'LIVRE')  throw erreur(409, 'Sortie déjà réalisée : la date n’est plus modifiable.');
  if (stop.statut === 'ANNULE') throw erreur(409, 'Livraison annulée : la date n’est plus modifiable.');
  if (stop.date_tournee === nouvelleDate) throw erreur(400, 'La nouvelle date est identique à l’ancienne.');
}

// Modifie la date de sortie d'un stop et trace la modification.
// Renvoie { stop_id, ancienne_date, nouvelle_date, tracee }.
async function modifierDateSortie(db, stopId, nouvelleDate, utilisateur) {
  if (!stopId) throw erreur(400, 'stop_id requis');

  const { data: stop, error: e1 } = await db.from('stops')
    .select('id, societe, numero_affaire, statut, date_tournee').eq('id', stopId).maybeSingle();
  if (e1) throw erreur(500, e1.message);
  controlerNouvelleDate(stop, nouvelleDate);

  // .eq('statut', …) : si le stop vient d'être livré entre-temps, rien n'est modifié.
  const { data: maj, error: e2 } = await db.from('stops')
    .update({ date_tournee: nouvelleDate, updated_at: new Date().toISOString() })
    .eq('id', stopId).eq('statut', stop.statut)
    .select('id, date_tournee');
  if (e2) throw erreur(500, e2.message);
  if (!maj || !maj.length) throw erreur(409, 'Le stop a changé entre-temps : rechargez le planning.');

  // Trace : ancienne date, nouvelle date, utilisateur. La date et l'heure sont
  // posées par la base (activity_logs.created_at).
  const { error: e3 } = await db.from('activity_logs').insert({
    user_identifiant: utilisateur,
    action: ACTION_DATE_MODIFIEE,
    details: {
      stop_id: stopId, numero_affaire: stop.numero_affaire, societe: stop.societe,
      ancienne_date: stop.date_tournee, nouvelle_date: nouvelleDate, origine: 'planning_sorties',
    },
  });
  if (e3) console.error('[sorties] date modifiée mais trace non enregistrée :', stopId, e3.message);

  return { stop_id: stopId, ancienne_date: stop.date_tournee, nouvelle_date: nouvelleDate, tracee: !e3 };
}

// Historique des modifications de date d'un stop, de la plus récente à la plus ancienne.
async function historiqueDates(db, stopId) {
  if (!stopId) throw erreur(400, 'stop_id requis');
  const { data, error } = await db.from('activity_logs')
    .select('user_identifiant, details, created_at')
    .eq('action', ACTION_DATE_MODIFIEE)
    .eq('details->>stop_id', stopId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw erreur(500, error.message);
  return (data || []).map(l => ({
    le: l.created_at, par: l.user_identifiant,
    ancienne_date: l.details && l.details.ancienne_date, nouvelle_date: l.details && l.details.nouvelle_date,
  }));
}

module.exports = {
  simplifier, classerDesignation, resumerCommande,
  assemblerSorties, lireSorties, aujourdhuiParis,
  estWeekEnd, controlerNouvelleDate, modifierDateSortie, historiqueDates,
};
