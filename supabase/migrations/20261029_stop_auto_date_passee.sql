-- ══════════════════════════════════════════════════════════════════════════════
--  Stop automatique : jamais planifié dans une journée déjà passée
--  (incident du 29/10/2026, affaire A-IN261772)
--
--  L'affaire est passée « fini » le 28/10 au soir ; son ARC portait une date
--  de livraison prévue au 26/10. Le déclencheur a donc placé le stop dans la
--  tournée du 26/10 : une journée passée, que ni « Affaires à planifier »
--  (stop considéré comme placé) ni « Tournée du jour » (autre date)
--  n'affichent. Le stop était introuvable dans la console ADV.
--
--  Ce fichier :
--    1. creer_stop_depuis_arc() : si la date de livraison de l'ARC est passée,
--       le stop est créé SANS date et reste « à planifier » (badge « Date à
--       fixer ») ; l'ADV lui choisit une nouvelle date. La tournée déduite
--       est conservée pour pré-remplir la fenêtre « Planifier ».
--    2. rattrapage : les stops automatiques encore « à livrer » rangés dans
--       une journée passée reviennent dans « Affaires à planifier ».
--
--  À jouer dans Supabase > SQL Editor, APRÈS 20261022_planification_auto.sql.
--  Rejouable sans risque.
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Création d'un stop depuis une commande ARC
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
  v_date     date    := c.date_livraison_prevue;
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

  -- NOUVEAU : une date de livraison déjà passée n'est pas une date de tournée.
  -- Le stop part sans date et reste « à planifier » ; l'ADV en fixe une.
  IF v_date IS NOT NULL AND v_date < v_aujourdhui THEN
    v_date := NULL;
  END IF;

  -- Date de livraison à venir ET tournée connues : le stop prend la dernière
  -- place de la journée (comme le bouton « Planifier » de l'ADV). Sinon
  -- ordre 99 : il reste dans « Affaires à planifier ».
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

-- 2. Rattrapage : stops automatiques encore « à livrer », placés dans une
--    journée passée (date antérieure à aujourd'hui, ordre ≠ 99). Ils
--    reviennent dans « Affaires à planifier » sans date ; la tournée et la
--    validation magasin sont conservées.
--
--    Contrôle avant exécution (liste de ce qui va bouger) :
--    SELECT societe, numero_affaire, date_tournee, tournee, ordre, magasin_valide
--      FROM stops
--     WHERE origine = 'auto_fini' AND statut = 'A_LIVRER' AND ordre <> 99
--       AND date_tournee < (now() AT TIME ZONE 'Europe/Paris')::date;
UPDATE stops
   SET date_tournee = NULL, ordre = 99
 WHERE origine = 'auto_fini'
   AND statut  = 'A_LIVRER'
   AND ordre  <> 99
   AND date_tournee < (now() AT TIME ZONE 'Europe/Paris')::date;

-- Contrôle après exécution : l'affaire de l'incident doit être « à planifier »
-- SELECT societe, numero_affaire, date_tournee, tournee, ordre
--   FROM stops WHERE numero_affaire = 'A-IN261772';
--   → date_tournee NULL, ordre 99

NOTIFY pgrst, 'reload schema';
