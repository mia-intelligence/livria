const { getDB } = require('./db');

async function log(userEmail, action, details = {}) {
  try {
    const db = getDB();
    await db.from('activity_logs').insert({ user_email: userEmail, action, details });
  } catch { /* non-bloquant */ }
}

module.exports = { log };
