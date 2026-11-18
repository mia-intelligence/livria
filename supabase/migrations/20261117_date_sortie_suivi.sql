-- ══════════════════════════════════════════════════════════════════════════════
--  Date de sortie corrigée dans le suivi d'affaires → Livrial
--  (décision Laëtitia, 17/11/2026 — affaire A-IN261196, Menuiserie Molineri)
--
--  Quand une date de sortie est modifiée dans le suivi (report convenu avec le
--  client), Livrial ne le savait pas : le suivi n'envoyait que le statut.
--  L'affaire restait à la date de l'ARC dans le planning des sorties, avec
--  l'étiquette « Retard » à tort.
--
--  Désormais le suivi envoie aussi la date corrigée, dans une colonne à part :
--  la date lue sur l'ARC (date_livraison_prevue) n'est jamais écrasée, et une
--  nouvelle version de l'ARC n'efface pas le report.
--
--  Ce fichier :
--    1. colonne arc_commandes.date_sortie_suivi (NULL = date de l'ARC)
--    2. creer_stop_depuis_arc() : le stop automatique prend la date du suivi
--       quand elle existe, sinon celle de l'ARC (comme avant)
--    3. déclencheur : quand la date du suivi change, le stop pas encore sorti
--       de l'affaire se déplace à la nouvelle date (« le stop suit le suivi »)
--
--  Règles du déplacement (point 3) :
--    - seulement un stop « à livrer » : ni en cours, ni livré, ni annulé ;
--    - jamais vers une journée déjà passée (incident du 29/10/2026) ;
--    - la date est marquée « venue du suivi » : elle n'est pas renvoyée au
--      suivi par la vue retour_suivi (pas de boucle) ;
--    - si l'ADV déplace ensuite le stop à la main, sa date tient jusqu'au
--      prochain changement de date dans le suivi : le dernier qui parle
--      l'emporte.
--
--  À jouer dans Supabase > SQL Editor, APRÈS 20261104_statut_annule_retour_suivi.sql
--  et AVANT le déploiement Livrial qui lit la colonne (planning des sorties).
--  Rejouable sans risque. Tant que le script Atrial n'envoie pas de date, la
--  colonne reste vide et rien ne change.
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Date de sortie corrigée dans le suivi
ALTER TABLE arc_commandes ADD COLUMN IF NOT EXISTS date_sortie_suivi DATE;
COMMENT ON COLUMN arc_commandes.date_sortie_suivi IS
  'Date de sortie corrigée dans le suivi d''affaires (envoyée par le script Atrial). NULL : la date de l''ARC (date_livraison_prevue) fait foi.';

-- 2. Création d'un stop depuis une commande ARC : identique à la version du
--    29/10/2026, sauf la date de départ (date du suivi d'abord).
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
  -- NOUVEAU : la date corrigée dans le suivi l'emporte sur celle de l'ARC
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

  v_mode := CASE WHEN c.mode_livraison IN ('ATRIAL', 'ENLEVEMENT', 'TRANSPORTEUR')
                 THEN c.mode_livraison ELSE 'ATRIAL' END;

  -- Tournée : enlèvement et transporteur ont la leur ; pour une livraison
  -- Atrial, elle vient du code postal (champ de l'ARC, sinon lu dans l'adresse).
  v_cp := coalesce(nullif(trim(coalesce(c.code_postal, '')), ''), v_adresse);
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
    nullif(trim(coalesce(c.mobile_client, c.telephone_client, '')), ''),
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

-- 3. Le stop suit la date du suivi
CREATE OR REPLACE FUNCTION arc_commandes_date_sortie_suivi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_aujourdhui date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_source     text := coalesce(current_setting('livrial.source', true), '');
BEGIN
  IF NEW.date_sortie_suivi IS NULL
     OR NEW.date_sortie_suivi IS NOT DISTINCT FROM OLD.date_sortie_suivi
     OR NEW.date_sortie_suivi < v_aujourdhui THEN
    RETURN NEW;
  END IF;

  -- La date vient du suivi : le déclencheur des stops ne la marque pas comme
  -- une modification de l'ADV (elle ne repart pas vers le suivi).
  PERFORM set_config('livrial.source', 'suivi', true);
  UPDATE stops
     SET date_tournee = NEW.date_sortie_suivi
   WHERE arc_reference = NEW.reference_complete
     AND statut = 'A_LIVRER'
     AND date_tournee IS DISTINCT FROM NEW.date_sortie_suivi;
  PERFORM set_config('livrial.source', v_source, true);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS arc_commandes_date_sortie_suivi ON arc_commandes;
CREATE TRIGGER arc_commandes_date_sortie_suivi
  AFTER UPDATE OF date_sortie_suivi ON arc_commandes
  FOR EACH ROW EXECUTE FUNCTION arc_commandes_date_sortie_suivi();

-- Contrôle : les affaires dont la date a été corrigée dans le suivi
-- SELECT c.numero_document, c.societe, c.statut_suivi, c.date_livraison_prevue, c.date_sortie_suivi, s.date_tournee
--   FROM arc_commandes c LEFT JOIN stops s ON s.arc_reference = c.reference_complete
--  WHERE c.date_sortie_suivi IS NOT NULL ORDER BY c.date_sortie_suivi;

NOTIFY pgrst, 'reload schema';
