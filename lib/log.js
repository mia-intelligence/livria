const { getDB } = require('./db');

async function log(userIdentifiant, action, details = {}) {
  try {
    const db = getDB();
    await db.from('activity_logs').insert({ user_identifiant: userIdentifiant, action, details });
  } catch { /* non-bloquant */ }
}

module.exports = { log };
