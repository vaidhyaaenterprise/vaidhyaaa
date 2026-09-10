-- Vaidya DB Validation Queries

-- List tables
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Seed clinic/settings
SELECT id, name, active FROM clinics;
SELECT clinic_id, agent_enabled, answering_mode, booking_mode, max_concurrent_calls
FROM clinic_settings;

-- Users/RBAC
SELECT u.id, u.name, u.email, u.phone, u.active, cu.clinic_id, cu.role, cu.doctor_id, cu.active AS membership_active
FROM users u
JOIN clinic_users cu ON cu.user_id = u.id
ORDER BY u.created_at;

-- Doctor/service mappings
SELECT d.name AS doctor_name, cs.service_name, ds.active
FROM doctor_services ds
JOIN doctors d ON d.id = ds.doctor_id AND d.clinic_id = ds.clinic_id
JOIN clinic_services cs ON cs.id = ds.clinic_service_id AND cs.clinic_id = ds.clinic_id
ORDER BY d.name, cs.service_name;

-- Booking rules
SELECT d.name, cs.service_name, br.slot_duration_minutes, br.capacity_per_slot, br.booking_horizon_days,
       br.manual_edit_cutoff_before_start_minutes, br.manual_edit_max_shift_minutes
FROM doctor_service_booking_rules br
JOIN doctors d ON d.id = br.doctor_id AND d.clinic_id = br.clinic_id
JOIN clinic_services cs ON cs.id = br.clinic_service_id AND cs.clinic_id = br.clinic_id
ORDER BY d.name, cs.service_name;

-- Slot availability derived counts
-- Replace :slot_id with actual slot id
-- SELECT
--   s.id,
--   s.capacity_total,
--   (SELECT COUNT(*) FROM appointment_requests ar WHERE ar.slot_id = s.id AND ar.status IN ('pending_confirmation','confirmed')) AS active_appointments,
--   (SELECT COUNT(*) FROM slot_holds sh WHERE sh.slot_id = s.id AND sh.status = 'active' AND sh.hold_expires_at > NOW()) AS active_holds,
--   s.capacity_total
--    - (SELECT COUNT(*) FROM appointment_requests ar WHERE ar.slot_id = s.id AND ar.status IN ('pending_confirmation','confirmed'))
--    - (SELECT COUNT(*) FROM slot_holds sh WHERE sh.slot_id = s.id AND sh.status = 'active' AND sh.hold_expires_at > NOW()) AS available_count
-- FROM appointment_slots s
-- WHERE s.id = ':slot_id';

-- Pending appointments
SELECT ar.id, ar.status, ar.patient_name, ar.patient_phone, ar.reason_for_visit, ar.appointment_start, d.name AS doctor, cs.service_name
FROM appointment_requests ar
JOIN doctors d ON d.id = ar.doctor_id AND d.clinic_id = ar.clinic_id
JOIN clinic_services cs ON cs.id = ar.clinic_service_id AND cs.clinic_id = ar.clinic_id
ORDER BY ar.created_at DESC;

-- Action requests
SELECT id, request_type, status, reason, source_session_id, created_at
FROM appointment_action_requests
ORDER BY created_at DESC;

-- Notification events
SELECT event_type, status, recipient_type, attempts, created_at, updated_at
FROM notification_events
ORDER BY created_at DESC;

-- Knowledge status
SELECT question, category, status, language_code, updated_at
FROM clinic_knowledge_base
ORDER BY updated_at DESC;
