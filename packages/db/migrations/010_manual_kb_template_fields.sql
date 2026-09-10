-- Add manual Knowledge Base template metadata and approval fields

ALTER TABLE clinic_knowledge_base
  ADD COLUMN IF NOT EXISTS template_key text,
  ADD COLUMN IF NOT EXISTS section_key text,
  ADD COLUMN IF NOT EXISTS source_notes text,
  ADD COLUMN IF NOT EXISTS service_name text,
  ADD COLUMN IF NOT EXISTS applicable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS qa_approved boolean NOT NULL DEFAULT false;

UPDATE clinic_knowledge_base
SET qa_approved = true
WHERE status = 'approved'
  AND qa_approved = false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_clinic_kb_template_key
  ON clinic_knowledge_base (clinic_id, template_key)
  WHERE template_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clinic_kb_section_key
  ON clinic_knowledge_base (clinic_id, section_key);

CREATE INDEX IF NOT EXISTS idx_clinic_kb_applicable_approved
  ON clinic_knowledge_base (clinic_id, applicable, qa_approved, status);
