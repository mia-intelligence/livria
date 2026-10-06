-- Migration : l'email devient un identifiant libre (les utilisateurs n'ont pas tous d'adresse mail)
-- À jouer dans Supabase Dashboard > SQL Editor. Les comptes existants gardent leur valeur actuelle.

ALTER TABLE users RENAME COLUMN email TO identifiant;

ALTER TABLE activity_logs RENAME COLUMN user_email TO user_identifiant;
ALTER INDEX IF EXISTS activity_logs_user_email_idx RENAME TO activity_logs_user_identifiant_idx;
