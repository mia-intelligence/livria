const { getDB } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé TomTom non configurée' });

  const db = getDB();

  // GET → feuille de route détaillée (turn-by-turn) de la tournée du jour
  if (req.method === 'GET') return directions(req, res, db, apiKey);

  const date = req.body.date || new Date().toISOString().split('T')[0];

  // Charger les stops du jour avec coordonnées
  const { data: stops, error } = await db
    .from('stops')
    .select('id, societe, adresse, latitude, longitude, ordre, vehicule, statut')
    .eq('date_tournee', date)
    .eq('societe_livraison', 'ATRIAL')
    .neq('statut', 'LIVRE')
    .order('ordre', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  if (!stops || !stops.length) return res.status(200).json({ message: 'Aucun stop à optimiser', stops: [] });

  const located = stops.filter(s => s.latitude && s.longitude);
  if (located.length < 2) {
    return res.status(200).json({ message: 'Pas assez de coordonnées pour optimiser', stops });
  }

  // Déterminer le type de véhicule (PL si au moins un stop PL)
  const isPL = stops.some(s => s.vehicule === 'PL');

  const waypoints = located.map(s => ({
    point: { latitude: s.latitude, longitude: s.longitude },
    stopTime: 10, // 10 min par stop
  }));

  const body = {
    waypoints,
    options: {
      travelMode: isPL ? 'truck' : 'car',
      ...(isPL ? {
        vehicleWeight: 26000,
        vehicleAxleWeight: 11500,
        vehicleHeight: 4.0,
        vehicleWidth: 2.55,
        vehicleLength: 16.5,
      } : {}),
    },
  };

  const ttRes = await fetch(
    `https://api.tomtom.com/waypoint-optimization/1/optimizeWaypoints?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!ttRes.ok) {
    const err = await ttRes.text();
    console.error('TomTom error:', err);
    return res.status(502).json({ error: 'Erreur TomTom Routing', detail: err });
  }

  const ttData = await ttRes.json();
  const optimizedOrder = ttData.optimizedOrder; // [2, 0, 1, ...]

  if (!optimizedOrder || !optimizedOrder.length) {
    return res.status(502).json({ error: 'Réponse TomTom invalide' });
  }

  // Mettre à jour l'ordre en DB
  const updates = optimizedOrder.map((originalIdx, newPosition) => ({
    id: located[originalIdx].id,
    ordre: newPosition + 1,
  }));

  for (const u of updates) {
    await db.from('stops').update({ ordre: u.ordre }).eq('id', u.id);
  }

  // Stops sans coordonnées → ordre à la fin
  const withoutCoords = stops.filter(s => !s.latitude || !s.longitude);
  for (let i = 0; i < withoutCoords.length; i++) {
    await db.from('stops')
      .update({ ordre: updates.length + i + 1 })
      .eq('id', withoutCoords[i].id);
  }

  // Retourner stops dans l'ordre optimisé
  const { data: refreshed } = await db
    .from('stops')
    .select('*, stop_photos(id, photo_url, created_at)')
    .eq('date_tournee', date)
    .eq('societe_livraison', 'ATRIAL')
    .order('ordre', { ascending: true });

  return res.status(200).json({
    optimized: true,
    vehicule: isPL ? 'PL' : 'VL',
    stops: refreshed || [],
  });
};

/* ── Feuille de route turn-by-turn ─────────────────────────────
   GET /api/routing/optimize?date=YYYY-MM-DD&start=lat,lon
   `start` (optionnel) = position actuelle du livreur. Sans lui, la
   route démarre au premier stop de la tournée.
   ────────────────────────────────────────────────────────────── */
async function directions(req, res, db, apiKey) {
  const date = req.query.date || new Date().toISOString().split('T')[0];

  const { data: stops, error } = await db
    .from('stops')
    .select('id, societe, adresse, latitude, longitude, ordre, vehicule, statut')
    .eq('date_tournee', date)
    .eq('societe_livraison', 'ATRIAL')
    .neq('statut', 'LIVRE')
    .order('ordre', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const located = (stops || []).filter(s => s.latitude && s.longitude);

  // Point de départ optionnel (géolocalisation du livreur)
  let startPoint = null;
  if (req.query.start) {
    const [la, lo] = String(req.query.start).split(',').map(Number);
    if (Number.isFinite(la) && Number.isFinite(lo)) startPoint = { latitude: la, longitude: lo };
  }

  const points = startPoint ? [startPoint, ...located] : located;
  if (points.length < 2) {
    return res.status(200).json({
      legs: [],
      message: 'Itinéraire indisponible : il faut au moins deux points géolocalisés.',
    });
  }

  const isPL = (stops || []).some(s => s.vehicule === 'PL');

  const path = points
    .map(p => `${p.latitude},${p.longitude}`)
    .join(':');

  const params = new URLSearchParams({
    key: apiKey,
    instructionsType: 'text',
    language: 'fr-FR',
    traffic: 'true',
    travelMode: isPL ? 'truck' : 'car',
  });
  if (isPL) {
    params.set('vehicleWeight', '26000');
    params.set('vehicleAxleWeight', '11500');
    params.set('vehicleHeight', '4.0');
    params.set('vehicleWidth', '2.55');
    params.set('vehicleLength', '16.5');
  }

  // Le séparateur `:` entre points fait partie de la syntaxe du path TomTom
  // — ne pas l'encoder.
  const ttRes = await fetch(
    `https://api.tomtom.com/routing/1/calculateRoute/${path}/json?${params}`
  );

  if (!ttRes.ok) {
    const detail = await ttRes.text();
    console.error('TomTom directions error:', detail);
    return res.status(502).json({ error: 'Erreur TomTom Routing', detail });
  }

  const ttData = await ttRes.json();
  const route  = ttData?.routes?.[0];
  if (!route) return res.status(502).json({ error: 'Réponse TomTom invalide' });

  const instructions = route.guidance?.instructions || [];
  const ttLegs       = route.legs || [];

  // Bornes cumulées de chaque leg pour répartir les instructions
  const bounds = [];
  let cumul = 0;
  for (const leg of ttLegs) {
    cumul += leg.summary?.lengthInMeters || 0;
    bounds.push(cumul);
  }

  // Destination de chaque leg : startPoint décale l'index de 1
  const legs = ttLegs.map((leg, i) => {
    const dest = startPoint ? located[i] : located[i + 1];
    return {
      stop_id:    dest?.id      || null,
      societe:    dest?.societe || '—',
      adresse:    dest?.adresse || '',
      distance_m: leg.summary?.lengthInMeters || 0,
      duree_s:    leg.summary?.travelTimeInSeconds || 0,
      steps:      [],
    };
  });

  for (const ins of instructions) {
    const offset = ins.routeOffsetInMeters || 0;
    let idx = bounds.findIndex(b => offset < b);
    if (idx === -1) idx = legs.length - 1;
    if (!legs[idx]) continue;
    legs[idx].steps.push({
      text:       ins.message || ins.maneuver || '',
      maneuver:   ins.maneuver || null,
      rue:        ins.street || null,
      distance_m: offset,
    });
  }

  return res.status(200).json({
    vehicule: isPL ? 'PL' : 'VL',
    depart:   startPoint ? 'Position actuelle' : (located[0]?.societe || '—'),
    total: {
      distance_m: route.summary?.lengthInMeters || 0,
      duree_s:    route.summary?.travelTimeInSeconds || 0,
    },
    legs,
  });
}
