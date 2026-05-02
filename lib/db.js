const { createClient } = require('@supabase/supabase-js');

let client = null;

function getDB() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_ANON_KEY requis');
    client = createClient(url, key);
  }
  return client;
}

module.exports = { getDB };
