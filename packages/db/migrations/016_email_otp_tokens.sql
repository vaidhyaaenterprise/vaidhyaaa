-- Email verification + password reset OTP tokens
-- Only the SHA-256 hash of the OTP is ever stored, never the plaintext code.
-- One row per issued code; resends invalidate the previous row via used_at.

CREATE TABLE IF NOT EXISTS otp_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  otp_hash text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('EMAIL_VERIFICATION', 'PASSWORD_RESET')),
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otp_tokens_email_purpose_idx
  ON otp_tokens (email, purpose);

CREATE INDEX IF NOT EXISTS otp_tokens_email_purpose_created_idx
  ON otp_tokens (email, purpose, created_at DESC);