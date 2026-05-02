const { getDB } = require('../../lib/db');
const { requireRole } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  const session = await requireRole(req, res, 'ADMIN');
  if (!session) return;

  const { id } = req.query;
  const db = getDB();

  if (req.method === 'PATCH') {
    const { actif } = req.body;

    if (typeof actif !== 'boolean') {
      return res.status(400).json({ error: 'Le champ actif (boolean) est requis' });
    }

    // Empêcher un admin de se révoquer lui-même
    if (id === session.users.id && actif === false) {
      return res.status(400).json({ error: 'Impossible de révoquer votre propre compte' });
    }

    const { data, error } = await db
      .from('users')
      .update({ actif })
      .eq('id', id)
      .select('id, nom, prenom, email, role, actif')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Utilisateur introuvable' });

    // Si révocation : invalider toutes les sessions actives de l'utilisateur
    if (!actif) {
      await db.from('sessions').delete().eq('user_id', id);
    }

    return res.status(200).json(data);
  }

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('users')
      .select('id, nom, prenom, email, role, actif, created_at, last_login')
      .eq('id', id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Utilisateur introuvable' });
    return res.status(200).json(data);
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
};
