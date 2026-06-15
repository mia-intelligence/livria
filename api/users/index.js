const { getDB } = require('../../lib/db');
const { requireRole } = require('../../lib/auth');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

module.exports = async function handler(req, res) {
  const session = await requireRole(req, res, 'ADMIN');
  if (!session) return;

  const db = getDB();

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('users')
      .select('id, nom, prenom, email, role, actif, created_at, last_login')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    const { nom, prenom, email, role, password } = req.body;

    if (!nom || !prenom || !email || !role || !password) {
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    const VALID_ROLES = ['LIVREUR', 'ADV', 'ADMIN','MAGASIN'];
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Rôle invalide' });
    }

    // Vérifier unicité email
    const { data: existing } = await db
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Cet email est déjà utilisé' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const { data, error } = await db
      .from('users')
      .insert({
        id: uuidv4(),
        nom,
        prenom,
        email: email.toLowerCase().trim(),
        password_hash,
        role,
        actif: true,
      })
      .select('id, nom, prenom, email, role, actif, created_at')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
};
