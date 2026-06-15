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
  email         TEXT        NOT NULL UNIQUE,
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
  numero_affaire  TEXT,
  type            TEXT        NOT NULL CHECK (type IN ('ATRIAL', 'ENLEVEMENT', 'TRANSPORTEUR')),
  statut          TEXT        NOT NULL DEFAULT 'A_LIVRER' CHECK (statut IN ('A_LIVRER', 'EN_COURS', 'LIVRE')),
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

-- Index pour les requêtes courantes
CREATE INDEX IF NOT EXISTS stops_date_idx  ON stops (date_tournee);
CREATE INDEX IF NOT EXISTS stops_type_idx  ON stops (type);
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
