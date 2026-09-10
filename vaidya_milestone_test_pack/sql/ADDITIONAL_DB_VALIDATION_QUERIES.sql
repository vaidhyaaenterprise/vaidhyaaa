-- Vaidya latest additional DB validation queries
-- Run after migrations and seed.

-- 1. Required tables
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'slot_holds',
    'doctor_service_booking_rules',
    'appointment_action_requests',
    'appointment_events',
    'clinic_onboarding_checklist',
    'clinic_telephony_settings',
    'subscription_plans',
    'clinic_subscriptions',
    'clinic_usage_monthly',
    'subscription_events',
    'supported_languages',
    'clinic_languages',
    'message_templates',
    'language_packs'
  )
ORDER BY table_name;

-- 2. Clinic settings defaults
SELECT c.name, cs.agent_enabled, cs.answering_mode, cs.booking_mode, cs.recording_retention_days, cs.transcript_retention_days
FROM clinics c
JOIN clinic_settings cs ON cs.clinic_id = c.id;

-- 3. Languages
SELECT cl.clinic_id, cl.language_code, cl.enabled, cl.is_default
FROM clinic_languages cl
ORDER BY cl.clinic_id, cl.is_default DESC, cl.language_code;

-- 4. Doctor profiles without login are allowed
SELECT id, clinic_id, name, user_id, active
FROM doctors
ORDER BY created_at DESC
LIMIT 20;

-- 5. Doctor-service booking rules
SELECT dsbr.clinic_id, d.name AS doctor_name, cs.service_name, dsbr.slot_duration_minutes, dsbr.capacity_per_slot, dsbr.booking_horizon_days,
       dsbr.manual_edit_cutoff_before_start_minutes, dsbr.manual_edit_max_shift_minutes, dsbr.active
FROM doctor_service_booking_rules dsbr
JOIN doctors d ON d.id = dsbr.doctor_id AND d.clinic_id = dsbr.clinic_id
JOIN clinic_services cs ON cs.id = dsbr.clinic_service_id AND cs.clinic_id = dsbr.clinic_id
ORDER BY d.name, cs.service_name;

-- 6. Slot availability by capacity
-- Replace :slot_id with actual slot id if your SQL client supports variables, or manually paste UUID.
-- SELECT s.id, s.capacity_total,
--   (SELECT COUNT(*) FROM appointment_requests ar WHERE ar.slot_id = s.id AND ar.status IN ('pending_confirmation','confirmed')) AS active_appointments,
--   (SELECT COUNT(*) FROM slot_holds sh WHERE sh.slot_id = s.id AND sh.status = 'active' AND sh.hold_expires_at > NOW()) AS active_holds,
--   s.capacity_total
--     - (SELECT COUNT(*) FROM appointment_requests ar WHERE ar.slot_id = s.id AND ar.status IN ('pending_confirmation','confirmed'))
--     - (SELECT COUNT(*) FROM slot_holds sh WHERE sh.slot_id = s.id AND sh.status = 'active' AND sh.hold_expires_at > NOW()) AS available_count
-- FROM appointment_slots s
-- WHERE s.id = ':slot_id';

-- 7. Expired holds that should be cleaned
SELECT id, clinic_id, slot_id, session_id, status, hold_expires_at
FROM slot_holds
WHERE status = 'active' AND hold_expires_at <= NOW();

-- 8. Cross-clinic doctor-service mismatches should return zero rows
SELECT ds.id
FROM doctor_services ds
LEFT JOIN doctors d ON d.id = ds.doctor_id AND d.clinic_id = ds.clinic_id
LEFT JOIN clinic_services cs ON cs.id = ds.clinic_service_id AND cs.clinic_id = ds.clinic_id
WHERE d.id IS NULL OR cs.id IS NULL;

-- 9. Notification pending/failed events
SELECT event_type, status, attempts, last_error, created_at, updated_at
FROM notification_events
WHERE status IN ('pending','failed')
ORDER BY created_at DESC
LIMIT 50;

-- 10. Subscription and plan state
SELECT c.name, sp.plan_key, sub.status, sub.current_period_start, sub.current_period_end
FROM clinic_subscriptions sub
JOIN clinics c ON c.id = sub.clinic_id
JOIN subscription_plans sp ON sp.id = sub.subscription_plan_id;
