const { createClient } = require('@supabase/supabase-js');

let client = null;
let adminClient = null;

function getDB() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis');
    client = createClient(url, key);
  }
  return client;
}

// Client service role — pour les opérations Storage (upload photos)
function getAdminDB() {
  if (!adminClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis');
    adminClient = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return adminClient;
}

module.exports = { getDB, getAdminDB };
