-- A16: NLU review items for feedback loop and evaluation dataset export

CREATE TABLE IF NOT EXISTS nlu_review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  message_id uuid NOT NULL,
  message_text_redacted text NOT NULL,
  current_flow text NOT NULL,
  current_state text NOT NULL,
  failure_type text NOT NULL CHECK (failure_type IN ('classifier', 'router', 'interpreter')),
  capture_reason text NOT NULL CHECK (
    capture_reason IN (
      'unknown_intent',
      'low_confidence',
      'unrecognized_active_state',
      'low_confidence_state_extraction'
    )
  ),
  predicted_intent text,
  predicted_confidence numeric,
  predicted_entities_json jsonb NOT NULL DEFAULT '{}',
  correct_intent text,
  correct_entities_json jsonb,
  review_status text NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'reviewed', 'dismissed', 'exported')),
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (clinic_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_nlu_review_clinic_status
  ON nlu_review_items (clinic_id, review_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nlu_review_session
  ON nlu_review_items (clinic_id, session_id, created_at DESC);
