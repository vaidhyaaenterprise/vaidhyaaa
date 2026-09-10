-- A09: Knowledge embedding metadata and search indexes

ALTER TABLE clinic_knowledge_base
  ADD COLUMN IF NOT EXISTS embedding_model text,
  ADD COLUMN IF NOT EXISTS embedding_dimensions integer,
  ADD COLUMN IF NOT EXISTS embedding_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS embedding_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS embedding_error text,
  ADD COLUMN IF NOT EXISTS embedding_source_hash text,
  ADD COLUMN IF NOT EXISTS last_embedding_job_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clinic_knowledge_base_embedding_status_check'
  ) THEN
    ALTER TABLE clinic_knowledge_base
      ADD CONSTRAINT clinic_knowledge_base_embedding_status_check
      CHECK (embedding_status IN ('pending', 'generated', 'failed', 'stale', 'not_required'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clinic_kb_clinic_status
  ON clinic_knowledge_base (clinic_id, status);

CREATE INDEX IF NOT EXISTS idx_clinic_kb_embedding_status
  ON clinic_knowledge_base (clinic_id, embedding_status);

CREATE INDEX IF NOT EXISTS idx_clinic_kb_category
  ON clinic_knowledge_base (clinic_id, category);

CREATE INDEX IF NOT EXISTS idx_clinic_kb_embedding_hnsw
  ON clinic_knowledge_base
  USING hnsw (embedding vector_cosine_ops)
  WHERE status = 'approved' AND embedding_status = 'generated';
