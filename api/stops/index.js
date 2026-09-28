const { getDB } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

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

// « Affaires à planifier » : commandes ARC sans stop + stops pas encore placés
// dans une tournée (ordre 99), toutes dates confondues.
async function aPlanifier(db, tout) {
  const depuis = new Date(Date.now() - ARC_JOURS_A_PLANIFIER * 86400000).toISOString().slice(0, 10);

  const arcs = await toutesLesLignes(() => {
    let q = db.from('arc_commandes').select(ARC_COLS)
      .or('type_document.eq.ARC,type_document.is.null')
      // Même filtre que les feuilles LIV : sans numéro, c'est un document hors sujet.
      .not('numero_document', 'is', null).neq('numero_document', '')
      .order('date_document', { ascending: false, nullsFirst: false })
      .order('reference_complete', { ascending: true });
    if (!tout) q = q.gte('date_document', depuis);
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
    depuis: tout ? null : depuis,
    arc: arcSansStop,
    stops: await attacheArc(db, nonPlanifies),
  };
}

module.exports = async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  const db = getDB();
  const role = session.users.role;

  if (req.method === 'GET') {
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
        .select('date_tournee, statut, reference_client, societe, numero_affaire, tournee')
        .gte('date_tournee', from)
        .lte('date_tournee', to);

      if (error) return res.status(500).json({ error: error.message });

      const result = {};
      const seen   = {}; // date -> Set de clés d'entrées déjà ajoutées
      for (const stop of data) {
        const d = stop.date_tournee;
        if (!d) continue;
        if (!result[d]) {
          result[d] = { total: 0, livre: 0, en_cours: 0, a_livrer: 0, clients: [], affaires: [], entries: [] };
          seen[d] = new Set();
        }
        result[d].total++;
        if (stop.statut === 'LIVRE')         result[d].livre++;
        else if (stop.statut === 'EN_COURS') result[d].en_cours++;
        else                                 result[d].a_livrer++;

        const client  = stop.reference_client || stop.societe || null;
        const affaire = stop.numero_affaire || null;
        if (client && !result[d].clients.includes(client))    result[d].clients.push(client);
        if (affaire && !result[d].affaires.includes(affaire)) result[d].affaires.push(affaire);

        if (client || affaire) {
          const key = `${affaire || ''}|${client || ''}`;
          if (!seen[d].has(key)) {
            seen[d].add(key);
            result[d].entries.push({ affaire, client, tournee: stop.tournee || null, statut: stop.statut });
          }
        }
      }
      return res.status(200).json(result);
    }

    // Plage de dates : ?from=YYYY-MM-DD&to=YYYY-MM-DD (vue semaine magasin)
    const { from: rFrom, to: rTo } = req.query;
    const date = req.query.date || new Date().toISOString().split('T')[0];

    let query = db.from('stops').select('*, stop_photos(id, photo_url, created_at)');

    if (rFrom && rTo) {
      query = query
        .gte('date_tournee', rFrom)
        .lte('date_tournee', rTo)
        .order('date_tournee', { ascending: true })
        .order('ordre', { ascending: true });
    } else {
      query = query.eq('date_tournee', date).order('ordre', { ascending: true });
    }

    if (role === 'LIVREUR') {
      query = query.eq('societe_livraison', 'ATRIAL');
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

    // Géocodage automatique via TomTom
    let geoLat = latitude || null;
    let geoLng = longitude || null;
    if (adresse && !geoLat && process.env.TOMTOM_API_KEY) {
      try {
        const query = encodeURIComponent(`${adresse}, France`);
        const geoRes = await fetch(
          `https://api.tomtom.com/search/2/geocode/${query}.json?key=${process.env.TOMTOM_API_KEY}&limit=1&countrySet=FR`
        );
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          const pos = geoData?.results?.[0]?.position;
          if (pos) { geoLat = pos.lat; geoLng = pos.lon; }
        }
      } catch { /* géocodage non-bloquant */ }
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
        vehicule:          vehicule          || null,
        statut:            'A_LIVRER',
        ordre:             ordre             || 99,
        date_tournee:      date_tournee      || new Date().toISOString().split('T')[0],
        type_produit:      type_produit      || null,
        groupe_livraison:  groupe_livraison  || null,
        reference_client:  reference_client  || null,
        // Clé de la commande ARC choisie dans la liste (jamais saisie) : c'est
        // par elle que le script nocturne ramène l'adresse sur la commande.
        arc_reference:     arc_reference     || null,
      })
      .select('*, stop_photos(id, photo_url, created_at)')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    const [stop] = await attacheArc(db, [data]);
    return res.status(201).json(stop);
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
};
