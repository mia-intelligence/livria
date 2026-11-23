/* ── LIVRIAL — Planning des sorties : fiche d'une affaire ─────────────────────
   Partagée par l'écran « 3 jours » (sorties-mural.js) et la vue « Semaine »
   (sorties.js). Un clic sur une affaire ouvre sa fiche ; quand l'affaire a un
   stop pas encore sorti, l'ADV y modifie la date de sortie, l'adresse de
   livraison et le téléphone. Le serveur refait tous les contrôles.

   La page doit contenir :
     <div class="so-voile" id="voile" hidden><aside class="so-fiche" id="fiche" …></aside></div>
     <div class="so-annonce" id="annonce" role="status" aria-live="polite" hidden></div>

   LivrialFiche.creer({ sortie, libelles, recharger, carte }) :
     sortie(cle)   la sortie à afficher (objet renvoyé par /api/stops?sorties=1)
     libelles()    { production, sortie } renvoyés par l'API
     recharger()   recharge le planning après un enregistrement (promesse)
     carte         sélecteur CSS des étiquettes cliquables (attribut data-cle) */

(function () {
  'use strict';

  const MOIS  = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const NOMS  = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const MODES = {
    PL:    'Livraison PL (camion ATRIAL)',
    VL:    'Livraison VL (véhicule léger ATRIAL)',
    TRANS: 'Enlèvement par transporteur',
    ENLEV: 'Enlèvement par le client',
  };

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const deux = n => String(n).padStart(2, '0');
  const depuisIso = s => { const [a, m, j] = s.split('-').map(Number); return new Date(a, m - 1, j); };
  const dateLongue = s => { const d = depuisIso(s); return NOMS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()] + ' ' + d.getFullYear(); };
  const estWeekEnd = v => { const j = depuisIso(v).getDay(); return j === 0 || j === 6; };

  function creer(options) {
    let ouverte = null;       // clé de la sortie dont la fiche est ouverte
    let dernierFocus = null;  // étiquette à refocaliser à la fermeture

    const libProd   = s => (options.libelles().production[s.production] || s.production);
    const libSortie = s => (options.libelles().sortie[s.sortie] || s.sortie);
    const classeProd   = s => s.production === 'FINI' ? 'ok' : '';
    const classeSortie = s => s.sortie === 'PRETE' ? 'ok' : (s.sortie === 'EN_LIVRAISON' ? 'cours' : '');

    function marquer(cle) {
      document.querySelectorAll(options.carte + '.ouverte').forEach(e => e.classList.remove('ouverte'));
      if (!cle) return;
      const carte = document.querySelector(options.carte + '[data-cle="' + (window.CSS && CSS.escape ? CSS.escape(cle) : cle) + '"]');
      if (carte) carte.classList.add('ouverte');
    }

    function ouvrir(cle) {
      const s = options.sortie(cle);
      if (!s) return;
      if (ouverte === null) dernierFocus = document.activeElement;
      ouverte = cle;
      marquer(cle);

      const total = s.alu + ' ALU · ' + s.pvc + ' PVC · ' + s.autres + ' autres · ' + s.vr + ' VR';
      const lignes = s.lignes.length
        ? s.lignes.map(l => '<div class="so-art' + (l.famille === 'INCONNU' ? ' inconnue' : '') + '"><b>' + esc(l.quantite == null ? '' : l.quantite) + '</b>'
            + '<span class="code">' + esc(l.code || (l.famille === 'INCONNU' ? 'non classé' : '')) + '</span>'
            + '<span class="lib">' + esc(l.designation) + '</span></div>').join('')
        : '<span class="so-note">Aucune ligne d’ARC rattachée à cette sortie.</span>';
      const nonClassees = s.lignes.filter(l => l.famille === 'INCONNU').length;
      const enlevement = s.mode === 'ENLEV';

      $('fiche').innerHTML =
        '<div class="so-fiche-haut"><div>'
        + '<span class="client">' + esc(s.client) + '</span>'
        + '<h2 id="fiche-titre">' + esc(s.chantier || s.numero) + '</h2>'
        + '<span class="affaire">Affaire ' + esc(s.numero) + '</span></div>'
        + '<button type="button" class="so-btn fleche" id="fiche-fermer" aria-label="Fermer la fiche">×</button></div>'

        + '<section class="bloc"><h3>SORTIE</h3>'
        + '<div class="so-champ">Date de sortie prévue<b>' + esc(dateLongue(s.date)) + '</b></div>'
        + '<div class="so-champ">Mode de sortie<b>' + (MODES[s.mode] || esc(s.mode)) + '</b></div>'
        + (s.retard ? '<span class="so-alerte">En retard : la date de sortie est atteinte ou dépassée.</span>' : '')
        + '<div id="fiche-date">' + (s.source === 'arc'
            ? '<span class="so-note">Date modifiable une fois l’affaire dans LIVRIAL.</span>'
            : (s.realisee ? '<span class="so-note">Sortie réalisée : la date n’est plus modifiable.</span>' : ''))
        + '</div></section>'

        + (s.source === 'stop' || s.coordonnees_modifiables
            ? '<section class="bloc"><h3>' + (enlevement ? 'CLIENT' : 'LIVRAISON') + '</h3>'
              + '<div class="so-champ">' + (enlevement ? 'Adresse du client' : 'Adresse de livraison') + '<b>' + esc(s.adresse || 'Non renseignée') + '</b></div>'
              + '<div class="so-champ">Téléphone<b>' + esc(s.telephone || 'Non renseigné') + '</b></div>'
              + '<div id="fiche-coord">' + (s.realisee ? '<span class="so-note">Sortie réalisée : ces informations ne sont plus modifiables.</span>' : '')
              + '</div></section>'
            : '')

        + '<section><h3>STATUTS</h3><div class="so-deux">'
        + '<div><span>Production</span><strong class="' + classeProd(s) + '">' + esc(libProd(s)) + '</strong></div>'
        + '<div><span>Sortie (LIVRIAL)</span><strong class="' + classeSortie(s) + '">' + esc(libSortie(s)) + '</strong></div></div>'
        + '<span class="so-note">' + (s.source === 'arc'
            ? 'Affaire pas encore dans LIVRIAL (fabrication non terminée) : la date vient du suivi d’affaires. L’adresse saisie ici sera reprise à la création du stop.'
            : 'Affaire dans LIVRIAL : la date est celle de la tournée.') + '</span></section>'

        + '<section><h3>CONTENU DE LA COMMANDE</h3>' + lignes
        + '<span class="so-note">Total : ' + total + '</span>'
        + (nonClassees ? '<span class="so-note">' + nonClassees + (nonClassees > 1 ? ' lignes non classées ne sont pas comptées.' : ' ligne non classée n’est pas comptée.') + '</span>' : '')
        + '</section>';

      $('voile').hidden = false;
      $('fiche-fermer').addEventListener('click', fermer);
      $('fiche').focus();
      if (s.date_modifiable) installerDate(s);
      if (s.coordonnees_modifiables) installerCoordonnees(s);
      if (s.source === 'stop') chargerHistorique(s);
    }

    function fermer() {
      $('voile').hidden = true;
      ouverte = null;
      marquer(null);
      if (dernierFocus && document.contains(dernierFocus)) dernierFocus.focus();
    }

    // Après un enregistrement : le planning se recharge, la fiche se rouvre
    // sur la sortie à jour (ou se ferme si elle est sortie de la période).
    async function apresEnregistrement(cle, message) {
      await options.recharger();
      if (options.sortie(cle)) ouvrir(cle); else fermer();
      annoncer(message);
    }

    // ── Modification de la date de sortie ───────────────────────────────────
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

    // 2e clic : enregistrement
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
        await apresEnregistrement(s.cle, 'Date de sortie modifiée : ' + dateLongue(nouvelle) + '.'
          + (corps.tracee ? '' : ' Attention : la trace n’a pas pu être enregistrée.'));
      } catch (e) {
        $('date-confirm').innerHTML = '';
        $('date-enregistrer').hidden = false;
        err.textContent = 'Date non modifiée : ' + e.message;
      }
    }

    // ── Modification de l'adresse de livraison et du téléphone ──────────────
    function installerCoordonnees(s) {
      const zone = $('fiche-coord');
      if (!zone) return;
      zone.innerHTML =
        '<label class="so-champ" for="coord-adresse">' + (s.mode === 'ENLEV' ? 'Nouvelle adresse' : 'Nouvelle adresse de livraison')
        + '<input type="text" id="coord-adresse" maxlength="300" autocomplete="off" value="' + esc(s.adresse || '') + '"></label>'
        + '<label class="so-champ" for="coord-tel">Téléphone'
        + '<input type="tel" id="coord-tel" maxlength="40" autocomplete="off" value="' + esc(s.telephone || '') + '"></label>'
        + '<span class="so-alerte" id="coord-erreur" role="alert"></span>'
        + '<button type="button" class="so-primaire" id="coord-enregistrer">Enregistrer</button>';

      const adresse = $('coord-adresse'), tel = $('coord-tel'), err = $('coord-erreur'), bouton = $('coord-enregistrer');
      [adresse, tel].forEach(c => c.addEventListener('input', () => { err.textContent = ''; }));

      bouton.addEventListener('click', async () => {
        const a = adresse.value.trim(), t = tel.value.trim();
        const corps = {};
        if (a !== (s.adresse || '').trim())   corps.adresse = a;
        if (t !== (s.telephone || '').trim()) corps.telephone = t;
        err.textContent = '';
        if (!a)                         { err.textContent = 'L’adresse ne peut pas être vide.'; return; }
        if (!Object.keys(corps).length) { err.textContent = 'Aucune modification à enregistrer.'; return; }

        bouton.disabled = true; bouton.textContent = 'Enregistrement…';
        try {
          // Avec un stop : on modifie le stop. Sans stop : la saisie est gardée
          // à part et reprise à la création du stop (affaire finie).
          const res = s.source === 'stop'
            ? await fetch('/api/stops/' + encodeURIComponent(s.stop_id), {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(corps),
              })
            : await fetch('/api/stops?sorties=coordonnees', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ arc_reference: s.arc_reference, adresse: a, telephone: t }),
              });
          if (res.status === 401) { window.location.href = '/'; return; }
          const rep = await res.json();
          if (!res.ok) throw new Error(rep.error || 'Erreur ' + res.status);
          await apresEnregistrement(s.cle,
            corps.adresse !== undefined ? 'Adresse de livraison modifiée.' : 'Téléphone modifié.');
        } catch (e) {
          bouton.disabled = false; bouton.textContent = 'Enregistrer';
          err.textContent = 'Modification non enregistrée : ' + e.message;
        }
      });
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
        if (ouverte !== s.cle || !document.contains(bloc)) return;   // la fiche a changé entre-temps
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

    // Fermeture : clic hors de la fiche, touche Échap
    $('voile').addEventListener('click', e => { if (e.target === $('voile')) fermer(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('voile').hidden) fermer(); });

    return { ouvrir, fermer, ouverte: () => ouverte };
  }

  window.LivrialFiche = { creer };
})();
