const { getDB } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  const db = getDB();
  const role = session.users.role;

  if (req.method === 'GET') {
    // Planning mode : ?planning=true&from=YYYY-MM-DD&to=YYYY-MM-DD
    if (req.query.planning === 'true') {
      const { from, to } = req.query;
      if (!from || !to) return res.status(400).json({ error: 'Paramètres from et to requis' });

      const { data, error } = await db
        .from('stops')
        .select('date_tournee, statut, reference_client, societe')
        .gte('date_tournee', from)
        .lte('date_tournee', to);

      if (error) return res.status(500).json({ error: error.message });

      const result = {};
      for (const stop of data) {
        const d = stop.date_tournee;
        if (!d) continue;
        if (!result[d]) result[d] = { total: 0, livre: 0, en_cours: 0, a_livrer: 0, clients: [] };
        result[d].total++;
        if (stop.statut === 'LIVRE')         result[d].livre++;
        else if (stop.statut === 'EN_COURS') result[d].en_cours++;
        else                                 result[d].a_livrer++;
        const label = stop.reference_client || stop.societe || null;
        if (label && !result[d].clients.includes(label)) result[d].clients.push(label);
      }
      return res.status(200).json(result);
    }

    const date = req.query.date || new Date().toISOString().split('T')[0];

    let query = db
      .from('stops')
      .select('*, stop_photos(id, photo_url, created_at)')
      .eq('date_tournee', date)
      .order('ordre', { ascending: true });

    if (role === 'LIVREUR') {
      query = query.eq('societe_livraison', 'ATRIAL');
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
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
      })
      .select('*, stop_photos(id, photo_url, created_at)')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
};
