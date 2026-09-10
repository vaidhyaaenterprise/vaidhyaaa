-- Increase embedding dimension from 768 to 2048 for NVIDIA Nemotron-3-Embed-1B
-- pgvector indexes (HNSW and IVFFlat) support max 2000 dimensions.
-- 2048-dim vectors use exact (brute force) search.

DROP INDEX IF EXISTS idx_clinic_kb_embedding_hnsw;

ALTER TABLE clinic_knowledge_base ALTER COLUMN embedding TYPE vector(2048);
