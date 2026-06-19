const { getDB } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const { log } = require('../../lib/log');

module.exports = async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  const { id } = req.query;
  const db = getDB();
  const role = session.users.role;

  if (req.method === 'GET') {
    const { data, error } = await db.from('stops').select('*, stop_photos(id, photo_url, created_at)').eq('id', id).single();
    if (error || !data) return res.status(404).json({ error: 'Stop introuvable' });

    // Livreur : seulement les stops ATRIAL
    if (role === 'LIVREUR' && data.societe_livraison !== 'ATRIAL') {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    return res.status(200).json(data);
  }

  if (req.method === 'PATCH') {
    const { statut, ordre, tournee, vehicule, societe_livraison, nombre_colis, emplacement, photo_url, magasin_valide, magasin_valide_at, commentaire_magasin, livreur_colis_confirme, type_produit, groupe_livraison, date_tournee, societe, adresse, telephone, numero_affaire, latitude, longitude } = req.body;
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
        // Sync societe_livraison avec la tournée
        if (tournee === 'ENLEVEMENT')        updates.societe_livraison = 'ENLEVEMENT';
        else if (tournee === 'TRANSPORTEUR') updates.societe_livraison = 'TRANSPORTEUR';
        else if (tournee)                    updates.societe_livraison = 'ATRIAL';
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
      if (nombre_colis !== undefined)          updates.nombre_colis          = nombre_colis;
      if (emplacement !== undefined)           updates.emplacement           = emplacement;
      if (photo_url !== undefined)             updates.photo_url             = photo_url;
      if (commentaire_magasin !== undefined)   updates.commentaire_magasin   = commentaire_magasin;
      if (magasin_valide !== undefined) {
        updates.magasin_valide = magasin_valide;
        updates.magasin_valide_at = magasin_valide ? (magasin_valide_at || new Date().toISOString()) : null;
      }
    }

    // Confirmation colis livreur
    if (livreur_colis_confirme !== undefined && ['LIVREUR', 'ADMIN'].includes(role)) {
      updates.livreur_colis_confirme = livreur_colis_confirme;
    }

    // Champs admin complets — ADMIN uniquement
    if (role === 'ADMIN') {
      if (societe !== undefined)          updates.societe          = societe;
      if (adresse !== undefined)          updates.adresse          = adresse;
      if (telephone !== undefined)        updates.telephone        = telephone;
      if (numero_affaire !== undefined)   updates.numero_affaire   = numero_affaire;
      if (latitude !== undefined)         updates.latitude         = latitude;
      if (longitude !== undefined)        updates.longitude        = longitude;
      if (societe_livraison !== undefined) {
        const VALID_SL = ['ATRIAL', 'ENLEVEMENT', 'TRANSPORTEUR'];
        if (!VALID_SL.includes(societe_livraison)) return res.status(400).json({ error: 'societe_livraison invalide' });
        updates.societe_livraison = societe_livraison;
      }
    }

    // Type produit et groupe livraison — ADV/ADMIN
    if (['ADV', 'ADMIN'].includes(role)) {
      if (date_tournee !== undefined) updates.date_tournee = date_tournee;
      if (type_produit !== undefined) {
        const VALID_TYPES = ['PVC', 'ALU', 'MIXTE'];
        if (type_produit !== null && !VALID_TYPES.includes(type_produit)) {
          return res.status(400).json({ error: 'type_produit invalide' });
        }
        updates.type_produit = type_produit;
      }
      if (groupe_livraison !== undefined) updates.groupe_livraison = groupe_livraison;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await db
      .from('stops')
      .update(updates)
      .eq('id', id)
      .select('*, stop_photos(id, photo_url, created_at)')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Stop introuvable' });

    // Log actions clés
    const userEmail = session.users.email;
    if (updates.statut) await log(userEmail, `STOP_${updates.statut}`, { stop_id: id, societe: data.societe });
    if (updates.magasin_valide) await log(userEmail, 'STOP_MAGASIN_VALIDE', { stop_id: id, societe: data.societe, colis: data.nombre_colis });
    if (updates.password_hash) await log(userEmail, 'PASSWORD_RESET', { stop_id: id });

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
