-- Clinic unique number: sequential per-clinic identifier starting at 1000.
-- First registered clinic gets 1000, next 1001, and so on. Never changeable
-- once assigned; displayed to the admin at registration and used as the
-- suffix of login usernames (e.g. priya.1000).

CREATE SEQUENCE IF NOT EXISTS clinic_unique_number_seq START WITH 1000;

ALTER TABLE clinics ADD COLUMN IF NOT EXISTS unique_number integer;

DO $$
DECLARE
  clinic_row record;
BEGIN
  FOR clinic_row IN
    SELECT id FROM clinics
    WHERE unique_number IS NULL
    ORDER BY created_at ASC, id ASC
  LOOP
    UPDATE clinics
    SET unique_number = nextval('clinic_unique_number_seq')
    WHERE id = clinic_row.id;
  END LOOP;
END $$;

ALTER TABLE clinics ALTER COLUMN unique_number SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clinics_unique_number_key'
  ) THEN
    ALTER TABLE clinics ADD CONSTRAINT clinics_unique_number_key UNIQUE (unique_number);
  END IF;
END $$;