const { getDB } = require('../../lib/db');
const { setSessionCookie } = require('../../lib/auth');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis' });
  }

  const db = getDB();

  const { data: user } = await db
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (!user) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }

  if (!user.actif) {
    return res.status(403).json({ error: 'Compte désactivé. Contactez votre administrateur.' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }

  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

  await db.from('sessions').insert({
    id: uuidv4(),
    user_id: user.id,
    token,
    expires_at: expiresAt,
  });

  // Mettre à jour last_login
  await db.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);

  setSessionCookie(res, token);

  return res.status(200).json({
    role: user.role,
    nom: user.nom,
    prenom: user.prenom,
  });
};
