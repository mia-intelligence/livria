const { getDB } = require('../../lib/db');
const { requireRole } = require('../../lib/auth');
const { log } = require('../../lib/log');
const bcrypt = require('bcrypt');

module.exports = async function handler(req, res) {
  const session = await requireRole(req, res, 'ADMIN');
  if (!session) return;

  const { id } = req.query;
  const db = getDB();
  const adminEmail = session.users.email;

  if (req.method === 'PATCH') {
    const { actif, password } = req.body;
    const updates = {};

    if (typeof actif === 'boolean') {
      if (id === session.users.id && actif === false) {
        return res.status(400).json({ error: 'Impossible de révoquer votre propre compte' });
      }
      updates.actif = actif;
    }

    if (password !== undefined) {
      if (!password || password.length < 8) {
        return res.status(400).json({ error: 'Mot de passe trop court (min. 8 caractères)' });
      }
      updates.password_hash = await bcrypt.hash(password, 10);
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    const { data, error } = await db
      .from('users')
      .update(updates)
      .eq('id', id)
      .select('id, nom, prenom, email, role, actif')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Utilisateur introuvable' });

    if (updates.actif === false) {
      await db.from('sessions').delete().eq('user_id', id);
      await log(adminEmail, 'USER_REVOKED', { target: data.email });
    } else if (updates.actif === true) {
      await log(adminEmail, 'USER_REACTIVATED', { target: data.email });
    }
    if (updates.password_hash) {
      await log(adminEmail, 'PASSWORD_RESET', { target: data.email });
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
