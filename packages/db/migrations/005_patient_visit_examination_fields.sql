ALTER TABLE patient_visits
  ADD COLUMN IF NOT EXISTS examination_notes text,
  ADD COLUMN IF NOT EXISTS diagnosis text,
  ADD COLUMN IF NOT EXISTS advice text;
