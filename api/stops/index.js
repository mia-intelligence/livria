const { getDB } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  const db = getDB();
  const role = session.users.role;

  if (req.method === 'GET') {
    const date = req.query.date || new Date().toISOString().split('T')[0];

    let query = db
      .from('stops')
      .select('*')
      .eq('date_tournee', date)
      .order('ordre', { ascending: true });

    // Le livreur ne voit que les stops ATRIAL
    if (role === 'LIVREUR') {
      query = query.eq('societe_livraison', 'ATRIAL');
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  // Seuls ADV et ADMIN peuvent créer manuellement des stops
  if (req.method === 'POST') {
    if (!['ADV', 'ADMIN'].includes(role)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const {
  numero_affaire,
  societe,
  adresse,
  telephone,
  societe_livraison,
  date_tournee,
  latitude,
  longitude,
  ordre
} = req.body;
   if (!societe || !adresse || !societe_livraison){
      return res.status(400).json({ error: 'societe, adresse et societe_livraison sont requis' });
    }

    const VALID_SOCIETES_LIVRAISON = ['ATRIAL', 'ENLEVEMENT', 'TRANSPORTEUR'];

if (!VALID_SOCIETES_LIVRAISON.includes(societe_livraison)) {
  return res.status(400).json({ error: 'societe_livraison invalide' });
}

    const { data, error } = await db
  .from('stops')
  .insert({
    societe: societe || null,
    adresse: adresse || null,
    telephone: telephone || null,
    latitude: latitude || null,
    longitude: longitude || null,
    numero_affaire: numero_affaire || null,
    societe_livraison: societe_livraison || 'ATRIAL',
    statut: 'A_LIVRER',
    ordre: ordre || 99,
    date_tournee: date_tournee || new Date().toISOString().split('T')[0],
  })
  .select('*')
.single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
};
