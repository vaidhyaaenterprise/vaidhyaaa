-- Store slot wall-clock times in clinic local timezone (matches doctor_schedules 18:00 etc.)
-- PostgreSQL does not allow subqueries in ALTER COLUMN ... USING, so convert via UPDATE ... FROM.

-- appointment_slots.start_time
ALTER TABLE appointment_slots ADD COLUMN start_time_local timestamp without time zone;

UPDATE appointment_slots AS s
SET start_time_local = s.start_time AT TIME ZONE c.timezone
FROM clinics AS c
WHERE c.id = s.clinic_id;

ALTER TABLE appointment_slots DROP COLUMN start_time;
ALTER TABLE appointment_slots RENAME COLUMN start_time_local TO start_time;
ALTER TABLE appointment_slots ALTER COLUMN start_time SET NOT NULL;

-- appointment_slots.end_time
ALTER TABLE appointment_slots ADD COLUMN end_time_local timestamp without time zone;

UPDATE appointment_slots AS s
SET end_time_local = s.end_time AT TIME ZONE c.timezone
FROM clinics AS c
WHERE c.id = s.clinic_id;

ALTER TABLE appointment_slots DROP COLUMN end_time;
ALTER TABLE appointment_slots RENAME COLUMN end_time_local TO end_time;
ALTER TABLE appointment_slots ALTER COLUMN end_time SET NOT NULL;

-- appointment_requests.appointment_start
ALTER TABLE appointment_requests ADD COLUMN appointment_start_local timestamp without time zone;

UPDATE appointment_requests AS a
SET appointment_start_local = a.appointment_start AT TIME ZONE c.timezone
FROM clinics AS c
WHERE c.id = a.clinic_id;

ALTER TABLE appointment_requests DROP COLUMN appointment_start;
ALTER TABLE appointment_requests RENAME COLUMN appointment_start_local TO appointment_start;
ALTER TABLE appointment_requests ALTER COLUMN appointment_start SET NOT NULL;

-- appointment_requests.appointment_end
ALTER TABLE appointment_requests ADD COLUMN appointment_end_local timestamp without time zone;

UPDATE appointment_requests AS a
SET appointment_end_local = a.appointment_end AT TIME ZONE c.timezone
FROM clinics AS c
WHERE c.id = a.clinic_id;

ALTER TABLE appointment_requests DROP COLUMN appointment_end;
ALTER TABLE appointment_requests RENAME COLUMN appointment_end_local TO appointment_end;
ALTER TABLE appointment_requests ALTER COLUMN appointment_end SET NOT NULL;

COMMENT ON COLUMN appointment_slots.start_time IS 'Clinic-local wall clock; compare directly with doctor_schedules.start_time.';
COMMENT ON COLUMN appointment_slots.end_time IS 'Clinic-local wall clock in clinics.timezone.';
