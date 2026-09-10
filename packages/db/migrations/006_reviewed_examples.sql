-- A18: Reviewed examples for evaluation dataset and language-pack review loop

CREATE TABLE IF NOT EXISTS reviewed_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  language_code text NOT NULL,
  message_text_redacted text NOT NULL,
  context_flow text NOT NULL,
  context_state text NOT NULL,
  expected_recognized_as text NOT NULL,
  expected_intent text,
  expected_entities_json jsonb NOT NULL DEFAULT '{}',
  source text NOT NULL DEFAULT 'manual_review',
  approved_for_prompt_examples boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviewed_examples_language
  ON reviewed_examples (language_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reviewed_examples_prompt_export
  ON reviewed_examples (approved_for_prompt_examples, created_at DESC)
  WHERE approved_for_prompt_examples = true;

ALTER TABLE language_packs
  ADD COLUMN IF NOT EXISTS cancel_words_json jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE language_packs
  ADD COLUMN IF NOT EXISTS later_words_json jsonb NOT NULL DEFAULT '[]'::jsonb;
