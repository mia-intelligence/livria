const { getSession } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const session = await getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  const u = session.users;
  return res.status(200).json({
    id: u.id,
    nom: u.nom,
    prenom: u.prenom,
    email: u.email,
    role: u.role,
  });
};
