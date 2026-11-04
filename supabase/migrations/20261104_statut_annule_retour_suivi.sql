-- ══════════════════════════════════════════════════════════════════════════════
--  Retour Livrial → suivi d'affaires (décision Laëtitia, 04/11/2026)
--
--  Supabase sert de boîte aux lettres dans les deux sens. Le script Atrial
--  dépose déjà les affaires dans arc_commandes. Désormais, à chaque passage,
--  il relève aussi ce que Livrial a changé et le reporte dans le suivi :
--
--    1. stop passé « livré »  (statut LIVRE, heure dans livre_le)
--    2. stop passé « annulé » (statut ANNULE, heure dans annule_le)   ← nouveau
--    3. date de tournée modifiée par l'ADV (date_tournee, date_tournee_adv_le)
--
--  Ce fichier :
--    1. statut ANNULE sur stops (+ annule_le)
--    2. horodatages : statut_modifie_le, date_tournee_adv_le, retour_suivi_le
--    3. déclencheur qui pose ces horodatages à chaque modification
--    4. vue retour_suivi : les lignes que le script doit reporter
--    5. fonction retour_suivi_ack(ids) : le script marque les lignes traitées
--    6. rattrapage : les stops déjà livrés
--
--  À jouer dans Supabase > SQL Editor, AVANT le déploiement Livrial qui
--  ajoute le statut « annulé » (l'API l'envoie, la base doit l'accepter).
--  Rejouable sans risque.
--
--  ── Mode d'emploi pour le script (clé service_role) ───────────────────────
--    a. SELECT * FROM retour_suivi;
--         → une ligne par stop à reporter. statut_a_reporter / date_a_reporter
--           disent quoi reporter. numero_affaire identifie l'affaire.
--    b. Reporter dans le suivi : statut 'livre' (avec livre_le), 'annule',
--       et/ou la nouvelle date_tournee.
--    c. SELECT retour_suivi_ack(ARRAY['<stop_id>', ...]::uuid[]);
--         → les lignes traitées ne ressortent plus, sauf nouveau changement.
--       Une ligne non acquittée (écriture échouée) ressort au passage suivant.
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Statut « annulé »
ALTER TABLE stops DROP CONSTRAINT IF EXISTS stops_statut_check;
ALTER TABLE stops ADD CONSTRAINT stops_statut_check
  CHECK (statut IN ('A_LIVRER', 'EN_COURS', 'LIVRE', 'ANNULE'));

ALTER TABLE stops ADD COLUMN IF NOT EXISTS annule_le TIMESTAMPTZ;
COMMENT ON COLUMN stops.annule_le IS 'Date et heure du passage en ANNULE (ADV ou admin). NULL sinon.';

-- 2. Horodatages pour le retour vers le suivi
ALTER TABLE stops
  ADD COLUMN IF NOT EXISTS statut_modifie_le   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS date_tournee_adv_le TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retour_suivi_le     TIMESTAMPTZ;

COMMENT ON COLUMN stops.statut_modifie_le   IS 'Dernier changement de statut (posé par déclencheur). Sert au retour vers le suivi.';
COMMENT ON COLUMN stops.date_tournee_adv_le IS 'Dernier changement de date_tournee fait dans Livrial (ADV, admin). Jamais posé quand la date vient du suivi (set_config livrial.source = suivi).';
COMMENT ON COLUMN stops.retour_suivi_le     IS 'Dernier acquittement du script Atrial (retour_suivi_ack). Une ligne est à reporter tant que ses horodatages sont plus récents.';

-- 3. Déclencheur : horodate les changements à reporter
CREATE OR REPLACE FUNCTION stops_retour_suivi_horodatage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.statut IS DISTINCT FROM OLD.statut THEN
    NEW.statut_modifie_le := now();
    NEW.annule_le := CASE WHEN NEW.statut = 'ANNULE' THEN coalesce(NEW.annule_le, now()) ELSE NULL END;
  END IF;

  -- Date changée depuis Livrial. Quand c'est le suivi qui la pousse (futur
  -- déclencheur sur arc_commandes), il pose set_config('livrial.source',
  -- 'suivi', true) avant l'UPDATE pour ne pas la renvoyer en boucle.
  IF NEW.date_tournee IS DISTINCT FROM OLD.date_tournee
     AND coalesce(current_setting('livrial.source', true), '') <> 'suivi' THEN
    NEW.date_tournee_adv_le := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stops_retour_suivi_horodatage ON stops;
CREATE TRIGGER stops_retour_suivi_horodatage
  BEFORE UPDATE OF statut, date_tournee ON stops
  FOR EACH ROW EXECUTE FUNCTION stops_retour_suivi_horodatage();

-- 4. Vue lue par le script : ce que Livrial a changé et pas encore reporté
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
WHERE greatest(s.statut_modifie_le, s.date_tournee_adv_le)
        > coalesce(s.retour_suivi_le, '-infinity')
ORDER BY greatest(s.statut_modifie_le, s.date_tournee_adv_le);

COMMENT ON VIEW retour_suivi IS 'Lignes que le script Atrial doit reporter dans le suivi d''affaires, puis acquitter avec retour_suivi_ack(ids).';

-- 5. Acquittement : la ligne est marquée traitée jusqu'à son dernier
--    changement connu (pas « maintenant »), pour ne pas perdre un changement
--    survenu entre la lecture et l'acquittement.
CREATE OR REPLACE FUNCTION retour_suivi_ack(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE stops
     SET retour_suivi_le = greatest(statut_modifie_le, date_tournee_adv_le)
   WHERE id = ANY(p_ids)
     AND greatest(statut_modifie_le, date_tournee_adv_le) IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Accès réservé à la clé service_role (celle du script et de l'API Livrial)
REVOKE ALL ON retour_suivi FROM PUBLIC, anon, authenticated;
GRANT SELECT ON retour_suivi TO service_role;
REVOKE ALL ON FUNCTION retour_suivi_ack(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION retour_suivi_ack(uuid[]) TO service_role;

-- 6. Rattrapage
--    Les stops déjà livrés dans Livrial sont à reporter une fois…
UPDATE stops SET statut_modifie_le = livre_le
 WHERE statut = 'LIVRE' AND livre_le IS NOT NULL AND statut_modifie_le IS NULL;
--    … sauf ceux que le suivi connaît déjà comme livrés : on les acquitte.
UPDATE stops s SET retour_suivi_le = s.statut_modifie_le
  FROM arc_commandes c
 WHERE c.reference_complete = s.arc_reference
   AND c.statut_suivi = 'livre'
   AND s.statut = 'LIVRE'
   AND s.retour_suivi_le IS NULL;

-- Contrôle : ce que le script verra à son premier passage
-- SELECT numero_affaire, societe, statut, livre_le, statut_a_reporter, date_a_reporter FROM retour_suivi;

NOTIFY pgrst, 'reload schema';
