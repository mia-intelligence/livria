const { getDB, getAdminDB } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const { geocoder } = require('../../lib/geo');

// Colonnes de arc_commandes utiles au stop : identification, coordonnées de
// facturation (adresse de livraison par défaut), règlement (le livreur
// encaisse le solde à la livraison) et mode / date de livraison lus sur l'ARC.
const ARC_COLS = [
  'reference_complete', 'numero_document', 'reference', 'type_document', 'date_document',
  'societe', 'contact', 'adresse_facturation', 'code_postal', 'ville',
  'telephone_client', 'mobile_client', 'gamme', 'montant_ttc',
  'acompte_present', 'montant_acompte', 'taux_acompte', 'solde_avant_livraison', 'montant_solde',
  'mode_livraison', 'date_livraison_prevue',
].join(',');

// Attache à chaque stop les infos de sa commande ARC (clé stops.arc_reference).
// Une seule requête pour toute la liste ; un stop sans ARC reçoit arc: null.
async function attacheArc(db, stops) {
  const refs = [...new Set((stops || []).map(s => s.arc_reference).filter(Boolean))];
  if (!refs.length) return (stops || []).map(s => ({ ...s, arc: null }));
  const { data } = await db.from('arc_commandes').select(ARC_COLS).in('reference_complete', refs);
  const parRef = Object.fromEntries((data || []).map(c => [c.reference_complete, c]));
  return stops.map(s => ({ ...s, arc: s.arc_reference ? (parRef[s.arc_reference] || null) : null }));
}

// Fenêtre des commandes ARC qui remontent d'elles-mêmes dans « Affaires à
// planifier » : date de l'ARC dans les N derniers jours. Au-delà, la commande
// reste trouvable par la recherche. Réglable sans toucher au code (Vercel).
const ARC_JOURS_A_PLANIFIER = parseInt(process.env.ARC_JOURS_A_PLANIFIER, 10) || 60;

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

// L'application de suivi d'Atrial écrit le statut de chaque affaire dans
// arc_commandes.statut_suivi. « fini » = fabrication terminée et solde
// encaissé : la seule étape où l'ADV doit créer le stop.
const STATUT_PRET_A_LIVRER = 'fini';

// Vrai dès qu'un statut est arrivé. Faux avant la migration
// 20261005_arc_statut_suivi.sql ou la mise en service de l'envoi : la liste
// garde alors son affichage par date.
async function suiviActif(db) {
  const { data, error } = await db.from('arc_commandes')
    .select('reference_complete').not('statut_suivi', 'is', null).limit(1);
  return !error && (data || []).length > 0;
}

// « Affaires à planifier » : commandes ARC sans stop + stops pas encore placés
// dans une tournée (ordre 99), toutes dates confondues.
async function aPlanifier(db, tout) {
  const depuis = new Date(Date.now() - ARC_JOURS_A_PLANIFIER * 86400000).toISOString().slice(0, 10);
  const suivi = await suiviActif(db);

  const arcs = await toutesLesLignes(() => {
    let q = db.from('arc_commandes').select(ARC_COLS)
      .or('type_document.eq.ARC,type_document.is.null')
      // Même filtre que les feuilles LIV : sans numéro, c'est un document hors sujet.
      .not('numero_document', 'is', null).neq('numero_document', '')
      .order('date_document', { ascending: false, nullsFirst: false })
      .order('reference_complete', { ascending: true });
    // Avec le suivi, c'est le statut qui trie, quelle que soit la date de l'ARC.
    if (suivi) q = q.eq('statut_suivi', STATUT_PRET_A_LIVRER);
    else if (!tout) q = q.gte('date_document', depuis);
    return q;
  });

  // Une commande a un stop si un stop porte sa clé, ou à défaut son numéro
  // d'affaire (stops créés avant le champ « Commande ARC »).
  const stops = await toutesLesLignes(() =>
    db.from('stops').select('arc_reference, numero_affaire').order('id'));
  const refsStop     = new Set(stops.map(s => s.arc_reference).filter(Boolean));
  const affairesStop = new Set(stops.map(s => (s.numero_affaire || '').trim().toUpperCase()).filter(Boolean));

  // Table absente (migration pas encore jouée) : on affiche sans masquage.
  let masques = new Set();
  try {
    const lignes = await toutesLesLignes(() =>
      db.from('arc_masques').select('reference_complete').order('reference_complete'));
    masques = new Set(lignes.map(m => m.reference_complete));
  } catch { /* migration 20260928_arc_masques.sql non jouée */ }

  const arcSansStop = arcs.filter(c =>
    !refsStop.has(c.reference_complete)
    && !affairesStop.has((c.numero_document || '').trim().toUpperCase())
    && !masques.has(c.reference_complete));

  const { data: nonPlanifies, error } = await db
    .from('stops').select('*')
    .eq('ordre', 99).eq('statut', 'A_LIVRER')
    .order('date_tournee', { ascending: true });
  if (error) throw error;

  return {
    jours: ARC_JOURS_A_PLANIFIER,
    depuis: tout || suivi ? null : depuis,
    suivi,
    arc: arcSansStop,
    stops: await attacheArc(db, nonPlanifies),
  };
}


// ── Historique (console ADV) ───────────────────────────────────────────────
// Retrouver une livraison passée, toutes dates confondues, et ses photos :
// réclamation d'un client, preuve de dépôt à lui envoyer.
const BUCKET_PHOTOS          = 'livraisons-photos';
const HISTORIQUE_MAX         = 50;
const DUREE_LIEN_HISTORIQUE  = 60 * 60; // 1 h : le temps de consulter la fiche

// Colonnes utiles à la liste de résultats (pas de lien photo : juste le compte).
const HISTORIQUE_COLS = [
  'id', 'societe', 'adresse', 'numero_affaire', 'reference_client', 'arc_reference',
  'societe_livraison', 'statut', 'date_tournee', 'tournee', 'livre_le', 'created_at',
  'stop_photos(id, type)',
].join(', ');

// Chemin de l'objet Storage à partir du lien signé enregistré dans stop_photos.
// Les liens signés expirent (30 jours pour le colissage) : la fiche en refait
// un à chaque ouverture, pour la consultation et pour le téléchargement.
function cheminPhoto(url) {
  const m = new RegExp(`/object/sign/${BUCKET_PHOTOS}/([^?]+)`).exec(url || '');
  try { return m ? decodeURIComponent(m[1]) : null; } catch { return null; }
}

async function photosFraiches(adminDb, photos) {
  const stockage = adminDb.storage.from(BUCKET_PHOTOS);
  const liste = await Promise.all((photos || []).map(async p => {
    const chemin = cheminPhoto(p.photo_url);
    if (!chemin) return { ...p, url_telechargement: p.photo_url, fichier: null };
    const [vue, telechargement] = await Promise.all([
      stockage.createSignedUrl(chemin, DUREE_LIEN_HISTORIQUE),
      // ?download=<nom> : le navigateur enregistre le fichier au lieu de l'afficher
      stockage.createSignedUrl(chemin, DUREE_LIEN_HISTORIQUE, { download: chemin }),
    ]);
    const urlVue = vue.data?.signedUrl || p.photo_url;
    return {
      ...p,
      photo_url:          urlVue,
      url_telechargement: telechargement.data?.signedUrl || urlVue,
      fichier:            chemin,
    };
  }));
  return liste.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

module.exports = async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  const db = getDB();
  const role = session.users.role;

  if (req.method === 'GET') {
    // Historique : ?historique=search&q=...  (liste) · ?historique=stop&id=... (fiche)
    // Hébergé ici pour rester sous la limite de 12 fonctions Vercel Hobby.
    if (req.query.historique === 'search') {
      if (!['ADV', 'ADMIN'].includes(role)) return res.status(403).json({ error: 'Accès refusé' });
      const q = String(req.query.q || '').trim();

      let query = db.from('stops').select(HISTORIQUE_COLS)
        .order('date_tournee', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(HISTORIQUE_MAX);
      if (q) {
        // Société, n° d'affaire, référence client, commande ARC ou adresse.
        // Les virgules et parenthèses casseraient la syntaxe PostgREST : on les retire.
        const motif = `%${q.replace(/[,()]/g, ' ')}%`;
        query = query.or([
          `societe.ilike.${motif}`, `numero_affaire.ilike.${motif}`, `reference_client.ilike.${motif}`,
          `arc_reference.ilike.${motif}`, `adresse.ilike.${motif}`,
        ].join(','));
      } else {
        // Sans recherche : les dernières livraisons effectuées
        query = query.eq('statut', 'LIVRE');
      }
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });

      const stops = (data || []).map(({ stop_photos, ...s }) => ({
        ...s,
        nb_photos:    (stop_photos || []).length,
        nb_depot:     (stop_photos || []).filter(p => p.type === 'livraison').length,
        nb_colissage: (stop_photos || []).filter(p => p.type !== 'livraison').length,
      }));
      return res.status(200).json({ q, max: HISTORIQUE_MAX, stops });
    }

    if (req.query.historique === 'stop') {
      if (!['ADV', 'ADMIN'].includes(role)) return res.status(403).json({ error: 'Accès refusé' });
      const id = String(req.query.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id requis' });

      const { data, error } = await db
        .from('stops').select('*, stop_photos(id, photo_url, type, created_at)')
        .eq('id', id).maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: 'Stop introuvable' });

      const [stop] = await attacheArc(db, [data]);
      try {
        stop.stop_photos = await photosFraiches(getAdminDB(), stop.stop_photos);
      } catch (e) {
        // Storage indisponible : on garde les liens enregistrés, quitte à ce qu'ils aient expiré
        console.error('Historique : liens photo non renouvelés', e.message);
        stop.stop_photos = (stop.stop_photos || []).map(p => ({ ...p, url_telechargement: p.photo_url, fichier: null }));
      }
      return res.status(200).json(stop);
    }

    // Recherche d'une commande ARC pour créer un stop : ?arc=search&q=...
    // Hébergé ici pour rester sous la limite de 12 fonctions Vercel Hobby.
    // Lit la table alimentée chaque nuit par le script ARC (arc_commandes).
    if (req.query.arc === 'search') {
      if (!['ADV', 'ADMIN'].includes(role)) return res.status(403).json({ error: 'Accès refusé' });
      const q = String(req.query.q || '').trim();

      let query = db
        .from('arc_commandes')
        .select(ARC_COLS)
        .or('type_document.eq.ARC,type_document.is.null')
        .order('date_document', { ascending: false, nullsFirst: false })
        .limit(20);
      if (q) {
        // Recherche sur la référence complète, la société ou le n° de document.
        // Les virgules et parenthèses casseraient la syntaxe PostgREST : on les retire.
        const motif = `%${q.replace(/[,()]/g, ' ')}%`;
        query = query.or(`reference_complete.ilike.${motif},societe.ilike.${motif},numero_document.ilike.${motif}`);
      }
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });

      // Une commande qui a déjà un stop est signalée, pas cachée : une
      // relivraison reste possible.
      const refs = (data || []).map(c => c.reference_complete);
      let dejaStop = new Set();
      if (refs.length) {
        const { data: existants } = await db
          .from('stops').select('arc_reference').in('arc_reference', refs);
        dejaStop = new Set((existants || []).map(s => s.arc_reference));
      }
      return res.status(200).json((data || []).map(c => ({ ...c, deja_stop: dejaStop.has(c.reference_complete) })));
    }

    // Affaires à planifier : ?arc=a_planifier (60 derniers jours) ou &tout=1
    if (req.query.arc === 'a_planifier') {
      if (!['ADV', 'ADMIN'].includes(role)) return res.status(403).json({ error: 'Accès refusé' });
      try {
        return res.status(200).json(await aPlanifier(db, req.query.tout === '1'));
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // Planning mode : ?planning=true&from=YYYY-MM-DD&to=YYYY-MM-DD
    if (req.query.planning === 'true') {
      const { from, to } = req.query;
      if (!from || !to) return res.status(400).json({ error: 'Paramètres from et to requis' });

      const { data, error } = await db
        .from('stops')
        .select('id, date_tournee, statut, reference_client, societe, adresse, numero_affaire, tournee')
        .gte('date_tournee', from)
        .lte('date_tournee', to);

      if (error) return res.status(500).json({ error: error.message });

      // Une entrée par stop (avec son id) : depuis le planning, l'ADV clique
      // sur une entrée pour reporter le stop à une autre date.
      const result = {};
      for (const stop of data) {
        const d = stop.date_tournee;
        if (!d) continue;
        if (!result[d]) {
          result[d] = { total: 0, livre: 0, en_cours: 0, a_livrer: 0, clients: [], affaires: [], entries: [] };
        }
        result[d].total++;
        if (stop.statut === 'LIVRE')         result[d].livre++;
        else if (stop.statut === 'EN_COURS') result[d].en_cours++;
        else                                 result[d].a_livrer++;

        const client  = stop.reference_client || stop.societe || null;
        const affaire = stop.numero_affaire || null;
        if (client && !result[d].clients.includes(client))    result[d].clients.push(client);
        if (affaire && !result[d].affaires.includes(affaire)) result[d].affaires.push(affaire);

        result[d].entries.push({
          id: stop.id, affaire, client, adresse: stop.adresse || null,
          tournee: stop.tournee || null, statut: stop.statut,
        });
      }
      return res.status(200).json(result);
    }

    // Magasin, onglet « À préparer » : tout ce qui n'est pas encore validé,
    // quelle que soit la date (un stop créé au statut « fini » n'a souvent
    // pas encore de date de tournée). Sans date d'abord, puis par date.
    if (req.query.magasin === 'a_preparer') {
      if (!['MAGASIN', 'ADV', 'ADMIN'].includes(role)) return res.status(403).json({ error: 'Accès refusé' });
      const { data, error } = await db
        .from('stops').select('*, stop_photos(id, photo_url, type, created_at)')
        .eq('magasin_valide', false)
        .neq('statut', 'LIVRE')
        .order('date_tournee', { ascending: true, nullsFirst: true })
        .order('ordre', { ascending: true });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(await attacheArc(db, data));
    }

    // Plage de dates : ?from=YYYY-MM-DD&to=YYYY-MM-DD (vue semaine magasin)
    const { from: rFrom, to: rTo } = req.query;
    const date = req.query.date || new Date().toISOString().split('T')[0];

    let query = db.from('stops').select('*, stop_photos(id, photo_url, type, created_at)');

    if (rFrom && rTo) {
      query = query
        .gte('date_tournee', rFrom)
        .lte('date_tournee', rTo)
        .order('date_tournee', { ascending: true })
        .order('ordre', { ascending: true });
    } else {
      query = query.eq('date_tournee', date).order('ordre', { ascending: true });
    }

    // Livreur : ses camions seulement, et uniquement ce que le magasin a
    // validé ET que l'ADV a placé dans une tournée. Avant, tout stop du jour
    // apparaissait, avec la mention « En attente de préparation magasin ».
    if (role === 'LIVREUR') {
      query = query
        .eq('societe_livraison', 'ATRIAL')
        .eq('magasin_valide', true)
        .not('tournee', 'is', null);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(await attacheArc(db, data));
  }

  // Masquer / réafficher une commande ARC dans « Affaires à planifier » :
  // POST ?arc=masquer  { reference_complete, masque: true|false }
  if (req.method === 'POST' && req.query.arc === 'masquer') {
    if (!['ADV', 'ADMIN'].includes(role)) return res.status(403).json({ error: 'Accès refusé' });
    const { reference_complete, masque = true } = req.body || {};
    if (!reference_complete) return res.status(400).json({ error: 'reference_complete requis' });

    const { error } = masque
      ? await db.from('arc_masques').upsert({ reference_complete, masque_par: session.users.id })
      : await db.from('arc_masques').delete().eq('reference_complete', reference_complete);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ reference_complete, masque: !!masque });
  }

  if (req.method === 'POST') {
    if (!['ADV', 'ADMIN', 'LIVREUR'].includes(role)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const {
      numero_affaire,
      societe,
      adresse,
      telephone,
      societe_livraison,
      tournee,
      vehicule,
      lieu_livraison,
      date_tournee,
      latitude,
      longitude,
      ordre,
      type_produit,
      groupe_livraison,
      reference_client,
      arc_reference,
    } = req.body;

    if (!societe || !adresse || !societe_livraison) {
      return res.status(400).json({ error: 'societe, adresse et societe_livraison sont requis' });
    }

    const VALID_SOCIETES_LIVRAISON = ['ATRIAL', 'ENLEVEMENT', 'TRANSPORTEUR'];
    if (!VALID_SOCIETES_LIVRAISON.includes(societe_livraison)) {
      return res.status(400).json({ error: 'societe_livraison invalide' });
    }

    const VALID_TOURNEES = [
      'ENLEVEMENT', 'TOURNEE LUNDI', 'MARDI T06-T83EST',
      'MERCREDI T13', 'TOURNEE JEUDI', 'VENDREDI T83 OUEST',
      'LIVRAISON CHANTIER', 'TRANSPORTEUR',
    ];
    if (tournee && !VALID_TOURNEES.includes(tournee)) {
      return res.status(400).json({ error: 'tournee invalide' });
    }

    const VALID_VEHICULES = ['PL', 'VL'];
    if (vehicule && !VALID_VEHICULES.includes(vehicule)) {
      return res.status(400).json({ error: 'vehicule invalide' });
    }

    const VALID_TYPES = ['PVC', 'ALU', 'MIXTE'];
    if (type_produit && !VALID_TYPES.includes(type_produit)) {
      return res.status(400).json({ error: 'type_produit invalide' });
    }

    const VALID_LIEUX = ['CHANTIER', 'DEPOT'];
    if (lieu_livraison && !VALID_LIEUX.includes(lieu_livraison)) {
      return res.status(400).json({ error: 'lieu_livraison invalide' });
    }

    // Géocodage automatique via TomTom (non bloquant)
    let geoLat = latitude || null;
    let geoLng = longitude || null;
    if (adresse && !geoLat) {
      const geo = await geocoder(adresse);
      if (geo) { geoLat = geo.latitude; geoLng = geo.longitude; }
    }

    const { data, error } = await db
      .from('stops')
      .insert({
        societe:           societe           || null,
        adresse:           adresse           || null,
        telephone:         telephone         || null,
        latitude:          geoLat,
        longitude:         geoLng,
        numero_affaire:    numero_affaire    || null,
        societe_livraison: societe_livraison || 'ATRIAL',
        tournee:           tournee           || null,
        // Poids lourd d'office : l'ADV le change au besoin
        vehicule:          vehicule          || 'PL',
        lieu_livraison:    lieu_livraison    || 'CHANTIER',
        statut:            'A_LIVRER',
        ordre:             ordre             || 99,
        date_tournee:      date_tournee      || new Date().toISOString().split('T')[0],
        type_produit:      type_produit      || null,
        groupe_livraison:  groupe_livraison  || null,
        reference_client:  reference_client  || null,
        // Clé de la commande ARC choisie dans la liste (jamais saisie) : c'est
        // par elle que le script nocturne ramène l'adresse sur la commande.
        arc_reference:     arc_reference     || null,
        origine:           role === 'LIVREUR' ? 'livreur' : 'adv',
      })
      .select('*, stop_photos(id, photo_url, type, created_at)')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    const [stop] = await attacheArc(db, [data]);
    return res.status(201).json(stop);
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
};
