-- Audited soft deletion for clinic login memberships and case-insensitive usernames.

ALTER TABLE clinic_users
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clinic_users_clinic_not_deleted
  ON clinic_users (clinic_id, role, active)
  WHERE deleted_at IS NULL;

-- Authentication resolves active memberships by user on every protected
-- request. Keep this hot path index-only for live memberships.
CREATE INDEX IF NOT EXISTS idx_clinic_users_user_active_not_deleted
  ON clinic_users (user_id)
  WHERE active = true AND deleted_at IS NULL;

-- A doctor may have only one live login membership in a clinic. The service
-- also enforces this transactionally; this index protects the invariant from
-- legacy, administrative, and manual writes.
DO $$
BEGIN
  IF EXISTS (
    SELECT clinic_id, doctor_id
    FROM clinic_users
    WHERE doctor_id IS NOT NULL AND deleted_at IS NULL
    GROUP BY clinic_id, doctor_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one login per doctor: duplicate live doctor memberships exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS clinic_users_live_doctor_unique_idx
  ON clinic_users (clinic_id, doctor_id)
  WHERE doctor_id IS NOT NULL AND deleted_at IS NULL;

-- All application-created usernames are canonical lowercase. Abort rather than
-- silently rename an ambiguous legacy account if case-only duplicates exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT lower(username)
    FROM users
    WHERE username IS NOT NULL
    GROUP BY lower(username)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce case-insensitive usernames: case-only duplicates exist';
  END IF;
END $$;

UPDATE users
SET username = lower(username), updated_at = now()
WHERE username IS NOT NULL AND username <> lower(username);

DROP INDEX IF EXISTS users_username_unique_idx;

CREATE UNIQUE INDEX users_username_unique_idx
  ON users (lower(username))
  WHERE username IS NOT NULL;
