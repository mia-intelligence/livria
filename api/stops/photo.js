const { getDB, getAdminDB } = require('../../lib/db');
const { requireRole } = require('../../lib/auth');

// Deux sortes de photos sur un stop :
//   colissage  — prise par le magasin à la préparation (ce qu'il faut charger)
//   livraison  — prise par le livreur au dépôt (où la marchandise a été laissée)
// Le magasin n'envoie que du colissage, le livreur que de la livraison.
const TYPES_PAR_ROLE = {
  MAGASIN: ['colissage'],
  LIVREUR: ['livraison'],
  ADMIN:   ['colissage', 'livraison'],
};

// Durée du lien signé. Une photo de dépôt sert de preuve : on la garde
// aussi longtemps que les stops (12 mois glissants).
const DUREE_LIEN = {
  colissage: 30  * 24 * 60 * 60,
  livraison: 365 * 24 * 60 * 60,
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const session = await requireRole(req, res, 'MAGASIN', 'ADMIN', 'LIVREUR');
  if (!session) return;
  const role = session.users.role;

  const { stop_id, image, content_type } = req.body;
  const type = req.body.type || TYPES_PAR_ROLE[role][0];

  if (!stop_id || !image) {
    return res.status(400).json({ error: 'stop_id et image requis' });
  }
  if (!TYPES_PAR_ROLE[role].includes(type)) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  const db      = getDB();
  const adminDb = getAdminDB();

  const { data: stop, error: stopErr } = await db
    .from('stops')
    .select('numero_affaire, date_tournee, societe_livraison')
    .eq('id', stop_id)
    .single();

  if (stopErr || !stop) return res.status(404).json({ error: 'Stop introuvable' });
  if (role === 'LIVREUR' && stop.societe_livraison !== 'ATRIAL') {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  const timestamp   = Date.now();
  const affaire     = (stop.numero_affaire || 'SANS-AFFAIRE').replace(/[^a-zA-Z0-9-]/g, '_');
  const dateTournee = (stop.date_tournee || new Date().toISOString().split('T')[0]).replace(/-/g, '');
  const ext         = (content_type || 'image/jpeg').includes('png') ? 'png' : 'jpg';
  const prefixe     = type === 'livraison' ? 'DEPOT_' : '';
  const fileName    = `${prefixe}${affaire}_${dateTournee}_${timestamp}.${ext}`;

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

  const { data: signedData, error: signErr } = await adminDb.storage
    .from('livraisons-photos')
    .createSignedUrl(fileName, DUREE_LIEN[type]);

  if (signErr) return res.status(500).json({ error: signErr.message });

  const photoUrl = signedData.signedUrl;

  const { error: insertErr } = await db
    .from('stop_photos')
    .insert({ stop_id, photo_url: photoUrl, type });

  if (insertErr) return res.status(500).json({ error: insertErr.message });

  // stops.photo_url = dernière photo de colissage (compatibilité)
  if (type === 'colissage') {
    await db
      .from('stops')
      .update({ photo_url: photoUrl, updated_at: new Date().toISOString() })
      .eq('id', stop_id);
  }

  return res.status(200).json({ photo_url: photoUrl, type });
};
