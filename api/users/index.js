const { getDB } = require('../../lib/db');
const { requireRole } = require('../../lib/auth');
const { log } = require('../../lib/log');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

module.exports = async function handler(req, res) {
  const session = await requireRole(req, res, 'ADMIN');
  if (!session) return;

  const db = getDB();

  if (req.method === 'GET') {
    const { data, error } = await db
      .from('users')
      .select('id, nom, prenom, identifiant, role, actif, created_at, last_login')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    const { nom, prenom, identifiant, role, password } = req.body;

    if (!nom || !prenom || !identifiant || !role || !password) {
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    const VALID_ROLES = ['LIVREUR', 'ADV', 'ADMIN','MAGASIN'];
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Rôle invalide' });
    }

    // Vérifier unicité identifiant
    const { data: existing } = await db
      .from('users')
      .select('id')
      .eq('identifiant', identifiant.toLowerCase().trim())
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Cet identifiant est déjà utilisé' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const { data, error } = await db
      .from('users')
      .insert({
        id: uuidv4(),
        nom,
        prenom,
        identifiant: identifiant.toLowerCase().trim(),
        password_hash,
        role,
        actif: true,
      })
      .select('id, nom, prenom, identifiant, role, actif, created_at')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    await log(session.users.identifiant, 'USER_CREATED', { target: data.identifiant, role: data.role });
    return res.status(201).json(data);
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
};
