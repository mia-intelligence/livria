const { getDB } = require('../../lib/db');
const { requireRole } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  const session = await requireRole(req, res, 'ADMIN');
  if (!session) return;

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé TomTom non configurée' });

  const db = getDB();

  const { data: stops } = await db
    .from('stops')
    .select('id, adresse')
    .is('latitude', null)
    .not('adresse', 'is', null)
    .limit(100); // par batch pour éviter timeout

  if (!stops || !stops.length) {
    return res.status(200).json({ message: 'Tous les stops ont déjà des coordonnées', updated: 0 });
  }

  let updated = 0;
  for (const stop of stops) {
    try {
      const query = encodeURIComponent(`${stop.adresse}, France`);
      const geoRes = await fetch(
        `https://api.tomtom.com/search/2/geocode/${query}.json?key=${apiKey}&limit=1&countrySet=FR`
      );
      if (!geoRes.ok) continue;
      const geoData = await geoRes.json();
      const pos = geoData?.results?.[0]?.position;
      if (!pos) continue;
      await db.from('stops').update({ latitude: pos.lat, longitude: pos.lon }).eq('id', stop.id);
      updated++;
    } catch { /* skip */ }
  }

  return res.status(200).json({ message: `${updated} stops géocodés sur ${stops.length}`, updated, total: stops.length });
};
