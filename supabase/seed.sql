-- ============================================================
-- LIVRIAL — Données de test
-- Exécuter APRÈS schema.sql
-- ============================================================

-- ── Utilisateurs de test ────────────────────────────────────────
-- Mots de passe hashés en bcrypt (salt 10) :
--   Admin123  → $2b$10$...
--   Adv123    → $2b$10$...
--   Livreur123 → $2b$10$...
--
-- IMPORTANT : Ces hashes sont générés pour les tests uniquement.
-- En production, créez les comptes via l'interface Admin.
--
-- Pour générer vos propres hashes :
--   node -e "const b=require('bcrypt'); b.hash('Admin123',10).then(console.log)"

INSERT INTO users (id, nom, prenom, email, password_hash, role, actif)
VALUES
  (
    uuid_generate_v4(),
    'Martin', 'Admin',
    'admin@atrial.fr',
    -- hash de 'Admin123'
    '$2b$10$pcIKuVXzQJ25Gb8V.NWKG.phKSlgK90BuJbS.lO54TXxgAncpLVTK',
    'ADMIN', TRUE
  ),
  (
    uuid_generate_v4(),
    'Laurent', 'Sophie',
    'adv@atrial.fr',
    -- hash de 'Adv123'
    '$2b$10$SFZb1modvFp3m7Urg6iEVuiikEgCVamr405KHiBDug.OIdbRGSH8e',
    'ADV', TRUE
  ),
  (
    uuid_generate_v4(),
    'Benali', 'Karim',
    'livreur@atrial.fr',
    -- hash de 'Livreur123'
    '$2b$10$oVBf3siXXu/myZL8Z4SON.eIjoTRoo1IShNSGDzMThidOT1RS1zlC',
    'LIVREUR', TRUE
  )
ON CONFLICT (email) DO NOTHING;

-- ── Stops de test (aujourd'hui) ─────────────────────────────────
INSERT INTO stops (societe, adresse, telephone, latitude, longitude, numero_affaire, type, statut, ordre, date_tournee)
VALUES
  (
    'Rénov Sud',
    '12 rue des Artisans, 83000 Toulon',
    '06 12 34 56 78',
    43.1242, 5.9280,
    '2026-089',
    'ATRIAL', 'A_LIVRER', 1, CURRENT_DATE
  ),
  (
    'Bâti Provence',
    '45 avenue de la Gare, 83400 Hyères',
    '06 23 45 67 89',
    43.1189, 6.1286,
    '2026-091',
    'ATRIAL', 'A_LIVRER', 2, CURRENT_DATE
  ),
  (
    'Constructions Martin',
    '8 chemin des Oliviers, 83500 La Seyne-sur-Mer',
    '06 34 56 78 90',
    43.1003, 5.8796,
    '2026-094',
    'ATRIAL', 'A_LIVRER', 3, CURRENT_DATE
  ),
  (
    'Habitat Var',
    '23 boulevard Victor Hugo, 83170 Brignoles',
    '06 45 67 89 01',
    43.4063, 6.0613,
    '2026-097',
    'ENLEVEMENT', 'A_LIVRER', 4, CURRENT_DATE
  ),
  (
    'Sud Chantiers',
    '67 route de Marseille, 83470 Saint-Maximin-la-Sainte-Baume',
    '06 56 78 90 12',
    43.4538, 5.8624,
    '2026-102',
    'TRANSPORTEUR', 'A_LIVRER', 5, CURRENT_DATE
  );

-- Note : Les hashes ci-dessus sont des exemples.
-- Régénérez-les avec la commande node avant de les utiliser en production.
-- Ou utilisez directement la vue Admin pour créer les comptes.
