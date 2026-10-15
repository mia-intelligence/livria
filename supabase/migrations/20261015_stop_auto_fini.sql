-- ══════════════════════════════════════════════════════════════════════════════
--  Nouveau circuit de livraison (décision Laëtitia, 15/10/2026)
--
--    affaire « fini » dans le suivi d'affaires
--      → stop créé AUTOMATIQUEMENT (plus d'action de l'ADV)
--      → le magasin le voit « à préparer », même sans date de tournée
--      → le magasin valide → l'ADV corrige l'adresse, place date + tournée
--      → le livreur ne voit que les stops validés magasin ET placés en tournée
--      → le livreur marque livré (photo du dépôt facultative) → retour vers le suivi
--
--  Ce fichier :
--    1. stops.date_tournee peut être vide (stop auto sans date prévue sur l'ARC)
--    2. stops.origine, stops.livre_le
--    3. stop_photos.type : colissage (magasin) ou livraison (livreur)
--    4. fonction creer_stop_depuis_arc() + déclencheur sur arc_commandes.statut_suivi
--    5. rattrapage : un stop pour chaque affaire déjà « fini » sans stop
--
--  À jouer dans Supabase > SQL Editor. Rejouable sans risque.
--  ORDRE : cette migration AVANT le push Livrial (l'API lit stop_photos.type).
--  Vérifier ensuite : SELECT count(*) FROM stops WHERE origine = 'auto_fini';
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Date de tournée facultative (le défaut CURRENT_DATE reste pour le webhook)
ALTER TABLE stops ALTER COLUMN date_tournee DROP NOT NULL;

-- 2. Origine du stop et horodatage de la livraison
ALTER TABLE stops
  ADD COLUMN IF NOT EXISTS origine  TEXT,
  ADD COLUMN IF NOT EXISTS livre_le TIMESTAMPTZ;

COMMENT ON COLUMN stops.origine  IS 'auto_fini = créé par le déclencheur quand l''affaire passe « fini » ; adv = saisi dans la console ; webhook = Make.';
COMMENT ON COLUMN stops.livre_le IS 'Date et heure du clic « Marquer comme livré » (livreur ou ADV). NULL tant que non livré.';

CREATE INDEX IF NOT EXISTS stops_magasin_valide_idx ON stops (magasin_valide) WHERE magasin_valide = false;

-- 3. Type de photo
ALTER TABLE stop_photos
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'colissage';

DO $$ BEGIN
  ALTER TABLE stop_photos ADD CONSTRAINT stop_photos_type_check CHECK (type IN ('colissage', 'livraison'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN stop_photos.type IS 'colissage = prise par le magasin à la préparation ; livraison = prise par le livreur au dépôt (preuve).';

-- 4. Création d'un stop depuis une commande ARC
--    Renvoie l'id du stop créé, NULL si rien n'a été créé (stop déjà présent,
--    commande masquée par l'ADV, document hors sujet).
CREATE OR REPLACE FUNCTION creer_stop_depuis_arc(c arc_commandes)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id       uuid;
  v_numero   text := upper(trim(coalesce(c.numero_document, '')));
  v_adresse  text;
  v_mode     text;
BEGIN
  -- Document hors sujet (devis, sans numéro)
  IF v_numero = '' THEN RETURN NULL; END IF;
  IF c.type_document IS NOT NULL AND c.type_document <> 'ARC' THEN RETURN NULL; END IF;

  -- Déjà un stop : par la clé exacte, ou par le numéro d'affaire (stops anciens)
  IF EXISTS (SELECT 1 FROM stops s
             WHERE s.arc_reference = c.reference_complete
                OR upper(trim(coalesce(s.numero_affaire, ''))) = v_numero) THEN
    RETURN NULL;
  END IF;

  -- Masquée par l'ADV (livrée hors Livrial, annulée…)
  IF to_regclass('public.arc_masques') IS NOT NULL
     AND EXISTS (SELECT 1 FROM arc_masques m WHERE m.reference_complete = c.reference_complete) THEN
    RETURN NULL;
  END IF;

  -- Adresse de facturation par défaut ; l'ADV la corrige en planifiant
  v_adresse := concat_ws(', ',
                 nullif(trim(coalesce(c.adresse_facturation, '')), ''),
                 nullif(trim(concat_ws(' ', c.code_postal, c.ville)), ''));
  IF v_adresse IS NULL OR v_adresse = '' THEN v_adresse := 'Adresse à compléter'; END IF;

  v_mode := CASE WHEN c.mode_livraison IN ('ATRIAL', 'ENLEVEMENT', 'TRANSPORTEUR')
                 THEN c.mode_livraison ELSE 'ATRIAL' END;

  INSERT INTO stops (
    societe, adresse, telephone, numero_affaire,
    societe_livraison, tournee, vehicule,
    statut, ordre, date_tournee,
    type_produit, reference_client, arc_reference, origine
  ) VALUES (
    coalesce(nullif(trim(coalesce(c.societe, '')), ''), c.reference_complete),
    v_adresse,
    nullif(trim(coalesce(c.mobile_client, c.telephone_client, '')), ''),
    c.numero_document,
    v_mode,
    CASE WHEN v_mode IN ('ENLEVEMENT', 'TRANSPORTEUR') THEN v_mode ELSE NULL END,
    NULL,
    'A_LIVRER', 99, c.date_livraison_prevue,
    CASE WHEN c.gamme IN ('PVC', 'ALU', 'MIXTE') THEN c.gamme ELSE NULL END,
    nullif(trim(coalesce(c.reference, '')), ''),
    c.reference_complete,
    'auto_fini'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Déclencheur : au passage à « fini » (et seulement à ce passage)
CREATE OR REPLACE FUNCTION arc_commandes_stop_auto()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.statut_suivi IS DISTINCT FROM 'fini' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.statut_suivi = 'fini' THEN RETURN NEW; END IF;
  PERFORM creer_stop_depuis_arc(NEW);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS arc_commandes_stop_auto ON arc_commandes;
CREATE TRIGGER arc_commandes_stop_auto
  AFTER INSERT OR UPDATE OF statut_suivi ON arc_commandes
  FOR EACH ROW EXECUTE FUNCTION arc_commandes_stop_auto();

-- 5. Rattrapage : les affaires déjà « fini » sans stop
SELECT count(creer_stop_depuis_arc(c)) AS stops_crees
FROM arc_commandes c
WHERE c.statut_suivi = 'fini';

NOTIFY pgrst, 'reload schema';
