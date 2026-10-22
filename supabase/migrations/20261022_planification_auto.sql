-- ══════════════════════════════════════════════════════════════════════════════
--  Planification automatique des stops (retour terrain, 22/10/2026)
--
--    affaire « fini » → stop créé automatiquement (migration du 15/10)
--      → NOUVEAU : la tournée est déduite du code postal (mêmes règles que la
--        suggestion de la console ADV) et, si l'ARC porte une date de
--        livraison, le stop prend directement sa place dans la tournée du jour.
--        Sans date ou sans code postal connu, il reste « à planifier ».
--      → NOUVEAU : véhicule « PL » d'office, l'ADV le change au besoin.
--      → NOUVEAU : lieu de livraison « chantier » ou « dépôt », choisi par
--        l'ADV, affiché au livreur. Chantier par défaut.
--
--  Ce fichier :
--    1. stops.lieu_livraison (CHANTIER | DEPOT)
--    2. fonction tournee_depuis_cp(code_postal) — règles ADV en SQL
--    3. creer_stop_depuis_arc() : tournée, véhicule PL, ordre dans la journée
--    4. rattrapage : stops automatiques déjà créés mais pas encore planifiés
--
--  À jouer dans Supabase > SQL Editor, APRÈS 20261015_stop_auto_fini.sql.
--  Rejouable sans risque.
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Lieu de livraison
ALTER TABLE stops
  ADD COLUMN IF NOT EXISTS lieu_livraison TEXT NOT NULL DEFAULT 'CHANTIER';

DO $$ BEGIN
  ALTER TABLE stops ADD CONSTRAINT stops_lieu_livraison_check
    CHECK (lieu_livraison IN ('CHANTIER', 'DEPOT'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN stops.lieu_livraison IS 'CHANTIER = livraison sur le chantier du client ; DEPOT = livraison au dépôt du client. Choisi par l''ADV, affiché au livreur.';

-- 2. Tournée déduite du code postal (même table de règles que adv.js, TOURNEE_RULES)
--    06xxx            → MARDI T06-T83EST
--    13xxx            → MERCREDI T13
--    83400 et plus    → MARDI T06-T83EST   (Var Est : Hyères, Fréjus, Saint-Tropez…)
--    83000 à 83399    → VENDREDI T83 OUEST (Toulon, La Seyne, Brignoles…)
--    autre / inconnu  → NULL (le stop reste à planifier)
CREATE OR REPLACE FUNCTION tournee_depuis_cp(p_cp text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  cp text := substring(coalesce(p_cp, '') from '\m(\d{5})\M');
BEGIN
  IF cp IS NULL THEN RETURN NULL; END IF;
  IF cp LIKE '06%' THEN RETURN 'MARDI T06-T83EST'; END IF;
  IF cp LIKE '13%' THEN RETURN 'MERCREDI T13'; END IF;
  IF cp LIKE '83%' THEN
    RETURN CASE WHEN cp::int >= 83400 THEN 'MARDI T06-T83EST' ELSE 'VENDREDI T83 OUEST' END;
  END IF;
  RETURN NULL;
END;
$$;

-- 3. Création d'un stop depuis une commande ARC, désormais planifié d'office
--    quand c'est possible. Renvoie l'id du stop créé, NULL sinon.
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
  v_cp       text;
  v_tournee  text;
  v_ordre    integer := 99;
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

  -- Tournée : enlèvement et transporteur ont la leur ; pour une livraison
  -- Atrial, elle vient du code postal (champ de l'ARC, sinon lu dans l'adresse).
  v_cp := coalesce(nullif(trim(coalesce(c.code_postal, '')), ''), v_adresse);
  v_tournee := CASE WHEN v_mode IN ('ENLEVEMENT', 'TRANSPORTEUR') THEN v_mode
                    ELSE tournee_depuis_cp(v_cp) END;

  -- Date de livraison ET tournée connues : le stop prend la dernière place
  -- de la journée (comme le bouton « Planifier » de l'ADV). Sinon ordre 99 :
  -- il reste dans « Affaires à planifier ».
  IF c.date_livraison_prevue IS NOT NULL AND v_tournee IS NOT NULL THEN
    SELECT coalesce(max(s.ordre), 0) + 1 INTO v_ordre
    FROM stops s
    WHERE s.date_tournee = c.date_livraison_prevue AND s.ordre <> 99;
  END IF;

  INSERT INTO stops (
    societe, adresse, telephone, numero_affaire,
    societe_livraison, tournee, vehicule, lieu_livraison,
    statut, ordre, date_tournee,
    type_produit, reference_client, arc_reference, origine
  ) VALUES (
    coalesce(nullif(trim(coalesce(c.societe, '')), ''), c.reference_complete),
    v_adresse,
    nullif(trim(coalesce(c.mobile_client, c.telephone_client, '')), ''),
    c.numero_document,
    v_mode,
    v_tournee,
    'PL',
    'CHANTIER',
    'A_LIVRER', v_ordre, c.date_livraison_prevue,
    CASE WHEN c.gamme IN ('PVC', 'ALU', 'MIXTE') THEN c.gamme ELSE NULL END,
    nullif(trim(coalesce(c.reference, '')), ''),
    c.reference_complete,
    'auto_fini'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 4. Rattrapage des stops automatiques déjà créés et pas encore planifiés
--    (ni livrés). Même logique que ci-dessus, stop par stop pour que les
--    ordres s'enchaînent correctement dans une même journée.
UPDATE stops SET vehicule = 'PL'
WHERE vehicule IS NULL AND origine = 'auto_fini' AND statut = 'A_LIVRER';

DO $$
DECLARE
  r       record;
  v_t     text;
  v_ordre integer;
BEGIN
  FOR r IN
    SELECT s.id, s.adresse, s.societe_livraison, s.date_tournee, s.tournee, c.code_postal
    FROM stops s
    LEFT JOIN arc_commandes c ON c.reference_complete = s.arc_reference
    WHERE s.origine = 'auto_fini' AND s.statut = 'A_LIVRER' AND s.ordre = 99
      AND s.date_tournee IS NOT NULL
    ORDER BY s.date_tournee, s.created_at
  LOOP
    v_t := coalesce(r.tournee,
             CASE WHEN r.societe_livraison IN ('ENLEVEMENT', 'TRANSPORTEUR') THEN r.societe_livraison
                  ELSE tournee_depuis_cp(coalesce(nullif(trim(coalesce(r.code_postal, '')), ''), r.adresse)) END);
    IF v_t IS NULL THEN CONTINUE; END IF;

    SELECT coalesce(max(s.ordre), 0) + 1 INTO v_ordre
    FROM stops s WHERE s.date_tournee = r.date_tournee AND s.ordre <> 99;

    UPDATE stops SET tournee = v_t, ordre = v_ordre WHERE id = r.id;
  END LOOP;
END $$;

-- Contrôle :
-- SELECT societe, date_tournee, tournee, vehicule, ordre, lieu_livraison
--   FROM stops WHERE origine = 'auto_fini' ORDER BY date_tournee, ordre;

NOTIFY pgrst, 'reload schema';
