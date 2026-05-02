const { getDB } = require('../../lib/db');
const { getSession, clearSessionCookie } = require('../../lib/auth');
const cookie = require('cookie');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const cookies = cookie.parse(req.headers.cookie || '');
  const token = cookies.livrial_session;

  if (token) {
    const db = getDB();
    await db.from('sessions').delete().eq('token', token);
  }

  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
};
