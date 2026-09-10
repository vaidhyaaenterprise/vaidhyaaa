# C06 - Platform Admin Onboarding and User Management Tests

Purpose: verify clinic onboarding, users vs clinic_users, doctor profile without login, and user enable/disable flows.

## 1. Platform admin bootstrap

Verify a platform admin can exist outside clinic membership.

Expected:

- platform admin can access internal platform endpoints
- clinic admin cannot access internal platform endpoints
- doctor cannot access internal platform endpoints

## 2. Create clinic flow

Call internal onboarding endpoint/CLI:

```text
POST /internal/platform/clinics
```

Expected DB rows created in one transaction:

```text
clinics
clinic_settings
clinic_languages
clinic_subscriptions
users or invited user
clinic_users for first clinic_admin
clinic_onboarding_checklist
audit_logs
```

Expected defaults:

```text
agent_enabled=false
answering_mode=off
booking_mode=pending_confirmation
recording_retention_days=10
transcript_retention_days=30
default language=ta_tanglish
english enabled
```

## 3. Failed onboarding rollback

Force invalid admin email/phone or subscription plan.

Expected:

- no partial clinic rows remain
- transaction rolls back
- standard error response returned
- audit failure event optional but no broken tenant exists

## 4. Doctor without login

Clinic admin creates a doctor profile.

Expected:

- doctors row created with doctor_id
- doctors.user_id can be null
- no users row required
- admin can add schedules/services/fees for that doctor
- doctor can receive appointments without login

## 5. Doctor later login mapping

Invite login for existing doctor profile.

Expected:

- users row created or linked
- clinic_users row created with role=doctor and doctor_id=existing doctor id
- doctor_id remains unchanged
- doctor login sees only own appointments/schedules/services

## 6. Enable/disable clinic user

Clinic admin disables doctor user access.

Expected:

- clinic_users.active=false
- user cannot access that clinic
- doctor profile may remain active
- appointments can still be created for doctor if doctors.active=true

## 7. Disable doctor profile

Clinic admin disables doctor profile.

Expected:

- doctors.active=false
- no new slots generated
- service routing does not choose this doctor
- existing future appointments become conflict/action needed or remain visible for manual action

## 8. Agent enable readiness check

Try enabling agent before setup complete.

Expected:

- rejected with CLINIC_SETUP_INCOMPLETE
- missing checklist items returned
- audit log records failed attempt if required

After completing required setup, enabling agent succeeds.
