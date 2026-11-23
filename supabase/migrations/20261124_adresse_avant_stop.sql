-- ══════════════════════════════════════════════════════════════════════════════
--  Adresse de livraison saisie avant que l'affaire soit finie
--  (décision Laëtitia, 23/11/2026)
--
--  L'adresse de livraison ne se corrige que dans Livrial (le suivi d'affaires
--  n'a pas d'écran pour cela). Or une affaire apparaît dans le planning des
--  sorties dès sa mise en fabrication, bien avant d'avoir un stop : il n'y
--  avait alors nulle part où noter la bonne adresse.
--
--  Désormais l'ADV la saisit depuis la fiche du planning des sorties. Elle est
--  gardée dans une table à part, que le script Atrial ne lit ni n'écrit (il
--  réécrit arc_commandes à chaque passage). Quand l'affaire passe « fini », le
--  stop automatique naît avec cette adresse et ce téléphone.
--
--  Ce fichier :
--    1. table arc_adresses_livraison
--    2. creer_stop_depuis_arc() : identique à la version du 17/11/2026, sauf
--       l'adresse et le téléphone (saisie de l'ADV d'abord)
--
--  À jouer dans Supabase > SQL Editor, APRÈS 20261117_date_sortie_suivi.sql et
--  AVANT le déploiement Livrial qui lit la table. Rejouable sans risque.
--  Aucune donnée existante n'est modifiée.
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Adresse de livraison saisie par l'ADV pour une commande sans stop
CREATE TABLE IF NOT EXISTS arc_adresses_livraison (
  reference_complete TEXT        PRIMARY KEY,
  adresse            TEXT,
  telephone          TEXT,
  modifie_par        TEXT,
  modifie_le         TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE arc_adresses_livraison IS
  'Adresse de livraison et téléphone saisis par l''ADV depuis le planning des sorties, pour une commande ARC qui n''a pas encore de stop. Repris à la création du stop automatique.';

-- Comme les autres tables : RLS sans policy, accès par la clé service_role (API Livrial)
ALTER TABLE arc_adresses_livraison ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON arc_adresses_livraison FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON arc_adresses_livraison TO service_role;

-- 2. Création d'un stop depuis une commande ARC
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
  v_saisie   arc_adresses_livraison%ROWTYPE;   -- NOUVEAU : adresse saisie par l'ADV avant le stop
  -- La date corrigée dans le suivi l'emporte sur celle de l'ARC
  v_date     date    := coalesce(c.date_sortie_suivi, c.date_livraison_prevue);
  -- Date du jour en heure française (la base tourne en UTC)
  v_aujourdhui date  := (now() AT TIME ZONE 'Europe/Paris')::date;
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

  -- NOUVEAU : l'adresse de livraison saisie par l'ADV depuis le planning des
  -- sorties, avant que l'affaire soit finie, l'emporte sur celle de l'ARC.
  SELECT * INTO v_saisie FROM arc_adresses_livraison a WHERE a.reference_complete = c.reference_complete;
  IF nullif(trim(coalesce(v_saisie.adresse, '')), '') IS NOT NULL THEN
    v_adresse := trim(v_saisie.adresse);
  END IF;

  v_mode := CASE WHEN c.mode_livraison IN ('ATRIAL', 'ENLEVEMENT', 'TRANSPORTEUR')
                 THEN c.mode_livraison ELSE 'ATRIAL' END;

  -- Tournée : enlèvement et transporteur ont la leur ; pour une livraison
  -- Atrial, elle vient du code postal. Adresse saisie par l'ADV avec un code
  -- postal : on le lit dedans (le chantier n'est pas forcément dans la commune
  -- de facturation) ; sinon champ de l'ARC, à défaut lu dans l'adresse.
  v_cp := CASE WHEN trim(coalesce(v_saisie.adresse, '')) ~ '\m\d{5}\M' THEN v_adresse
               ELSE coalesce(nullif(trim(coalesce(c.code_postal, '')), ''), v_adresse) END;
  v_tournee := CASE WHEN v_mode IN ('ENLEVEMENT', 'TRANSPORTEUR') THEN v_mode
                    ELSE tournee_depuis_cp(v_cp) END;

  -- Une date déjà passée n'est pas une date de tournée. Le stop part sans
  -- date et reste « à planifier » ; l'ADV en fixe une.
  IF v_date IS NOT NULL AND v_date < v_aujourdhui THEN
    v_date := NULL;
  END IF;

  -- Date à venir ET tournée connues : le stop prend la dernière place de la
  -- journée (comme le bouton « Planifier » de l'ADV). Sinon ordre 99 : il
  -- reste dans « Affaires à planifier ».
  IF v_date IS NOT NULL AND v_tournee IS NOT NULL THEN
    SELECT coalesce(max(s.ordre), 0) + 1 INTO v_ordre
    FROM stops s
    WHERE s.date_tournee = v_date AND s.ordre <> 99;
  END IF;

  INSERT INTO stops (
    societe, adresse, telephone, numero_affaire,
    societe_livraison, tournee, vehicule, lieu_livraison, adresse_verifiee,
    statut, ordre, date_tournee,
    type_produit, reference_client, arc_reference, origine
  ) VALUES (
    coalesce(nullif(trim(coalesce(c.societe, '')), ''), c.reference_complete),
    v_adresse,
    coalesce(nullif(trim(coalesce(v_saisie.telephone, '')), ''),
             nullif(trim(coalesce(c.mobile_client, c.telephone_client, '')), '')),
    c.numero_document,
    v_mode,
    v_tournee,
    'PL',
    'CHANTIER',
    FALSE,
    'A_LIVRER', v_ordre, v_date,
    CASE WHEN c.gamme IN ('PVC', 'ALU', 'MIXTE') THEN c.gamme ELSE NULL END,
    nullif(trim(coalesce(c.reference, '')), ''),
    c.reference_complete,
    'auto_fini'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
