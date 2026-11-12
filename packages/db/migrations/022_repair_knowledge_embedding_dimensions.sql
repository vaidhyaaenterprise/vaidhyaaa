-- Repair production databases whose migration history says 1024 dimensions
-- while one or more knowledge embedding columns still use vector(768).
-- Existing vectors cannot be safely mixed or padded across dimensions, so
-- clear them and mark approved rows for regeneration by the configured model.

BEGIN;

DROP INDEX IF EXISTS idx_clinic_kb_embedding_hnsw;
DROP INDEX IF EXISTS idx_clinic_kb_question_embedding_hnsw;
DROP INDEX IF EXISTS idx_clinic_kb_answer_embedding_hnsw;

DO $$
DECLARE
  needs_dimension_repair boolean;
BEGIN
  SELECT
    count(*) <> 3
    OR coalesce(bool_or(format_type(a.atttypid, a.atttypmod) <> 'vector(1024)'), true)
  INTO needs_dimension_repair
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema()
    AND c.relname = 'clinic_knowledge_base'
    AND a.attname IN ('embedding', 'question_embedding', 'answer_embedding')
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF needs_dimension_repair THEN
    UPDATE clinic_knowledge_base
    SET
      embedding = NULL,
      question_embedding = NULL,
      answer_embedding = NULL,
      embedding_model = NULL,
      embedding_dimensions = NULL,
      embedding_status = CASE
        WHEN status = 'approved' THEN 'stale'
        WHEN embedding_status = 'not_required' THEN 'not_required'
        ELSE 'pending'
      END,
      embedding_generated_at = NULL,
      embedding_error = NULL,
      embedding_source_hash = NULL,
      last_embedding_job_id = NULL,
      updated_at = now()
    WHERE embedding IS NOT NULL
       OR question_embedding IS NOT NULL
       OR answer_embedding IS NOT NULL
       OR embedding_dimensions IS NOT NULL
       OR embedding_status IN ('generated', 'failed', 'stale');

    ALTER TABLE clinic_knowledge_base
      ALTER COLUMN embedding TYPE vector(1024) USING NULL::vector(1024),
      ALTER COLUMN question_embedding TYPE vector(1024) USING NULL::vector(1024),
      ALTER COLUMN answer_embedding TYPE vector(1024) USING NULL::vector(1024);
  END IF;
END $$;

CREATE INDEX idx_clinic_kb_embedding_hnsw
  ON clinic_knowledge_base
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200)
  WHERE status = 'approved' AND embedding_status = 'generated';

CREATE INDEX idx_clinic_kb_question_embedding_hnsw
  ON clinic_knowledge_base
  USING hnsw (question_embedding vector_cosine_ops)
  WHERE status = 'approved' AND embedding_status = 'generated';

CREATE INDEX idx_clinic_kb_answer_embedding_hnsw
  ON clinic_knowledge_base
  USING hnsw (answer_embedding vector_cosine_ops)
  WHERE status = 'approved' AND embedding_status = 'generated';

COMMIT;
