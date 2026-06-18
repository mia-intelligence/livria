const { getDB, getAdminDB } = require('../../lib/db');
const { requireRole } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const session = await requireRole(req, res, 'MAGASIN', 'ADMIN');
  if (!session) return;

  const { stop_id, image, content_type } = req.body;

  if (!stop_id || !image) {
    return res.status(400).json({ error: 'stop_id et image requis' });
  }

  const db      = getDB();
  const adminDb = getAdminDB();

  const { data: stop, error: stopErr } = await db
    .from('stops')
    .select('numero_affaire, date_tournee')
    .eq('id', stop_id)
    .single();

  if (stopErr || !stop) return res.status(404).json({ error: 'Stop introuvable' });

  const timestamp   = Date.now();
  const affaire     = (stop.numero_affaire || 'SANS-AFFAIRE').replace(/[^a-zA-Z0-9-]/g, '_');
  const dateTournee = (stop.date_tournee || new Date().toISOString().split('T')[0]).replace(/-/g, '');
  const ext         = (content_type || 'image/jpeg').includes('png') ? 'png' : 'jpg';
  const fileName    = `${affaire}_${dateTournee}_${timestamp}.${ext}`;

  let buffer;
  try {
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    buffer = Buffer.from(base64Data, 'base64');
  } catch {
    return res.status(400).json({ error: 'Image base64 invalide' });
  }

  const { error: uploadErr } = await adminDb.storage
    .from('livraisons-photos')
    .upload(fileName, buffer, {
      contentType: content_type || 'image/jpeg',
      upsert: false,
    });

  if (uploadErr) return res.status(500).json({ error: uploadErr.message });

  const THIRTY_DAYS = 30 * 24 * 60 * 60;
  const { data: signedData, error: signErr } = await adminDb.storage
    .from('livraisons-photos')
    .createSignedUrl(fileName, THIRTY_DAYS);

  if (signErr) return res.status(500).json({ error: signErr.message });

  const photoUrl = signedData.signedUrl;

  // Insert into stop_photos table
  const { error: insertErr } = await db
    .from('stop_photos')
    .insert({ stop_id, photo_url: photoUrl });

  if (insertErr) return res.status(500).json({ error: insertErr.message });

  // Keep stop.photo_url pointing to latest photo (backward compat)
  await db
    .from('stops')
    .update({ photo_url: photoUrl, updated_at: new Date().toISOString() })
    .eq('id', stop_id);

  return res.status(200).json({ photo_url: photoUrl });
};
