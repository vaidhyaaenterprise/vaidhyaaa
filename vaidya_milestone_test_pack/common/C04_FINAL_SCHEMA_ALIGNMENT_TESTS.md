# C04 - Final Schema Alignment Tests

Purpose: verify the DB schema includes all latest production tables and columns before agent/app implementation continues.

## 1. Migration from empty DB

Run on a fresh local database:

```bash
pnpm --filter api db:migrate
pnpm --filter api db:seed
```

Expected:

- migration completes without errors
- seed completes without errors
- no table creation order FK failure
- all enum/check constraints are valid

## 2. Required new/updated tables exist

Verify these tables exist:

```text
slot_holds
doctor_service_booking_rules
appointment_action_requests
appointment_events
clinic_onboarding_checklist
clinic_telephony_settings
subscription_plans
clinic_subscriptions
clinic_usage_monthly
subscription_events
supported_languages
clinic_languages
message_templates
language_packs
notification_events
```

Also verify existing core tables still exist:

```text
clinics
clinic_settings
users
clinic_users
doctors
clinic_services
doctor_services
appointment_slots
appointment_requests
patients
patient_visits
conversation_sessions
conversation_messages
clinic_knowledge_base
calls
call_transcripts
audit_logs
```

## 3. Required appointment_slots fields

`appointment_slots` must include:

```text
clinic_id
doctor_id
clinic_service_id
start_time
end_time
capacity_total
status
generated_from_rule_id
generation_batch_id
config_version
created_at
updated_at
```

Allowed status values:

```text
open
blocked
cancelled
superseded
```

Fail if `appointment_slots.status` still uses `booked` as the main model.

## 4. Required slot_holds fields

`slot_holds` must include:

```text
clinic_id
slot_id
session_id
patient_phone
status
hold_expires_at
created_at
updated_at
```

Allowed statuses:

```text
active
expired
released
converted
```

## 5. Required doctor_service_booking_rules fields

Must include:

```text
clinic_id
doctor_id
clinic_service_id
slot_duration_minutes
capacity_per_slot
booking_horizon_days
min_booking_notice_minutes
max_advance_booking_days
manual_edit_cutoff_before_start_minutes
manual_edit_max_shift_minutes
effective_from
effective_to
active
version
created_at
updated_at
```

## 6. Required appointment_requests fields

Must include:

```text
slot_id
slot_hold_id
patient_id
patient_name
patient_phone
doctor_id
clinic_service_id
reason_for_visit
normalized_reason
appointment_start
appointment_end
status
is_followup
followup_of_visit_id
routing_source
source_session_id
replaces_appointment_id
replaced_by_appointment_id
created_at
updated_at
```

## 7. Required appointment_action_requests fields

Must include:

```text
clinic_id
appointment_id
request_type
requested_by
status
requested_new_slot_id
requested_new_date
requested_new_time_preference
reason
source_call_id
source_session_id
created_at
updated_at
```

Allowed request types:

```text
cancel
reschedule
```

Allowed statuses:

```text
pending
approved
rejected
completed
```

## 8. Foreign keys and tenant scoping

Verify all clinic-owned tables have `clinic_id` and FKs are clinic-scoped where possible.

Must reject invalid cross-clinic references:

- appointment with doctor from another clinic
- appointment with service from another clinic
- slot with doctor from another clinic
- doctor_service mapping across clinics
- knowledge answer from another clinic

## 9. No hard-delete assumption

Verify tables include soft lifecycle columns/statuses where needed:

- users.active/status
- clinic_users.active/status
- doctors.active
- clinic_services.active/status
- doctor_services.active/status
- knowledge status
- appointment status
- slot status

## 10. Seed data expectations

Seed must create:

- one demo clinic
- clinic_settings with `agent_enabled=false`
- ta_tanglish default language
- english enabled
- at least one clinic_admin
- at least one doctor profile without requiring login
- at least one doctor_service mapping
- at least one doctor_service_booking_rule
- at least one subscription plan and clinic subscription
- message templates for ta_tanglish and english
