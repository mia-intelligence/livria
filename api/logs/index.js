const { getDB } = require('../../lib/db');
const { requireRole } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  const session = await requireRole(req, res, 'ADMIN');
  if (!session) return;

  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' });

  const db = getDB();
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);

  const { data, error } = await db
    .from('activity_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json(data);
};
