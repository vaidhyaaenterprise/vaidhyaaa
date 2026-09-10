BEGIN;

CREATE TABLE IF NOT EXISTS clinic_holiday_doctors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  holiday_id uuid NOT NULL,
  doctor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, holiday_id, doctor_id),
  FOREIGN KEY (clinic_id, holiday_id) REFERENCES clinic_holidays(clinic_id, id) ON DELETE CASCADE,
  FOREIGN KEY (clinic_id, doctor_id) REFERENCES doctors(clinic_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_clinic_holiday_doctors_lookup
  ON clinic_holiday_doctors (clinic_id, holiday_id, doctor_id);

DROP TRIGGER IF EXISTS trg_clinic_holiday_doctors_updated_at ON clinic_holiday_doctors;
CREATE TRIGGER trg_clinic_holiday_doctors_updated_at
  BEFORE UPDATE ON clinic_holiday_doctors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
