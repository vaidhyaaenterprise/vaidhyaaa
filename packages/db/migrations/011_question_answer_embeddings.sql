-- Add dedicated question/answer embedding vectors to knowledge rows

ALTER TABLE clinic_knowledge_base
  ADD COLUMN IF NOT EXISTS question_embedding vector(768),
  ADD COLUMN IF NOT EXISTS answer_embedding vector(768);

CREATE INDEX IF NOT EXISTS idx_clinic_kb_question_embedding_hnsw
  ON clinic_knowledge_base
  USING hnsw (question_embedding vector_cosine_ops)
  WHERE status = 'approved' AND embedding_status = 'generated';

CREATE INDEX IF NOT EXISTS idx_clinic_kb_answer_embedding_hnsw
  ON clinic_knowledge_base
  USING hnsw (answer_embedding vector_cosine_ops)
  WHERE status = 'approved' AND embedding_status = 'generated';
