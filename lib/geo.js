// Géocodage d'une adresse française via TomTom. Non bloquant : renvoie
// { latitude, longitude } ou null (clé absente, adresse inconnue, réseau).
async function geocoder(adresse) {
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!adresse || !apiKey) return null;
  try {
    const query = encodeURIComponent(`${adresse}, France`);
    const r = await fetch(
      `https://api.tomtom.com/search/2/geocode/${query}.json?key=${apiKey}&limit=1&countrySet=FR`
    );
    if (!r.ok) return null;
    const data = await r.json();
    const pos = data?.results?.[0]?.position;
    return pos ? { latitude: pos.lat, longitude: pos.lon } : null;
  } catch {
    return null;
  }
}

module.exports = { geocoder };
