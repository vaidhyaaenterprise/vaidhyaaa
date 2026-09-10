# C01 Database Migrations and Seed - What to Test and How

## Goal
Verify that the full production-ready PostgreSQL schema and minimal QA seed data work on a fresh DB.

## Fresh DB setup

```bash
dropdb vaidya_local --if-exists
createdb vaidya_local
pnpm --filter api db:migrate
pnpm --filter api db:seed
```

## Verify required tables

Run:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

Must include:

```text
[ ] clinics
[ ] clinic_settings
[ ] clinic_onboarding_checklist
[ ] clinic_telephony_settings
[ ] users
[ ] clinic_users
[ ] doctors
[ ] clinic_services
[ ] doctor_services
[ ] doctor_service_booking_rules
[ ] doctor_schedules
[ ] clinic_hours
[ ] clinic_holidays
[ ] doctor_blocked_slots
[ ] appointment_slots
[ ] slot_holds
[ ] appointment_requests
[ ] appointment_action_requests
[ ] appointment_events
[ ] patients
[ ] patient_visits
[ ] conversation_sessions
[ ] conversation_messages
[ ] message_idempotency_keys
[ ] callback_requests
[ ] emergency_incidents
[ ] clinic_knowledge_base
[ ] knowledge_files
[ ] calls
[ ] call_transcripts
[ ] notification_events
[ ] audit_logs
[ ] subscription_plans
[ ] clinic_subscriptions
[ ] clinic_usage_monthly
[ ] subscription_events
[ ] supported_languages
[ ] clinic_languages
[ ] message_templates
[ ] language_packs
```

## Verify seed data

```sql
SELECT id, name, active FROM clinics;
SELECT clinic_id, agent_enabled, answering_mode, booking_mode FROM clinic_settings;
SELECT language_code, enabled, is_default FROM clinic_languages;
SELECT name, active FROM doctors;
SELECT service_name, active FROM clinic_services;
SELECT * FROM doctor_services;
SELECT slot_duration_minutes, capacity_per_slot, booking_horizon_days FROM doctor_service_booking_rules;
```

Expected:

```text
[ ] At least one demo clinic exists
[ ] agent_enabled = false by default
[ ] booking_mode = pending_confirmation
[ ] ta_tanglish default language exists
[ ] english enabled
[ ] at least one clinic_admin user exists
[ ] at least one doctor profile exists
[ ] at least one clinic service exists
[ ] at least one doctor-service mapping exists
[ ] booking rule exists with capacity_per_slot > 0
```

## Constraint checks

Try inserting invalid data and confirm it fails:

```text
[ ] doctor_service with wrong clinic_id fails
[ ] appointment_slot with doctor/service from different clinic fails
[ ] appointment_request without clinic_id fails
[ ] duplicate slot window for same doctor-service/config is prevented
[ ] status check constraints reject invalid status
```

## Pass condition

C01 passes when migrations run on a fresh DB, seed data loads, constraints protect tenant boundaries, and no production table requires manual hidden data to work.
