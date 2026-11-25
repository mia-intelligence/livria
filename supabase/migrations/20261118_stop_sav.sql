-- ══════════════════════════════════════════════════════════════════════════════
--  Livraison SAV (demande Laëtitia, 18/11/2026)
--
--  Une livraison de dernière minute est souvent un ajout pour un client : pas
--  de commande ARC, une facture faite sur Prodevis. Elle ne passe donc pas par
--  le suivi d'affaires. L'ADV la crée avec « Nouvelle livraison » en cochant
--  « Livraison SAV ».
--
--  Ce fichier :
--    1. colonne stops.sav (faux par défaut : rien ne change pour l'existant)
--    2. vue retour_suivi : un stop SAV sans commande ARC n'est plus proposé au
--       script Atrial (il n'a aucune affaire où être reporté). Les colonnes de
--       la vue sont inchangées.
--
--  À jouer dans Supabase > SQL Editor, AVANT d'utiliser la case « Livraison
--  SAV » (sans la colonne, l'enregistrement d'un stop SAV est refusé ; le
--  reste de Livrial fonctionne normalement). Rejouable sans risque.
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Marqueur SAV
ALTER TABLE stops ADD COLUMN IF NOT EXISTS sav BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN stops.sav IS 'Livraison SAV : ajout pour un client, sans commande ARC, facturé sur Prodevis. Hors suivi d''affaires.';

-- 2. Vue lue par le script Atrial : identique à 20261104, sauf la première
--    condition du WHERE.
CREATE OR REPLACE VIEW retour_suivi AS
SELECT
  s.id                                   AS stop_id,
  s.numero_affaire,
  s.arc_reference,
  s.societe,
  s.statut,                              -- A_LIVRER | EN_COURS | LIVRE | ANNULE
  s.livre_le,
  s.annule_le,
  s.date_tournee,
  (s.statut_modifie_le IS NOT NULL
     AND s.statut_modifie_le > coalesce(s.retour_suivi_le, '-infinity'))   AS statut_a_reporter,
  (s.date_tournee_adv_le IS NOT NULL
     AND s.date_tournee_adv_le > coalesce(s.retour_suivi_le, '-infinity')) AS date_a_reporter,
  greatest(s.statut_modifie_le, s.date_tournee_adv_le)                     AS modifie_le,
  s.retour_suivi_le
FROM stops s
WHERE NOT (s.sav AND s.arc_reference IS NULL)
  AND greatest(s.statut_modifie_le, s.date_tournee_adv_le)
        > coalesce(s.retour_suivi_le, '-infinity')
ORDER BY greatest(s.statut_modifie_le, s.date_tournee_adv_le);

COMMENT ON VIEW retour_suivi IS 'Lignes que le script Atrial doit reporter dans le suivi d''affaires, puis acquitter avec retour_suivi_ack(ids). Les livraisons SAV sans commande ARC en sont exclues.';

REVOKE ALL ON retour_suivi FROM PUBLIC, anon, authenticated;
GRANT SELECT ON retour_suivi TO service_role;

NOTIFY pgrst, 'reload schema';
