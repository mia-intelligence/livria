-- ══════════════════════════════════════════════════════════════════════════════
--  Affaire « Livrée » dans le suivi d'affaires → le stop Livrial se ferme
--  (décision Laëtitia, 23/11/2026)
--
--  Constat : quand une affaire passe « Livrée » dans le suivi (clic dans
--  l'application, bon de livraison), son stop restait « à livrer » dans
--  Livrial. Au 23/11, 185 stops ouverts sur 262 étaient dans ce cas : ils
--  encombraient les listes de l'ADV et gonflaient les « adresses à vérifier ».
--
--  Règle : ce que dit le suivi fait foi.
--    - statut_suivi passe à « livre »  → les stops ouverts de l'affaire
--      (à livrer, en cours) passent LIVRE ;
--    - date de livraison : celle du suivi. arc_commandes.date_livraison quand
--      elle est connue (à midi, heure française), sinon le moment où le suivi
--      a passé l'affaire en « livre » (statut_suivi_le). Jamais dans le futur ;
--    - si le suivi corrige ensuite cette date, le stop fermé par le suivi suit ;
--    - si le suivi revient en arrière (affaire livrée par erreur), le stop
--      fermé par le suivi se rouvre. Un stop livré par le livreur ou par l'ADV
--      n'est jamais rouvert ni redaté par le suivi.
--
--  Ce fichier :
--    1. colonne stops.livre_par_suivi_le (NULL : stop livré dans Livrial)
--    2. déclencheur des stops : un changement venu du suivi ne repart pas vers
--       le suivi (vue retour_suivi), comme pour la date depuis le 17/11
--    3. déclencheur sur arc_commandes : le stop suit le statut « livre »
--    4. rattrapage : les stops ouverts des affaires déjà livrées
--
--  À jouer dans Supabase > SQL Editor, APRÈS 20261117_date_sortie_suivi.sql.
--  Rejouable sans risque.
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Marqueur : le stop a été fermé par le suivi d'affaires
ALTER TABLE stops ADD COLUMN IF NOT EXISTS livre_par_suivi_le TIMESTAMPTZ;
COMMENT ON COLUMN stops.livre_par_suivi_le IS
  'Moment où le suivi d''affaires a fermé ce stop (affaire passée « livre »). NULL : stop livré dans Livrial (livreur, ADV, admin).';

-- 2. Déclencheur des stops : identique à la version du 04/11/2026, sauf qu'un
--    changement de statut venu du suivi n'est pas marqué « à reporter », et
--    qu'un changement de statut fait dans Livrial efface le marqueur.
CREATE OR REPLACE FUNCTION stops_retour_suivi_horodatage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_suivi boolean := coalesce(current_setting('livrial.source', true), '') = 'suivi';
BEGIN
  IF NEW.statut IS DISTINCT FROM OLD.statut THEN
    IF NOT v_suivi THEN
      NEW.statut_modifie_le  := now();
      NEW.livre_par_suivi_le := NULL;
    END IF;
    NEW.annule_le := CASE WHEN NEW.statut = 'ANNULE' THEN coalesce(NEW.annule_le, now()) ELSE NULL END;
  END IF;

  IF NEW.date_tournee IS DISTINCT FROM OLD.date_tournee AND NOT v_suivi THEN
    NEW.date_tournee_adv_le := now();
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Le stop suit le statut « livre » du suivi
CREATE OR REPLACE FUNCTION arc_commandes_stop_livre_suivi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source text := coalesce(current_setting('livrial.source', true), '');
  v_quand  timestamptz;
BEGIN
  IF NEW.statut_suivi = 'livre' THEN
    -- Date de livraison d'après le suivi, jamais dans le futur
    v_quand := least(
      coalesce((NEW.date_livraison + time '12:00') AT TIME ZONE 'Europe/Paris', NEW.statut_suivi_le, now()),
      now());

    PERFORM set_config('livrial.source', 'suivi', true);
    -- Stops encore ouverts : ils se ferment
    UPDATE stops
       SET statut = 'LIVRE', livre_le = v_quand, livre_par_suivi_le = now()
     WHERE arc_reference = NEW.reference_complete
       AND statut IN ('A_LIVRER', 'EN_COURS');
    -- Stops déjà fermés par le suivi : ils suivent une date corrigée
    UPDATE stops
       SET livre_le = v_quand
     WHERE arc_reference = NEW.reference_complete
       AND statut = 'LIVRE'
       AND livre_par_suivi_le IS NOT NULL
       AND livre_le IS DISTINCT FROM v_quand;
    PERFORM set_config('livrial.source', v_source, true);

  ELSIF TG_OP = 'UPDATE' AND OLD.statut_suivi = 'livre' AND NEW.statut_suivi IS NOT NULL THEN
    -- Le suivi revient en arrière : le stop qu'il avait fermé se rouvre.
    -- (Un statut vide ne rouvre rien : ce n'est pas une décision du suivi.)
    PERFORM set_config('livrial.source', 'suivi', true);
    UPDATE stops
       SET statut = 'A_LIVRER', livre_le = NULL, livre_par_suivi_le = NULL
     WHERE arc_reference = NEW.reference_complete
       AND statut = 'LIVRE'
       AND livre_par_suivi_le IS NOT NULL;
    PERFORM set_config('livrial.source', v_source, true);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS arc_commandes_stop_livre_suivi ON arc_commandes;
CREATE TRIGGER arc_commandes_stop_livre_suivi
  AFTER INSERT OR UPDATE OF statut_suivi, date_livraison ON arc_commandes
  FOR EACH ROW EXECUTE FUNCTION arc_commandes_stop_livre_suivi();

-- 4. Rattrapage : les stops ouverts des affaires déjà « livre » dans le suivi
DO $$
BEGIN
  PERFORM set_config('livrial.source', 'suivi', true);
  UPDATE stops s
     SET statut = 'LIVRE',
         livre_le = least(
           coalesce((c.date_livraison + time '12:00') AT TIME ZONE 'Europe/Paris', c.statut_suivi_le, now()),
           now()),
         livre_par_suivi_le = now()
    FROM arc_commandes c
   WHERE c.reference_complete = s.arc_reference
     AND c.statut_suivi = 'livre'
     AND s.statut IN ('A_LIVRER', 'EN_COURS');
  PERFORM set_config('livrial.source', '', true);
END;
$$;

-- Contrôle : les stops fermés par le suivi
-- SELECT numero_affaire, societe, statut, livre_le, livre_par_suivi_le FROM stops
--  WHERE livre_par_suivi_le IS NOT NULL ORDER BY livre_par_suivi_le DESC;

NOTIFY pgrst, 'reload schema';
