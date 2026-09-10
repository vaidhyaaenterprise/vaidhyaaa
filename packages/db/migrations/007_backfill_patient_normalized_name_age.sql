UPDATE patients
SET normalized_name = lower(regexp_replace(trim(name), '\\s+', ' ', 'g'))
WHERE normalized_name IS NULL;

UPDATE patients AS p
SET age_years = extract(year from age(current_date, p.date_of_birth))::int
WHERE p.age_years IS NULL
  AND p.date_of_birth IS NOT NULL;

WITH ranked AS (
  SELECT
    id,
    clinic_id,
    normalized_phone,
    normalized_name,
    age_years,
    date_of_birth,
    created_at,
    row_number() OVER (
      PARTITION BY clinic_id, normalized_phone, normalized_name, age_years, coalesce(date_of_birth::text, '')
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    first_value(id) OVER (
      PARTITION BY clinic_id, normalized_phone, normalized_name, age_years, coalesce(date_of_birth::text, '')
      ORDER BY created_at ASC, id ASC
    ) AS keep_id
  FROM patients
  WHERE normalized_phone IS NOT NULL
    AND normalized_name IS NOT NULL
    AND age_years IS NOT NULL
), dupes AS (
  SELECT id, clinic_id, keep_id
  FROM ranked
  WHERE rn > 1
)
UPDATE appointment_requests AS ar
SET patient_id = d.keep_id
FROM dupes d
WHERE ar.clinic_id = d.clinic_id
  AND ar.patient_id = d.id;

WITH ranked AS (
  SELECT
    id,
    clinic_id,
    normalized_phone,
    normalized_name,
    age_years,
    date_of_birth,
    created_at,
    row_number() OVER (
      PARTITION BY clinic_id, normalized_phone, normalized_name, age_years, coalesce(date_of_birth::text, '')
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    first_value(id) OVER (
      PARTITION BY clinic_id, normalized_phone, normalized_name, age_years, coalesce(date_of_birth::text, '')
      ORDER BY created_at ASC, id ASC
    ) AS keep_id
  FROM patients
  WHERE normalized_phone IS NOT NULL
    AND normalized_name IS NOT NULL
    AND age_years IS NOT NULL
), dupes AS (
  SELECT id, clinic_id, keep_id
  FROM ranked
  WHERE rn > 1
)
UPDATE patient_visits AS pv
SET patient_id = d.keep_id
FROM dupes d
WHERE pv.clinic_id = d.clinic_id
  AND pv.patient_id = d.id;

WITH ranked AS (
  SELECT
    id,
    clinic_id,
    normalized_phone,
    normalized_name,
    age_years,
    date_of_birth,
    created_at,
    row_number() OVER (
      PARTITION BY clinic_id, normalized_phone, normalized_name, age_years, coalesce(date_of_birth::text, '')
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    first_value(id) OVER (
      PARTITION BY clinic_id, normalized_phone, normalized_name, age_years, coalesce(date_of_birth::text, '')
      ORDER BY created_at ASC, id ASC
    ) AS keep_id
  FROM patients
  WHERE normalized_phone IS NOT NULL
    AND normalized_name IS NOT NULL
    AND age_years IS NOT NULL
), dupes AS (
  SELECT id, clinic_id, keep_id
  FROM ranked
  WHERE rn > 1
)
UPDATE conversation_sessions AS cs
SET patient_id = d.keep_id
FROM dupes d
WHERE cs.clinic_id = d.clinic_id
  AND cs.patient_id = d.id;

WITH ranked AS (
  SELECT
    id,
    clinic_id,
    normalized_phone,
    normalized_name,
    age_years,
    date_of_birth,
    created_at,
    row_number() OVER (
      PARTITION BY clinic_id, normalized_phone, normalized_name, age_years, coalesce(date_of_birth::text, '')
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    first_value(id) OVER (
      PARTITION BY clinic_id, normalized_phone, normalized_name, age_years, coalesce(date_of_birth::text, '')
      ORDER BY created_at ASC, id ASC
    ) AS keep_id
  FROM patients
  WHERE normalized_phone IS NOT NULL
    AND normalized_name IS NOT NULL
    AND age_years IS NOT NULL
), dupes AS (
  SELECT id, clinic_id, keep_id
  FROM ranked
  WHERE rn > 1
)
UPDATE calls AS c
SET patient_id = d.keep_id
FROM dupes d
WHERE c.clinic_id = d.clinic_id
  AND c.patient_id = d.id;

WITH ranked AS (
  SELECT
    id,
    clinic_id,
    normalized_phone,
    normalized_name,
    age_years,
    date_of_birth,
    created_at,
    row_number() OVER (
      PARTITION BY clinic_id, normalized_phone, normalized_name, age_years, coalesce(date_of_birth::text, '')
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM patients
  WHERE normalized_phone IS NOT NULL
    AND normalized_name IS NOT NULL
    AND age_years IS NOT NULL
)
DELETE FROM patients p
USING ranked r
WHERE p.id = r.id
  AND p.clinic_id = r.clinic_id
  AND r.rn > 1;

DROP INDEX IF EXISTS patients_unique_phone_name;
DROP INDEX IF EXISTS patients_unique_phone_name_age_nodob;
DROP INDEX IF EXISTS patients_unique_phone_name_age_dob;

CREATE UNIQUE INDEX IF NOT EXISTS patients_unique_phone_name_age_nodob
ON patients (clinic_id, normalized_phone, normalized_name, age_years)
WHERE normalized_phone IS NOT NULL
  AND normalized_name IS NOT NULL
  AND age_years IS NOT NULL
  AND date_of_birth IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS patients_unique_phone_name_age_dob
ON patients (clinic_id, normalized_phone, normalized_name, age_years, date_of_birth)
WHERE normalized_phone IS NOT NULL
  AND normalized_name IS NOT NULL
  AND age_years IS NOT NULL
  AND date_of_birth IS NOT NULL;
