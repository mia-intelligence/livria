const { getDB } = require('./db');
const cookie = require('cookie');

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 heures

async function getSession(req) {
  const cookies = cookie.parse(req.headers.cookie || '');
  const token = cookies.livrial_session;
  if (!token) return null;

  const db = getDB();
  const now = new Date().toISOString();

  const { data: session } = await db
    .from('sessions')
    .select('*, users(*)')
    .eq('token', token)
    .gt('expires_at', now)
    .single();

  if (!session) return null;

  // Vérifier que le compte est toujours actif
  if (!session.users?.actif) return null;

  return session;
}

function setSessionCookie(res, token) {
  const expires = new Date(Date.now() + SESSION_DURATION_MS);
  res.setHeader('Set-Cookie', cookie.serialize('livrial_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    expires,
    path: '/',
  }));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', cookie.serialize('livrial_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    expires: new Date(0),
    path: '/',
  }));
}

async function requireAuth(req, res) {
  const session = await getSession(req);
  if (!session) {
    res.status(401).json({ error: 'Non authentifié' });
    return null;
  }
  return session;
}

async function requireRole(req, res, ...roles) {
  const session = await requireAuth(req, res);
  if (!session) return null;
  if (!roles.includes(session.users.role)) {
    res.status(403).json({ error: 'Accès refusé' });
    return null;
  }
  return session;
}

module.exports = { getSession, setSessionCookie, clearSessionCookie, requireAuth, requireRole };
