CREATE INDEX IF NOT EXISTS idx_appointment_events_clinic_admin_activity
  ON appointment_events (clinic_id, actor_type, event_type, created_at DESC);
