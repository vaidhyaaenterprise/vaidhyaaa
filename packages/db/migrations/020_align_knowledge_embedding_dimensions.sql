-- Keep all knowledge embedding columns aligned with EMBEDDING_DIMENSIONS=1024.
-- question_embedding and answer_embedding were introduced as vector(768),
-- while the primary embedding column and production provider use 1024.

BEGIN;

DROP INDEX IF EXISTS idx_clinic_kb_question_embedding_hnsw;
DROP INDEX IF EXISTS idx_clinic_kb_answer_embedding_hnsw;

ALTER TABLE clinic_knowledge_base
  ALTER COLUMN question_embedding TYPE vector(1024) USING NULL::vector(1024),
  ALTER COLUMN answer_embedding TYPE vector(1024) USING NULL::vector(1024);

UPDATE clinic_knowledge_base
SET
  embedding_status = 'stale',
  embedding_error = NULL,
  updated_at = now()
WHERE embedding_status = 'generated'
   OR embedding_error ~* 'expected 768 dimensions, not 1024';

CREATE INDEX idx_clinic_kb_question_embedding_hnsw
  ON clinic_knowledge_base
  USING hnsw (question_embedding vector_cosine_ops)
  WHERE status = 'approved' AND embedding_status = 'generated';

CREATE INDEX idx_clinic_kb_answer_embedding_hnsw
  ON clinic_knowledge_base
  USING hnsw (answer_embedding vector_cosine_ops)
  WHERE status = 'approved' AND embedding_status = 'generated';

COMMIT;
