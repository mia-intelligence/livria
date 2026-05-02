const { getDB } = require('../../lib/db');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { societe, adresse, telephone, latitude, longitude, numero_affaire, type } = req.body;

  if (!societe || !adresse || !type) {
    return res.status(400).json({ error: 'Champs requis manquants : societe, adresse, type' });
  }

  const VALID_TYPES = ['ATRIAL', 'ENLEVEMENT', 'TRANSPORTEUR'];
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: 'type invalide. Valeurs acceptées : ATRIAL, ENLEVEMENT, TRANSPORTEUR' });
  }

  const db = getDB();
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await db
    .from('stops')
    .insert({
      societe,
      adresse,
      telephone: telephone || null,
      latitude: typeof latitude === 'number' ? latitude : null,
      longitude: typeof longitude === 'number' ? longitude : null,
      numero_affaire: numero_affaire || null,
      type,
      statut: 'A_LIVRER',
      ordre: 99,
      date_tournee: today,
    })
    .select()
    .single();

  if (error) {
    console.error('[webhook/stop] Erreur insertion:', error.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }

  return res.status(200).json({ ok: true, id: data.id });
};
