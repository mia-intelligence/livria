-- ============================================================
-- LIVRIAL — Schéma Supabase
-- Groupe Atrial · Brignoles (Var)
-- Hébergement : Supabase Europe (Frankfurt)
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Table : users ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  nom           TEXT        NOT NULL,
  prenom        TEXT        NOT NULL,
  identifiant   TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  role          TEXT        NOT NULL CHECK (role IN ('LIVREUR', 'ADV', 'ADMIN', 'MAGASIN')),
  actif         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login    TIMESTAMPTZ
);

-- ── Table : stops ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stops (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  societe         TEXT        NOT NULL,
  adresse         TEXT        NOT NULL,
  telephone       TEXT,
  latitude        FLOAT,
  longitude       FLOAT,
  numero_affaire      TEXT,
  societe_livraison   TEXT        NOT NULL CHECK (societe_livraison IN ('ATRIAL', 'ENLEVEMENT', 'TRANSPORTEUR')),
  statut              TEXT        NOT NULL DEFAULT 'A_LIVRER' CHECK (statut IN ('A_LIVRER', 'EN_COURS', 'LIVRE')),
  ordre              INTEGER     NOT NULL DEFAULT 99,
  date_tournee       DATE        NOT NULL DEFAULT CURRENT_DATE,
  -- Champs tournée / véhicule (ajoutés V2)
  tournee            TEXT        CHECK (tournee IS NULL OR tournee = ANY (ARRAY[
                       'ENLEVEMENT','TOURNEE LUNDI','MARDI T06-T83EST',
                       'MERCREDI T13','TOURNEE JEUDI','VENDREDI T83 OUEST',
                       'LIVRAISON CHANTIER','TRANSPORTEUR'
                     ])),
  vehicule           TEXT        CHECK (vehicule IS NULL OR vehicule = ANY (ARRAY['PL','VL'])),
  -- Champs préparation magasin (ajoutés V2)
  nombre_colis       INTEGER,
  emplacement        TEXT,
  photo_url          TEXT,
  magasin_valide     BOOLEAN     NOT NULL DEFAULT FALSE,
  magasin_valide_at  TIMESTAMPTZ,
  -- Champs V3 : commentaire magasin, confirmation livreur, type produit
  commentaire_magasin    TEXT,
  livreur_colis_confirme BOOLEAN NOT NULL DEFAULT FALSE,
  type_produit           TEXT    CHECK (type_produit IS NULL OR type_produit = ANY (ARRAY['PVC','ALU','MIXTE'])),
  groupe_livraison       TEXT,
  -- Champs V4 : référence client (planning) et colis réellement livrés
  reference_client       TEXT,
  -- Champ V5 : clé arc_commandes.reference_complete de la commande livrée par ce stop
  -- (choisie dans une liste par l'ADV ; migration scripts/arc/migrations/20260918_stops_arc_reference.sql)
  arc_reference          TEXT,
  colis_livres           INTEGER CHECK (colis_livres IS NULL OR colis_livres >= 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Migration V2 (si table déjà existante) ─────────────────────
-- ALTER TABLE users ALTER COLUMN role DROP CONSTRAINT users_role_check;
-- ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('LIVREUR','ADV','ADMIN','MAGASIN'));
-- ALTER TABLE stops ADD COLUMN IF NOT EXISTS tournee TEXT;
-- ALTER TABLE stops ADD COLUMN IF NOT EXISTS vehicule TEXT;
-- ALTER TABLE stops ADD COLUMN IF NOT EXISTS nombre_colis INTEGER;
-- ALTER TABLE stops ADD COLUMN IF NOT EXISTS emplacement TEXT;
-- ALTER TABLE stops ADD COLUMN IF NOT EXISTS photo_url TEXT;
-- ALTER TABLE stops ADD COLUMN IF NOT EXISTS magasin_valide BOOLEAN NOT NULL DEFAULT FALSE;
-- ALTER TABLE stops ADD COLUMN IF NOT EXISTS magasin_valide_at TIMESTAMPTZ;

-- ── Migration V3 (multi-photos, commentaire, confirmation colis, PVC/ALU) ──
-- Exécuter dans l'éditeur SQL Supabase :
--
-- CREATE TABLE IF NOT EXISTS stop_photos (
--   id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
--   stop_id    UUID        NOT NULL REFERENCES stops(id) ON DELETE CASCADE,
--   photo_url  TEXT        NOT NULL,
--   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
-- );
-- CREATE INDEX IF NOT EXISTS stop_photos_stop_idx ON stop_photos (stop_id);
--
-- ALTER TABLE stops ADD COLUMN IF NOT EXISTS commentaire_magasin TEXT;
-- ALTER TABLE stops ADD COLUMN IF NOT EXISTS livreur_colis_confirme BOOLEAN NOT NULL DEFAULT FALSE;
-- ALTER TABLE stops ADD COLUMN IF NOT EXISTS type_produit TEXT CHECK (type_produit IS NULL OR type_produit = ANY (ARRAY['PVC','ALU','MIXTE']));
-- ALTER TABLE stops ADD COLUMN IF NOT EXISTS groupe_livraison TEXT;

-- ── Migration V4 (référence client, colis livrés) ──────────────
-- À exécuter sur une base existante, dans l'éditeur SQL Supabase.
-- Idempotent : sans effet et sans erreur si déjà appliqué.
--
-- ALTER TABLE stops ADD COLUMN IF NOT EXISTS reference_client TEXT;
-- ALTER TABLE stops ADD COLUMN IF NOT EXISTS colis_livres INTEGER;
--
-- Contrôle :
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'stops' AND column_name IN ('reference_client','colis_livres');

-- Index pour les requêtes courantes
CREATE INDEX IF NOT EXISTS stops_date_idx   ON stops (date_tournee);
-- NB : l'index portait sur une colonne « type » qui n'existe pas —
-- le champ réel est societe_livraison, filtré à chaque chargement.
CREATE INDEX IF NOT EXISTS stops_societe_livraison_idx ON stops (societe_livraison);
CREATE INDEX IF NOT EXISTS stops_statut_idx ON stops (statut);

-- ── Table : sessions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_token_idx ON sessions (token);
CREATE INDEX IF NOT EXISTS sessions_user_idx  ON sessions (user_id);

-- ── Trigger : updated_at auto-update ───────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stops_updated_at
  BEFORE UPDATE ON stops
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Nettoyage automatique : stops > 12 mois ─────────────────────
-- À planifier via pg_cron si disponible, sinon déclencher manuellement
-- DELETE FROM stops WHERE date_tournee < CURRENT_DATE - INTERVAL '12 months';

-- ── Row Level Security (optionnel, recommandé en prod) ──────────
-- ALTER TABLE users   ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE stops   ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
-- Note : la gestion des droits est assurée par l'API (middleware auth)
-- RLS peut être activé en V2 pour une sécurité renforcée côté DB.


-- ── Table : activity_logs ────────────────────────────────────────
-- À créer dans Supabase Dashboard > SQL Editor
CREATE TABLE IF NOT EXISTS activity_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_identifiant  TEXT,
  action      TEXT NOT NULL,
  details     JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_user_identifiant_idx ON activity_logs(user_identifiant);
