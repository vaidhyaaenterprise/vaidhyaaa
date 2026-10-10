-- Persist clinic-specific Knowledge Base sections and safely hide removed Q&A rows.

ALTER TABLE clinic_knowledge_base
  ADD COLUMN IF NOT EXISTS removed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_clinic_kb_visible_section
  ON clinic_knowledge_base (clinic_id, section_key, updated_at DESC)
  WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS clinic_knowledge_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  section_key text NOT NULL,
  title text NOT NULL,
  is_custom boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, section_key),
  UNIQUE (clinic_id, id)
);

CREATE INDEX IF NOT EXISTS idx_clinic_knowledge_sections_active
  ON clinic_knowledge_sections (clinic_id, active, sort_order);
