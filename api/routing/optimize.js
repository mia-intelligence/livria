const { getDB } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé TomTom non configurée' });

  const db = getDB();
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
