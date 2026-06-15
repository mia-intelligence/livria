const { getDB } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  const { id } = req.query;
  const db = getDB();
  const role = session.users.role;

  if (req.method === 'GET') {
    const { data, error } = await db.from('stops').select('*').eq('id', id).single();
    if (error || !data) return res.status(404).json({ error: 'Stop introuvable' });

    // Livreur : seulement les stops ATRIAL
    if (role === 'LIVREUR' && data.societe_livraison !== 'ATRIAL') {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    return res.status(200).json(data);
  }

  if (req.method === 'PATCH') {
    const { statut, ordre, tournee, vehicule, nombre_colis, emplacement, photo_url, magasin_valide, magasin_valide_at } = req.body;
    const VALID_STATUTS  = ['A_LIVRER', 'EN_COURS', 'LIVRE'];
    const VALID_TOURNEES = ['ENLEVEMENT','TOURNEE LUNDI','MARDI T06-T83EST','MERCREDI T13','TOURNEE JEUDI','VENDREDI T83 OUEST','LIVRAISON CHANTIER','TRANSPORTEUR'];
    const VALID_VEHICULES = ['PL', 'VL'];

    const updates = {};

    if (statut !== undefined) {
      if (!VALID_STATUTS.includes(statut)) {
        return res.status(400).json({ error: 'statut invalide' });
      }
      if (role === 'LIVREUR') {
        const { data: stop } = await db.from('stops').select('societe_livraison').eq('id', id).single();
        if (!stop || stop.societe_livraison !== 'ATRIAL') {
          return res.status(403).json({ error: 'Accès refusé' });
        }
      }
      updates.statut = statut;
    }

    if (ordre !== undefined && ['ADV', 'ADMIN'].includes(role)) {
      updates.ordre = ordre;
    }

    if (['ADV', 'ADMIN'].includes(role)) {
      if (tournee !== undefined) {
        if (tournee !== null && !VALID_TOURNEES.includes(tournee)) {
          return res.status(400).json({ error: 'tournee invalide' });
        }
        updates.tournee = tournee;
      }
      if (vehicule !== undefined) {
        if (vehicule !== null && !VALID_VEHICULES.includes(vehicule)) {
          return res.status(400).json({ error: 'vehicule invalide' });
        }
        updates.vehicule = vehicule;
      }
    }

    // Champs magasin — seul le rôle MAGASIN (et ADMIN) peut les modifier
    if (['MAGASIN', 'ADMIN'].includes(role)) {
      if (nombre_colis !== undefined) updates.nombre_colis = nombre_colis;
      if (emplacement !== undefined)  updates.emplacement  = emplacement;
      if (photo_url !== undefined)    updates.photo_url    = photo_url;
      if (magasin_valide !== undefined) {
        updates.magasin_valide = magasin_valide;
        updates.magasin_valide_at = magasin_valide ? (magasin_valide_at || new Date().toISOString()) : null;
      }
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await db
      .from('stops')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Stop introuvable' });
    return res.status(200).json(data);
  }

  if (req.method === 'DELETE') {
    if (!['ADV', 'ADMIN'].includes(role)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const { error } = await db.from('stops').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
};
