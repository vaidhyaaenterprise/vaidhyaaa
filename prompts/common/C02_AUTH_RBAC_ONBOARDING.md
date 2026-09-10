# Common Milestone C02 - Auth, RBAC, Platform Onboarding

## Goal
Build the minimum production-safe auth/RBAC and platform onboarding foundation.

## Important priority rule
Login UI is low priority, but backend RBAC is high priority. Build dev auth first, then OTP stubs/provider adapter.

## Concepts
- `users` = login identities.
- `clinic_users` = clinic-specific membership and role.
- `doctors` = clinical profiles; can exist without login.
- patients are not users.
- platform admin creates clinic first in v1.

## Required backend behavior
1. Support `AUTH_MODE=dev` for local only.
2. Implement `GET /v1/me`.
3. Implement RBAC guard.
4. Implement platform admin guard.
5. Implement clinic admin guard.
6. Implement doctor ownership guard.
7. Implement internal platform onboarding API:

```http
POST /internal/platform/clinics
GET /internal/platform/clinics
GET /internal/platform/clinics/{clinicId}/onboarding
POST /internal/platform/clinics/{clinicId}/admins/invite
POST /internal/platform/clinics/{clinicId}/suspend
POST /internal/platform/clinics/{clinicId}/activate
```

## Platform clinic creation must create in one transaction
- `clinics`
- `clinic_settings` with `agent_enabled=false`, `answering_mode=off`, `booking_mode=pending_confirmation`
- `clinic_languages`
- `clinic_subscriptions`
- first admin `users` row or invited placeholder
- `clinic_users` row with role `clinic_admin`
- `clinic_onboarding_checklist`
- audit log

## OTP login endpoints
Implement stubs or provider adapter-ready endpoints:

```http
POST /v1/auth/request-otp
POST /v1/auth/verify-otp
GET /v1/me
POST /v1/auth/logout
```

OTP should only work for invited/known users. Do not allow open self-signup in v1.

## User enable/disable
Clinic admin can set `clinic_users.active=false` for that clinic. Platform admin can set `users.active=false` globally.

## Doctor without login flow
When admin creates doctor:
- create `doctors` row
- `doctors.user_id` can be null
- schedules/services/fees can be configured

When doctor is invited later:
- create/link `users` row
- create `clinic_users` with role `doctor` and `doctor_id`
- doctor can access only own data

## Tests
1. Platform admin can create clinic and initial settings.
2. Newly created clinic has `agent_enabled=false`.
3. Clinic admin membership is created.
4. Doctor profile can exist without user login.
5. Doctor login can be linked later through `clinic_users.doctor_id`.
6. Doctor cannot access another doctor's appointment.
7. Clinic admin can disable clinic user membership.
8. Disabled clinic user cannot access clinic APIs.
9. Platform admin can globally disable a user.
10. Normal clinic admin cannot call `/internal/platform/*`.

## Acceptance criteria
- RBAC is enforced in backend.
- Dev auth is available locally only.
- Clinic onboarding creates all required records consistently.
