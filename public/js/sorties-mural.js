/* ── LIVRIAL — Planning des sorties (bêta) : affichage mural ──────────────────
   Écran 1920 × 1080 en lecture seule, sans défilement. Jours ouvrés glissants
   à partir d'aujourd'hui, rafraîchissement automatique toutes les minutes.
   Mêmes données que la vue bureau : /api/stops?sorties=1 (ADV et ADMIN). */

(function () {
  'use strict';

  const RAFRAICHISSEMENT_MS = 60000;
  const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  // Bornes de la navigation, en jours ouvrés autour d'aujourd'hui
  const RECUL_MAX = 5, AVANCE_MAX = 15;

  // Géométrie des étiquettes (doit rester identique à sorties.css)
  const HAUT_CARTE = 54, ECART = 3;
  const HAUT_BLOC = 24 + 3 + 3 + 3;   // titre + marges intérieures haut et bas + écart sous le titre
  const ECART_BLOCS = 6;

  // Libellés courts de l'affichage mural (expliqués dans la légende)
  const PROD   = { GAGNEE: 'GAG.', APPRO: 'APPRO', FAB: 'FAB', FINI: 'FINI' };
  const SORTIE = { NON_PRETE: 'NON PRÊTE', PREPARATION: 'PRÉPA.', PRETE: 'PRÊTE', EN_LIVRAISON: 'EN LIV.', LIVREE: 'LIVRÉE', ENLEVEE: 'ENLEVÉE' };
  const FAMILLES = [['alu', 'ALU'], ['pvc', 'PVC'], ['autres', 'AUT'], ['vr', 'VR']];
  const ORDRE_MODE = { PL: 1, VL: 2, TRANS: 3, ENLEV: 4 };

  let nbJours = 3;      // 3 ou 4 jours affichés
  let decalage = 0;     // en jours ouvrés par rapport à aujourd'hui
  let donnees = null;   // dernière réponse correcte de l'API
  let majOk = null;     // heure de la dernière mise à jour réussie

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const deux = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + deux(d.getMonth() + 1) + '-' + deux(d.getDate());
  const heure = d => deux(d.getHours()) + ':' + deux(d.getMinutes());
  const ouvre = d => d.getDay() !== 0 && d.getDay() !== 6;

  // Jour ouvré situé à n jours ouvrés de d (n peut être négatif). Le week-end est sauté.
  function jourOuvre(d, n) {
    const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const pas = n < 0 ? -1 : 1;
    while (!ouvre(r)) r.setDate(r.getDate() + 1);          // un samedi ou dimanche part du lundi
    for (let i = 0; i < Math.abs(n); ) { r.setDate(r.getDate() + pas); if (ouvre(r)) i++; }
    return r;
  }
  // Les jours affichés : { date, iso, rang } ; rang 0 = aujourd'hui (ou prochain jour ouvré)
  function joursAffiches() {
    const base = new Date();
    return Array.from({ length: nbJours }, (_, i) => {
      const d = jourOuvre(base, decalage + i);
      return { date: d, iso: iso(d), rang: decalage + i };
    });
  }

  // ── Mise à l'échelle : la scène 1920 × 1080 remplit l'écran sans défiler ──
  function ajusterEchelle() {
    const e = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    const s = $('scene');
    s.style.transform = 'scale(' + e + ')';
    s.style.left = Math.max(0, (window.innerWidth - 1920 * e) / 2) + 'px';
    s.style.top  = Math.max(0, (window.innerHeight - 1080 * e) / 2) + 'px';
  }

  // ── Accès ─────────────────────────────────────────────────────────────────
  async function verifierAcces() {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) { window.location.href = '/'; return false; }
      const user = await res.json();
      if (!['ADV', 'ADMIN'].includes(user.role)) { window.location.href = '/'; return false; }
      return true;
    } catch { window.location.href = '/'; return false; }
  }

  // ── Chargement ────────────────────────────────────────────────────────────
  // On lit toujours une période qui contient aujourd'hui, pour que les
  // indicateurs du haut restent ceux du jour même quand on a navigué.
  async function charger() {
    const jours = joursAffiches();
    const auj = iso(jourOuvre(new Date(), 0));
    const from = [jours[0].iso, auj].sort()[0];
    const to   = [jours[jours.length - 1].iso, auj].sort()[1];
    try {
      const res = await fetch('/api/stops?sorties=1&from=' + from + '&to=' + to);
      if (res.status === 401 || res.status === 403) { window.location.href = '/'; return; }
      const corps = await res.json();
      if (!res.ok) throw new Error(corps.error || 'Erreur ' + res.status);
      donnees = corps;
      majOk = new Date();
      $('maj').className = '';
      $('maj').textContent = 'Mis à jour à ' + heure(majOk);
    } catch (e) {
      // On garde le dernier affichage correct et on signale le problème
      $('maj').className = 'erreur';
      $('maj').textContent = majOk ? 'Mise à jour impossible depuis ' + heure(majOk) : 'Chargement impossible';
    }
    afficher();
  }

  // ── Répartition en colonnes ───────────────────────────────────────────────
  // Nombre d'étiquettes qui tiennent sur une colonne dans une hauteur donnée.
  const capacite = h => Math.max(0, Math.floor((h - HAUT_BLOC + ECART) / (HAUT_CARTE + ECART)));

  // Décide, pour un jour, sur combien de colonnes d'étiquettes s'affiche chaque bloc.
  //   h : hauteur disponible sous l'en-tête du jour
  // Règle : une colonne tant que tout tient ; sinon le bloc passe sur deux colonnes.
  function repartir(atrial, trans, enlev, h) {
    const cote = [['TRANSPORTEUR', trans], ['ENLÈVEMENT CLIENT', enlev]].filter(b => b[1].length);
    const max1 = capacite(h);                         // seuil d'un bloc seul dans sa colonne

    // Ni transporteur ni enlèvement : ATRIAL prend tout le jour, sur deux colonnes d'étiquettes
    if (!cote.length) return { gauche: { titre: 'LIVRAISONS ATRIAL', cartes: atrial, cols: 2, lignes: max1 }, droite: [] };

    const gauche = { titre: 'LIVRAISONS ATRIAL', cartes: atrial, cols: atrial.length > max1 ? 2 : 1, lignes: max1 };

    // Colonne de droite : un ou deux blocs l'un au-dessus de l'autre
    const dispo = capacite(h - (cote.length - 1) * (HAUT_BLOC + ECART_BLOCS)); // lignes à partager
    const blocs = cote.map(([titre, cartes]) => ({ titre, cartes, cols: 1 }));
    const lignes = b => Math.ceil(b.cartes.length / b.cols);
    const total = () => blocs.reduce((n, b) => n + lignes(b), 0);
    // Tant que ça ne tient pas, le bloc le plus chargé encore sur une colonne passe sur deux
    while (total() > dispo && blocs.some(b => b.cols === 1)) {
      blocs.filter(b => b.cols === 1).sort((a, b) => b.cartes.length - a.cartes.length)[0].cols = 2;
    }
    // Lignes accordées à chaque bloc (le surplus éventuel est tronqué et signalé)
    let reste = dispo;
    blocs.forEach((b, i) => {
      const autres = blocs.slice(i + 1).reduce((n, x) => n + Math.min(lignes(x), 1), 0);
      b.lignes = Math.max(1, Math.min(lignes(b), reste - autres));
      reste -= b.lignes;
    });
    return { gauche, droite: blocs };
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────
  function trier(liste) {
    return liste.slice().sort((a, b) =>
      (ORDRE_MODE[a.mode] - ORDRE_MODE[b.mode])
      || String(a.client).localeCompare(String(b.client), 'fr')
      || String(a.numero).localeCompare(String(b.numero), 'fr'));
  }

  function carte(s) {
    const cl = ['mu-carte'];
    if (s.realisee) cl.push('realisee'); else if (s.retard) cl.push('retard'); else if (s.prete_au_depart) cl.push('prete');
    const qte = FAMILLES.filter(([c]) => s[c]).map(([c, lib]) => s[c] + ' ' + lib).join(' · ') || 'Contenu non détaillé';
    const cp = s.production === 'FINI' ? 'ok' : '';
    const cs = s.sortie === 'PRETE' ? 'ok' : (s.sortie === 'EN_LIVRAISON' ? 'cours' : '');
    return '<div class="' + cl.join(' ') + '">'
      + '<span class="mu-c1">' + (s.mode === 'VL' ? '<span class="vl">VL</span>' : '')
      + '<span class="client">' + esc(s.client || 'Client non renseigné') + '</span><span class="chantier">' + esc(s.chantier) + '</span></span>'
      + '<span class="mu-c2">' + esc(qte) + '</span>'
      + '<span class="mu-c3"><span class="statuts"><span class="' + cp + '">' + (PROD[s.production] || esc(s.production)) + '</span>'
      + ' <span class="pt">·</span> <span class="' + cs + '">' + (SORTIE[s.sortie] || esc(s.sortie)) + '</span></span>'
      + (s.retard ? '<span class="ret">RETARD</span>' : '') + '</span></div>';
  }

  function bloc(b) {
    const place = b.cols * b.lignes;
    let cartes = b.cartes.map(carte);
    // Trop d'étiquettes même sur deux colonnes : la dernière case annonce le reste
    if (cartes.length > place) {
      const cachees = cartes.length - (place - 1);
      cartes = cartes.slice(0, place - 1);
      cartes.push('<div class="mu-carte reste">+ ' + cachees + ' sorties non affichées</div>');
    }
    return '<div class="mu-bloc"><div class="mu-bloc-haut"><span>' + b.titre + '</span><b>' + b.cartes.length + '</b></div>'
      + (cartes.length
          ? '<div class="mu-cartes" style="grid-template-columns:repeat(' + b.cols + ',minmax(0,1fr))">' + cartes.join('') + '</div>'
          : '<span class="mu-vide">Aucune livraison ATRIAL</span>')
      + '</div>';
  }

  function etiquetteRang(r) { return r === 0 ? 'AUJOURD’HUI' : (r > 0 ? 'J+' + r : 'J' + r); }

  function afficher() {
    const jours = joursAffiches();
    const zone = $('jours');
    zone.style.gridTemplateColumns = 'repeat(' + nbJours + ', minmax(0, 1fr))';
    $('btn-3').setAttribute('aria-pressed', String(nbJours === 3));
    $('btn-4').setAttribute('aria-pressed', String(nbJours === 4));
    $('btn-prec').disabled = decalage <= -RECUL_MAX;
    $('btn-suiv').disabled = decalage >= AVANCE_MAX;

    if (!donnees) { zone.innerHTML = ''; return; }
    const sorties = donnees.sorties;

    // Hauteur disponible pour les colonnes d'un jour (identique pour tous les jours)
    // scène 1080 − marges 20 − en-tête 54 − légende 24 − écarts 16 = 966 ;
    // jour : − bordures 2 − marges 12 − titre 28 − totaux 18 − écarts 8 = 898.
    const HAUT_COLS = 898;

    zone.innerHTML = jours.map(j => {
      const duJour = trier(sorties.filter(s => s.date === j.iso));
      const t = FAMILLES.map(([c]) => duJour.reduce((n, s) => n + (s[c] || 0), 0));
      const r = repartir(
        duJour.filter(s => s.mode === 'PL' || s.mode === 'VL'),
        duJour.filter(s => s.mode === 'TRANS'),
        duJour.filter(s => s.mode === 'ENLEV'), HAUT_COLS);
      return '<section class="mu-jour' + (j.rang === 0 ? ' aujourdhui' : '') + '">'
        + '<div class="mu-jour-haut"><span class="tag">' + etiquetteRang(j.rang) + '</span>'
        + '<h2>' + JOURS[j.date.getDay()] + ' ' + j.date.getDate() + '</h2>'
        + '<span class="nb">' + duJour.length + '</span><span class="lib">' + (duJour.length > 1 ? 'sorties' : 'sortie') + '</span></div>'
        + '<div class="mu-totaux">' + t[0] + ' ALU · ' + t[1] + ' PVC · ' + t[2] + ' autres · ' + t[3] + ' VR</div>'
        + '<div class="mu-cols" style="grid-template-columns:' + (r.droite.length ? 'repeat(2,minmax(0,1fr))' : 'minmax(0,1fr)') + '">'
        + '<div class="mu-col">' + bloc(r.gauche) + '</div>'
        + (r.droite.length ? '<div class="mu-col">' + r.droite.map(bloc).join('') + '</div>' : '')
        + '</div></section>';
    }).join('');

    // Indicateurs : toujours ceux d'aujourd'hui
    const auj = sorties.filter(s => s.date === donnees.aujourdhui);
    const k = (v, lib, cl) => '<div class="mu-kpi ' + (cl || '') + '"><b>' + v + '</b><span>' + lib + '</span></div>';
    $('kpis').innerHTML =
      k(auj.length, 'sorties aujourd’hui')
      + k(auj.filter(s => s.realisee).length, 'réalisées', 'vert')
      + k(auj.filter(s => s.sortie === 'EN_LIVRAISON').length, 'en livraison', 'bleu')
      + k(sorties.filter(s => s.retard && jours.some(j => j.iso === s.date)).length, 'en retard (jours affichés)', 'rouge');
  }

  // ── Démarrage ─────────────────────────────────────────────────────────────
  async function demarrer() {
    ajusterEchelle();
    window.addEventListener('resize', ajusterEchelle);
    const horloge = () => { $('horloge').textContent = heure(new Date()); };
    horloge(); setInterval(horloge, 15000);

    if (!(await verifierAcces())) return;

    $('btn-prec').addEventListener('click', () => { decalage = Math.max(-RECUL_MAX, decalage - 1); charger(); });
    $('btn-suiv').addEventListener('click', () => { decalage = Math.min(AVANCE_MAX, decalage + 1); charger(); });
    $('btn-auj').addEventListener('click', () => { decalage = 0; charger(); });
    $('btn-3').addEventListener('click', () => { nbJours = 3; charger(); });
    $('btn-4').addEventListener('click', () => { nbJours = 4; charger(); });
    $('btn-plein').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    });
    document.addEventListener('fullscreenchange', () => {
      $('btn-plein').textContent = document.fullscreenElement ? 'Quitter le plein écran' : 'Plein écran';
    });

    await charger();
    setInterval(charger, RAFRAICHISSEMENT_MS);   // rafraîchissement automatique
  }

  // Exposé pour les essais (seuils de passage sur deux colonnes)
  window.LivrialMural = { capacite, repartir };

  demarrer();
})();
