# C04 - Final Schema Alignment If Needed

## Purpose

Align the current database schema with the final production Vaidya design. Do not rewrite working code unnecessarily. Inspect existing migrations/schema first, then add only missing tables/columns/constraints.

## Context

Common milestones are already completed. This milestone exists because the design evolved after the first prompt pack. The schema must support:

- appointment slot capacity model
- slot_holds
- doctor_service_booking_rules
- appointment_action_requests
- platform onboarding
- subscriptions
- language extensibility
- notification outbox
- telephony settings
- background jobs

## Instructions to coding agent

Inspect the current repository, migrations, Drizzle schema, and SQL files. Compare with the final design PDF. Implement schema alignment without breaking existing migrations.

Use PostgreSQL as source of truth. Redis is not source of truth.

## Required tables/fields to verify or add

### Core tenancy and users

- clinics
- clinic_settings
- users
- clinic_users
- clinic_onboarding_checklist
- clinic_telephony_settings

### Doctors and services

- doctors
- clinic_services
- doctor_services
- doctor_service_booking_rules
- doctor_schedules
- clinic_hours
- clinic_holidays
- doctor_blocked_slots
- doctor_fees if fees are separate from service rules

### Patients and appointments

- patients
- patient_visits
- appointment_slots
- slot_holds
- appointment_requests
- appointment_events
- appointment_action_requests

### Conversation and calls

- conversation_sessions
- conversation_messages
- message_idempotency_keys
- calls
- call_transcripts
- callback_requests
- emergency_incidents

### Knowledge and language

- knowledge_files
- clinic_knowledge_base
- knowledge_answer_versions or equivalent
- supported_languages
- clinic_languages
- message_templates
- language_packs

### Notifications, audit, subscriptions

- notification_events
- audit_logs
- subscription_plans
- clinic_subscriptions
- clinic_usage_monthly
- subscription_events

## Required production constraints

Add or verify:

- every clinic-owned table has clinic_id
- composite uniqueness `(clinic_id, id)` where referenced by composite FKs
- foreign keys include clinic_id where possible
- no hard delete assumptions
- appointment status check constraints
- slot status check constraints
- slot_hold status check constraints
- appointment_action_request status check constraints
- unique constraints preventing duplicate active windows
- index on appointment_slots by clinic, doctor, service, start_time
- index on appointment_requests by clinic, phone, status, appointment_start
- index on slot_holds by slot_id, status, hold_expires_at
- index on conversation_sessions by clinic_id, status
- index on notification_events by status, scheduled_at
- index on clinic_knowledge_base by clinic_id, status, category

## Appointment slot model requirements

appointment_slots must be capacity windows, not one appointment.

Required fields:

- id
- clinic_id
- doctor_id
- clinic_service_id
- start_time
- end_time
- capacity_total
- status: open | blocked | cancelled | superseded
- generated_from_rule_id
- generation_batch_id
- config_version
- created_at
- updated_at

slot_holds required fields:

- id
- clinic_id
- slot_id
- session_id nullable if manual hold
- patient_phone nullable
- status: active | expired | released | converted
- hold_expires_at
- created_at
- updated_at

appointment_requests required fields:

- id
- clinic_id
- slot_id
- slot_hold_id nullable
- patient_id nullable
- patient_name
- patient_phone
- doctor_id
- clinic_service_id
- reason_for_visit
- normalized_reason nullable
- appointment_start
- appointment_end
- status
- is_followup
- followup_of_visit_id nullable
- routing_source
- source_session_id nullable
- replaces_appointment_id nullable
- replaced_by_appointment_id nullable
- created_at
- updated_at

## Migration behavior

- Do not drop data.
- If existing tables have incompatible columns, add new columns and migration path.
- Use raw SQL where Drizzle cannot express constraints cleanly.
- Create seed-compatible defaults.

## Tests to add

1. Fresh DB migration succeeds.
2. Re-running migration is safe through normal migration system.
3. Seed data loads successfully.
4. Demo clinic has clinic_settings with agent_enabled=false.
5. Demo clinic has ta_tanglish default and english enabled.
6. Demo doctor exists without requiring user_id.
7. doctor_service_booking_rules exists for demo doctor-service mapping.
8. appointment_slots support capacity_total.
9. slot_holds table exists.
10. appointment_action_requests table exists.
11. subscription tables exist.
12. supported_languages and message_templates exist.

## Acceptance criteria

- `pnpm typecheck` passes.
- `pnpm test` passes.
- Fresh Postgres DB can migrate and seed.
- Existing app/API still starts.
- No real provider keys required.
