-- C04 final schema alignment (incremental; does not modify 001)
BEGIN;

CREATE INDEX IF NOT EXISTS idx_conversation_sessions_status
  ON conversation_sessions (clinic_id, status);

CREATE TABLE IF NOT EXISTS background_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid REFERENCES clinics(id) ON DELETE RESTRICT,
  job_type text NOT NULL,
  deduplication_key text,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  priority integer NOT NULL DEFAULT 100,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS background_jobs_dedup_idx
  ON background_jobs (clinic_id, deduplication_key)
  WHERE deduplication_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_background_jobs_poll
  ON background_jobs (status, scheduled_at, priority);

CREATE INDEX IF NOT EXISTS idx_background_jobs_clinic_status
  ON background_jobs (clinic_id, status, scheduled_at);

DROP TRIGGER IF EXISTS trg_background_jobs_updated_at ON background_jobs;
CREATE TRIGGER trg_background_jobs_updated_at
  BEFORE UPDATE ON background_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
