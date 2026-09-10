-- Clinic login users: username/password login support
-- Usernames are auto-generated as <name>.<clinicUniqueNumber> (e.g. NAME.1000).
-- The clinic unique number is derived deterministically from the clinic id,
-- fixed at first clinic creation and never changeable.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS password_salt text;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx
  ON users (username)
  WHERE username IS NOT NULL;

-- Relax the "email or phone required" check to allow username-only logins.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_check;
ALTER TABLE users ADD CONSTRAINT users_check
  CHECK (email IS NOT NULL OR phone IS NOT NULL OR username IS NOT NULL);
