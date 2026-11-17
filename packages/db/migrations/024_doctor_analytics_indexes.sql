-- Keep diagnosis aggregation doctor-scoped without scanning every patient
-- visit in a busy clinic. CONCURRENTLY avoids blocking visit writes in production.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_visits_doctor_time
  ON patient_visits (clinic_id, doctor_id, visited_at DESC);
