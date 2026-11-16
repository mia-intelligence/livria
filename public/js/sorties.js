/* ── LIVRIAL — Planning des sorties (bêta) : vue bureau « Semaine » ───────────
   Lecture seule des données via /api/stops?sorties=1 (réservé ADV et ADMIN).
   Les règles métier (statuts, quantités, retard) sont calculées côté serveur,
   dans lib/sorties.js et lib/sorties-config.js : ici, on affiche. */

(function () {
  'use strict';

  const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
  const MOIS  = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  // Les trois bandes horizontales de la grille
  const BANDES = [
    { titre: 'LIVRAISONS ATRIAL',  sous: 'PL puis VL',                      modes: ['PL', 'VL'] },
    { titre: 'TRANSPORTEURS',      sous: 'Enlèvement par un transporteur',  modes: ['TRANS'] },
    { titre: 'ENLÈVEMENTS CLIENT', sous: 'Retrait au comptoir',             modes: ['ENLEV'] },
  ];
  const MODES = {
    PL:    { court: 'PL',     long: 'Livraison PL (camion ATRIAL)',          ordre: 1 },
    VL:    { court: 'VL',     long: 'Livraison VL (véhicule léger ATRIAL)',  ordre: 2 },
    TRANS: { court: 'TRANS.', long: 'Enlèvement par transporteur',           ordre: 3 },
    ENLEV: { court: 'ENLÈV.', long: 'Enlèvement par le client',              ordre: 4 },
  };
  // Avancement (nombre de segments allumés sur 4) et couleur de chaque statut
  const PRODUCTION = { GAGNEE: 1, APPRO: 2, FAB: 3, FINI: 4 };
  const SORTIE     = { NON_PRETE: 0, PREPARATION: 1, PRETE: 2, EN_LIVRAISON: 3, LIVREE: 4, ENLEVEE: 4 };
  const FAMILLES   = [['alu', 'ALU'], ['pvc', 'PVC'], ['autres', 'AUT.'], ['vr', 'VR']];

  let lundi = null;        // Date du lundi de la semaine affichée
  let donnees = null;      // dernière réponse de l'API
  let parCle = {};         // sorties indexées par clé, pour la fiche
  let ouverte = null;      // clé de la sortie dont la fiche est ouverte
  let dernierFocus = null; // étiquette à refocaliser à la fermeture de la fiche

  // ── Outils ────────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const deux = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + deux(d.getMonth() + 1) + '-' + deux(d.getDate());
  const depuisIso = s => { const [a, m, j] = s.split('-').map(Number); return new Date(a, m - 1, j); };
  const plusJours = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

  function lundiDe(d) {
    const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
    return r;
  }
  // Numéro de semaine ISO
  function numeroSemaine(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  }
  function dateLongue(s) {
    const d = depuisIso(s);
    const noms = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    return noms[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()] + ' ' + d.getFullYear();
  }
  const libProd   = s => (donnees.libelles.production[s.production] || s.production);
  const libSortie = s => (donnees.libelles.sortie[s.sortie] || s.sortie);
  const classeProd   = s => s.production === 'FINI' ? 'ok' : '';
  const classeSortie = s => s.sortie === 'PRETE' ? 'ok' : (s.sortie === 'EN_LIVRAISON' ? 'cours' : '');

  // ── Accès : ADV et ADMIN uniquement (l'API refuse aussi les autres rôles) ──
  async function verifierAcces() {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) { window.location.href = '/'; return false; }
      const user = await res.json();
      if (!['ADV', 'ADMIN'].includes(user.role)) { window.location.href = '/'; return false; }
      $('btn-retour').href = user.role === 'ADMIN' ? '/admin' : '/adv';
      return true;
    } catch {
      window.location.href = '/';
      return false;
    }
  }

  // ── Chargement de la semaine ──────────────────────────────────────────────
  async function charger() {
    const vendredi = plusJours(lundi, 4);
    $('periode-titre').textContent = 'Semaine ' + numeroSemaine(lundi);
    $('periode-detail').textContent = 'Du lundi ' + lundi.getDate() + (lundi.getMonth() !== vendredi.getMonth() ? ' ' + MOIS[lundi.getMonth()] : '')
      + ' au vendredi ' + vendredi.getDate() + ' ' + MOIS[vendredi.getMonth()] + ' ' + vendredi.getFullYear()
      + ' · cliquez sur une sortie pour voir sa fiche';
    try {
      const res = await fetch('/api/stops?sorties=1&from=' + iso(lundi) + '&to=' + iso(vendredi));
      if (res.status === 401 || res.status === 403) { window.location.href = '/'; return; }
      const corps = await res.json();
      if (!res.ok) throw new Error(corps.error || 'Erreur ' + res.status);
      donnees = corps;
      parCle = Object.fromEntries(donnees.sorties.map(s => [s.cle, s]));
      afficher();
      const h = new Date();
      $('maj').textContent = 'Mis à jour à ' + deux(h.getHours()) + ':' + deux(h.getMinutes());
    } catch (e) {
      $('grille').innerHTML = '<p class="so-message erreur" role="alert">Impossible de charger le planning : ' + esc(e.message) + '</p>';
      $('maj').textContent = 'Échec du chargement';
    }
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────
  function afficher() {
    const sorties = donnees.sorties;
    const dates = [0, 1, 2, 3, 4].map(i => iso(plusJours(lundi, i)));

    // Indicateurs
    const prevues   = sorties.length;
    const realisees = sorties.filter(s => s.realisee).length;
    const enCours   = sorties.filter(s => s.sortie === 'EN_LIVRAISON').length;
    const pct       = prevues ? Math.round(realisees * 100 / prevues) : 0;
    $('kpis').innerHTML =
      kpi(prevues, 'Sorties prévues', '') +
      kpi(realisees, 'Sorties réalisées', 'vert', pct + ' %') +
      kpi(enCours, 'En cours de livraison', 'bleu') +
      kpi(prevues - realisees, 'Restant à effectuer', '');

    // Ligne des jours
    let html = '<div class="so-ligne jours"><div></div>' + dates.map((d, i) => {
      const duJour = sorties.filter(s => s.date === d);
      const t = FAMILLES.map(([c]) => duJour.reduce((n, s) => n + (s[c] || 0), 0));
      const auj = d === donnees.aujourdhui;
      return '<div class="so-jour' + (auj ? ' aujourdhui' : '') + '">'
        + '<div class="so-jour-haut">' + (auj ? '<span class="so-tag">AUJOURD’HUI</span>' : '')
        + '<h2>' + JOURS[i] + ' ' + depuisIso(d).getDate() + '</h2>'
        + '<span class="nb">' + duJour.length + ' <small>' + (duJour.length > 1 ? 'sorties' : 'sortie') + '</small></span></div>'
        + '<span class="totaux">' + t[0] + ' ALU, ' + t[1] + ' PVC, ' + t[2] + ' autres, ' + t[3] + ' VR</span></div>';
    }).join('') + '</div>';

    // Les trois bandes
    html += BANDES.map(bande => {
      const deLaBande = sorties.filter(s => bande.modes.includes(s.mode));
      return '<div class="so-ligne"><div class="so-bande">'
        + '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4dbfbf" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>'
        + '<h2>' + bande.titre + '</h2><span class="sous">' + bande.sous + '</span>'
        + '<span class="nb">' + deLaBande.length + ' <small>' + (deLaBande.length > 1 ? 'sorties' : 'sortie') + '</small></span></div>'
        + dates.map(d => caseDuJour(deLaBande.filter(s => s.date === d))).join('')
        + '</div>';
    }).join('');

    $('grille').innerHTML = html;

    // Légende des codes
    const leg = donnees.legende || {};
    $('legende-codes').textContent = 'Contenu : ' + Object.keys(leg).map(c => c + ' = ' + leg[c]).join(' · ')
      + ' · le chiffre après OF, OB, PF, PE ou PS = nombre de vantaux';
  }

  function kpi(valeur, libelle, classe, extra) {
    return '<div class="so-kpi ' + classe + '"><b>' + valeur + (extra ? ' <small>' + extra + '</small>' : '') + '</b><span>' + libelle + '</span></div>';
  }

  // Une case = un jour dans une bande. Tri : PL, puis VL, puis client par
  // ordre alphabétique, puis numéro d'affaire. Le nom du client n'apparaît
  // qu'une fois, au-dessus de ses affaires.
  function caseDuJour(liste) {
    if (!liste.length) return '<div class="so-case"><span class="so-vide" aria-label="Aucune sortie">—</span></div>';
    const groupes = {};
    for (const s of liste) (groupes[s.client] = groupes[s.client] || []).push(s);
    const rangClient = nom => Math.min(...groupes[nom].map(s => MODES[s.mode].ordre));
    const noms = Object.keys(groupes).sort((a, b) => (rangClient(a) - rangClient(b)) || a.localeCompare(b, 'fr'));
    return '<div class="so-case">' + noms.map(nom => {
      const affaires = groupes[nom].sort((a, b) =>
        (MODES[a.mode].ordre - MODES[b.mode].ordre) || String(a.numero).localeCompare(String(b.numero), 'fr'));
      return '<div class="so-client"><div class="so-client-haut"><h3 title="' + esc(nom) + '">' + esc(nom || 'Client non renseigné') + '</h3>'
        + (affaires.length > 1 ? '<span>' + affaires.length + ' sorties</span>' : '') + '</div>'
        + affaires.map(etiquette).join('') + '</div>';
    }).join('') + '</div>';
  }

  function segments(n) {
    return '<span class="so-segs" aria-hidden="true">' + [0, 1, 2, 3].map(i => '<i' + (i < n ? ' class="on"' : '') + '></i>').join('') + '</span>';
  }

  function etiquette(s) {
    const classes = ['so-carte'];
    if (s.realisee) classes.push('realisee'); else if (s.retard) classes.push('retard'); else if (s.prete_au_depart) classes.push('prete');
    if (s.cle === ouverte) classes.push('ouverte');
    const contenu = s.contenu.length ? s.contenu.map(c => c.qte + ' ' + c.code).join(' · ') : 'Contenu non détaillé';
    return '<button type="button" class="' + classes.join(' ') + '" data-cle="' + esc(s.cle) + '" aria-label="Ouvrir la fiche ' + esc(s.numero) + ', ' + esc(s.chantier) + '">'
      + '<span class="so-l1"><span class="so-chantier">' + esc(s.chantier || s.numero) + '</span><span class="so-num">' + esc(s.numero) + '</span></span>'
      + '<span class="so-contenu">' + esc(contenu) + '</span>'
      + '<span class="so-l3">' + FAMILLES.map(([c, lib]) => '<span class="so-q' + (s[c] ? '' : ' zero') + '"><strong>' + (s[c] || 0) + '</strong> ' + lib + '</span>').join('')
      + '<span class="so-badges">' + (s.retard ? '<span class="so-badge">RETARD</span>' : '') + '</span></span>'
      + '<span class="so-l4">'
      + '<span class="so-statut ' + classeProd(s) + '"><span>' + esc(libProd(s)) + '</span>' + segments(PRODUCTION[s.production] || 0) + '</span>'
      + '<span class="so-statut ' + classeSortie(s) + '"><span>' + esc(libSortie(s)) + '</span>' + segments(SORTIE[s.sortie] || 0) + '</span>'
      + '<span class="so-mode">' + MODES[s.mode].court + '</span></span>'
      + '</button>';
  }

  // ── Fiche latérale ────────────────────────────────────────────────────────
  function ouvrirFiche(cle) {
    const s = parCle[cle];
    if (!s) return;
    ouverte = cle;
    dernierFocus = document.activeElement;
    document.querySelectorAll('.so-carte.ouverte').forEach(e => e.classList.remove('ouverte'));
    const carte = document.querySelector('.so-carte[data-cle="' + (window.CSS && CSS.escape ? CSS.escape(cle) : cle) + '"]');
    if (carte) carte.classList.add('ouverte');

    const total = s.alu + ' ALU · ' + s.pvc + ' PVC · ' + s.autres + ' autres · ' + s.vr + ' VR';
    const lignes = s.lignes.length
      ? s.lignes.map(l => '<div class="so-art' + (l.famille === 'INCONNU' ? ' inconnue' : '') + '"><b>' + esc(l.quantite == null ? '' : l.quantite) + '</b>'
          + '<span class="code">' + esc(l.code || (l.famille === 'INCONNU' ? 'non classé' : '')) + '</span>'
          + '<span class="lib">' + esc(l.designation) + '</span></div>').join('')
      : '<span class="so-note">Aucune ligne d’ARC rattachée à cette sortie.</span>';
    const nonClassees = s.lignes.filter(l => l.famille === 'INCONNU').length;

    $('fiche').innerHTML =
      '<div class="so-fiche-haut"><div>'
      + '<span class="client">' + esc(s.client) + '</span>'
      + '<h2 id="fiche-titre">' + esc(s.chantier || s.numero) + '</h2>'
      + '<span class="affaire">Affaire ' + esc(s.numero) + '</span></div>'
      + '<button type="button" class="so-btn fleche" id="fiche-fermer" aria-label="Fermer la fiche">×</button></div>'

      + '<section class="bloc"><h3>SORTIE</h3>'
      + '<div class="so-champ">Date de sortie prévue<b>' + esc(dateLongue(s.date)) + '</b></div>'
      + '<div class="so-champ">Mode de sortie<b>' + MODES[s.mode].long + '</b></div>'
      + (s.retard ? '<span class="so-alerte">En retard : la date de sortie est atteinte ou dépassée.</span>' : '')
      + '<div id="fiche-date">' + (s.source === 'arc'
          ? '<span class="so-note">Date modifiable une fois l’affaire dans LIVRIAL.</span>'
          : (s.realisee ? '<span class="so-note">Sortie réalisée : la date n’est plus modifiable.</span>' : ''))
      + '</div></section>'

      + '<section><h3>STATUTS</h3><div class="so-deux">'
      + '<div><span>Production</span><strong class="' + classeProd(s) + '">' + esc(libProd(s)) + '</strong></div>'
      + '<div><span>Sortie (LIVRIAL)</span><strong class="' + classeSortie(s) + '">' + esc(libSortie(s)) + '</strong></div></div>'
      + '<span class="so-note">' + (s.source === 'arc'
          ? 'Affaire pas encore dans LIVRIAL : la date vient de l’ARC.'
          : 'Affaire dans LIVRIAL : la date est celle de la tournée.') + '</span></section>'

      + '<section><h3>CONTENU DE LA COMMANDE</h3>' + lignes
      + '<span class="so-note">Total : ' + total + '</span>'
      + (nonClassees ? '<span class="so-note">' + nonClassees + (nonClassees > 1 ? ' lignes non classées ne sont pas comptées.' : ' ligne non classée n’est pas comptée.') + '</span>' : '')
      + '</section>';

    $('voile').hidden = false;
    $('fiche-fermer').addEventListener('click', fermerFiche);
    $('fiche').focus();
    if (s.date_modifiable) installerDate(s);
    if (s.source === 'stop') chargerHistorique(s);
  }

  // ── Modification de la date de sortie (affaire qui a un stop) ─────────────
  const estWeekEnd = v => { const j = depuisIso(v).getDay(); return j === 0 || j === 6; };

  function installerDate(s) {
    const zone = $('fiche-date');
    zone.innerHTML =
      '<label class="so-champ" for="date-nouvelle">Nouvelle date de sortie'
      + '<input type="date" id="date-nouvelle" value="' + esc(s.date) + '" aria-describedby="date-aide"></label>'
      + '<span class="so-note" id="date-aide">Les samedis et dimanches sont refusés.</span>'
      + '<span class="so-alerte" id="date-erreur" role="alert"></span>'
      + '<div id="date-confirm"></div>'
      + '<button type="button" class="so-primaire" id="date-enregistrer">Modifier la date</button>';

    const champ = $('date-nouvelle'), err = $('date-erreur'), conf = $('date-confirm'), bouton = $('date-enregistrer');
    const annuler = () => { conf.innerHTML = ''; bouton.hidden = false; };
    champ.addEventListener('input', () => { err.textContent = ''; annuler(); });

    // 1er clic : contrôle, puis demande de confirmation (ancienne et nouvelle date)
    bouton.addEventListener('click', () => {
      const v = champ.value;
      err.textContent = '';
      if (!v)             { err.textContent = 'Choisissez une date.'; return; }
      if (v === s.date)   { err.textContent = 'La nouvelle date est identique à l’ancienne.'; return; }
      if (estWeekEnd(v))  { err.textContent = 'Les samedis et dimanches sont refusés.'; return; }
      bouton.hidden = true;
      conf.innerHTML = '<div class="so-confirm"><span>Confirmer le changement de date ?<br>Ancienne date : <strong>' + esc(dateLongue(s.date))
        + '</strong><br>Nouvelle date : <strong>' + esc(dateLongue(v)) + '</strong><br>La modification sera enregistrée dans l’historique avec votre nom.</span>'
        + '<div><button type="button" class="so-primaire" id="date-oui">Confirmer</button>'
        + '<button type="button" class="so-btn" id="date-non">Annuler</button></div></div>';
      $('date-non').addEventListener('click', () => { annuler(); bouton.focus(); });
      $('date-oui').addEventListener('click', () => enregistrerDate(s, v));
      $('date-oui').focus();
    });
  }

  // 2e clic : enregistrement. Le serveur refait tous les contrôles.
  async function enregistrerDate(s, nouvelle) {
    const oui = $('date-oui'), err = $('date-erreur');
    oui.disabled = true; oui.textContent = 'Enregistrement…';
    try {
      const res = await fetch('/api/stops?sorties=date', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stop_id: s.stop_id, date: nouvelle }),
      });
      if (res.status === 401) { window.location.href = '/'; return; }
      const corps = await res.json();
      if (!res.ok) throw new Error(corps.error || 'Erreur ' + res.status);
      const cle = s.cle;
      await charger();                       // la sortie change de colonne (ou sort de la semaine)
      if (parCle[cle]) ouvrirFiche(cle); else fermerFiche();
      annoncer('Date de sortie modifiée : ' + dateLongue(nouvelle) + '.'
        + (corps.tracee ? '' : ' Attention : la trace n’a pas pu être enregistrée.'));
    } catch (e) {
      $('date-confirm').innerHTML = '';
      $('date-enregistrer').hidden = false;
      err.textContent = 'Date non modifiée : ' + e.message;
    }
  }

  // Message de confirmation, lu aussi par les lecteurs d'écran
  function annoncer(texte) {
    const zone = $('annonce');
    zone.textContent = texte;
    zone.hidden = false;
    clearTimeout(annoncer.minuteur);
    annoncer.minuteur = setTimeout(() => { zone.hidden = true; }, 6000);
  }

  // Historique des modifications de date (lu dans activity_logs)
  async function chargerHistorique(s) {
    const bloc = document.createElement('section');
    bloc.innerHTML = '<h3>HISTORIQUE DES DATES</h3><span class="so-note">Chargement…</span>';
    $('fiche').appendChild(bloc);
    try {
      const res = await fetch('/api/stops?sorties=historique&stop_id=' + encodeURIComponent(s.stop_id));
      const lignes = await res.json();
      if (!res.ok) throw new Error(lignes.error || 'Erreur ' + res.status);
      if (ouverte !== s.cle) return;         // la fiche a changé entre-temps
      const jour = v => v ? depuisIso(v).toLocaleDateString('fr-FR') : 'sans date';
      bloc.innerHTML = '<h3>HISTORIQUE DES DATES</h3>' + (lignes.length
        ? lignes.map(l => { const d = new Date(l.le);
            return '<span class="so-histo">' + esc(d.toLocaleDateString('fr-FR')) + ' · ' + deux(d.getHours()) + ':' + deux(d.getMinutes())
              + ' · ' + esc(l.par || 'inconnu') + ' · ' + esc(jour(l.ancienne_date)) + ' → ' + esc(jour(l.nouvelle_date)) + '</span>'; }).join('')
        : '<span class="so-note">Aucune modification depuis cet écran.</span>');
    } catch (e) {
      bloc.innerHTML = '<h3>HISTORIQUE DES DATES</h3><span class="so-note">Historique indisponible.</span>';
    }
  }

  function fermerFiche() {
    $('voile').hidden = true;
    ouverte = null;
    document.querySelectorAll('.so-carte.ouverte').forEach(e => e.classList.remove('ouverte'));
    if (dernierFocus && document.contains(dernierFocus)) dernierFocus.focus();
  }

  // ── Horloge ───────────────────────────────────────────────────────────────
  function horloge() {
    const h = new Date();
    $('horloge').textContent = deux(h.getHours()) + ':' + deux(h.getMinutes());
  }

  // ── Démarrage ─────────────────────────────────────────────────────────────
  async function demarrer() {
    horloge(); setInterval(horloge, 15000);
    if (!(await verifierAcces())) return;

    lundi = lundiDe(new Date());
    $('btn-prec').addEventListener('click', () => { lundi = plusJours(lundi, -7); charger(); });
    $('btn-suiv').addEventListener('click', () => { lundi = plusJours(lundi, 7); charger(); });
    $('btn-auj').addEventListener('click', () => { lundi = lundiDe(new Date()); charger(); });
    $('grille').addEventListener('click', e => {
      const carte = e.target.closest('.so-carte');
      if (carte) ouvrirFiche(carte.dataset.cle);
    });
    $('voile').addEventListener('click', e => { if (e.target === $('voile')) fermerFiche(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('voile').hidden) fermerFiche(); });

    await charger();
  }

  // Exposé pour l'étape « modification de la date » (rechargement après enregistrement)
  window.LivrialSorties = { recharger: () => charger(), fermerFiche };

  demarrer();
})();
