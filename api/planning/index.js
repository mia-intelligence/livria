const { getDB } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Paramètres from et to requis' });

  const db = getDB();

  const { data, error } = await db
    .from('stops')
    .select('date_tournee, statut')
    .gte('date_tournee', from)
    .lte('date_tournee', to);

  if (error) return res.status(500).json({ error: error.message });

  const result = {};
  for (const stop of data) {
    const d = stop.date_tournee;
    if (!d) continue;
    if (!result[d]) result[d] = { total: 0, livre: 0, en_cours: 0, a_livrer: 0 };
    result[d].total++;
    if (stop.statut === 'LIVRE')    result[d].livre++;
    else if (stop.statut === 'EN_COURS') result[d].en_cours++;
    else                             result[d].a_livrer++;
  }

  return res.status(200).json(result);
};
