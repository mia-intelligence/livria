const { getDB } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  const { id } = req.query;
  const db = getDB();
  const role = session.users.role;

  if (req.method === 'GET') {
    const { data, error } = await db.from('stops').select('*').eq('id', id).single();
    if (error || !data) return res.status(404).json({ error: 'Stop introuvable' });

    // Livreur : seulement les stops ATRIAL
    if (role === 'LIVREUR' && data.type !== 'ATRIAL') {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    return res.status(200).json(data);
  }

  if (req.method === 'PATCH') {
    const { statut, ordre } = req.body;
    const VALID_STATUTS = ['A_LIVRER', 'EN_COURS', 'LIVRE'];

    const updates = {};

    if (statut !== undefined) {
      if (!VALID_STATUTS.includes(statut)) {
        return res.status(400).json({ error: 'statut invalide' });
      }
      // Le livreur peut changer le statut uniquement sur les stops ATRIAL
      if (role === 'LIVREUR') {
        const { data: stop } = await db.from('stops').select('type').eq('id', id).single();
        if (!stop || stop.type !== 'ATRIAL') {
          return res.status(403).json({ error: 'Accès refusé' });
        }
      }
      updates.statut = statut;
    }

    if (ordre !== undefined && ['ADV', 'ADMIN'].includes(role)) {
      updates.ordre = ordre;
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await db
      .from('stops')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Stop introuvable' });
    return res.status(200).json(data);
  }

  if (req.method === 'DELETE') {
    if (!['ADV', 'ADMIN'].includes(role)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const { error } = await db.from('stops').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
};
