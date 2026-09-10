-- Reduce embedding dimension to 1024 (MRL slice from 2048 NVIDIA output)
-- and add HNSW index for efficient similarity search.

DROP INDEX IF EXISTS idx_clinic_kb_embedding_hnsw;

ALTER TABLE clinic_knowledge_base ALTER COLUMN embedding TYPE vector(1024);

CREATE INDEX idx_clinic_kb_embedding_hnsw
  ON clinic_knowledge_base
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);
