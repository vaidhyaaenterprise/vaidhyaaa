# C06 - Platform Admin Onboarding and User Management

## Purpose

Implement controlled clinic onboarding and user/membership management. Normal clinic creation must go through backend services, not manual SQL inserts.

## Product rules

- Platform admin creates clinic first.
- Clinic creation is tenant creation.
- Agent must be disabled by default.
- First clinic admin is invited/created by platform admin.
- Clinic admin completes setup.
- Doctor profile can exist without login.
- Later doctor login links user to doctor profile through clinic_users.doctor_id.
- Clinic admin can enable/disable clinic users.
- Normal UI must not hard-delete users, doctors, or memberships.

## Internal APIs

Implement internal platform APIs guarded by platform_admin role:

```http
POST /internal/platform/clinics
GET /internal/platform/clinics
GET /internal/platform/clinics/:clinicId/onboarding
POST /internal/platform/clinics/:clinicId/admins/invite
POST /internal/platform/clinics/:clinicId/suspend
POST /internal/platform/clinics/:clinicId/activate
```

## POST /internal/platform/clinics

Request shape:

```json
{
  "clinic": {
    "name": "Sri Murugan Clinic",
    "phone": "+9144XXXXXXX",
    "address_line1": "Anna Nagar",
    "city": "Chennai",
    "state": "Tamil Nadu",
    "country": "India",
    "timezone": "Asia/Kolkata",
    "default_language_code": "ta_tanglish"
  },
  "settings": {
    "fallback_phone": "+919840000000",
    "booking_mode": "pending_confirmation",
    "answering_mode": "off",
    "max_concurrent_calls": 1
  },
  "admin": {
    "name": "Clinic Admin",
    "phone": "+919840012345",
    "email": "admin@clinic.com"
  },
  "subscription": {
    "plan_key": "pilot",
    "status": "trialing"
  }
}
```

Backend transaction must create:

- clinics
- clinic_settings with `agent_enabled=false`
- clinic_languages ta_tanglish default, english enabled
- clinic_subscriptions if subscription tables exist
- users row for clinic admin or invited local user
- clinic_users role clinic_admin
- clinic_onboarding_checklist
- audit_logs event clinic_created

## Clinic admin user management APIs

```http
GET /v1/clinic/users
POST /v1/clinic/users/invite
POST /v1/clinic/users/:clinicUserId/disable
POST /v1/clinic/users/:clinicUserId/enable
```

Rules:

- Disabling clinic_users.active=false removes access to that clinic only.
- It does not disable doctors.active.
- Platform admin can globally disable users.active=false.
- Doctor profile may exist without user.

## Doctor login linking

When admin invites doctor login:

- create or link users row
- create clinic_users row role=doctor, doctor_id=existing doctor id
- doctor profile remains the same clinical identity

## Agent enable readiness check

When `PATCH /v1/clinic/settings { agent_enabled: true }` is called, backend must validate onboarding readiness:

- fallback_phone exists
- at least one active doctor
- at least one active clinic_service
- at least one active doctor_service mapping
- at least one active booking rule
- clinic hours or doctor schedules configured
- future slots generated or can be generated

If missing, return `CLINIC_SETUP_INCOMPLETE`.

## Tests

1. Platform admin can create clinic.
2. Clinic created with agent_enabled=false.
3. Clinic settings row created.
4. Clinic languages created.
5. First clinic admin membership created.
6. Non-platform user cannot call internal platform API.
7. Clinic admin can invite doctor login and link existing doctor_id.
8. Doctor profile can exist with no user_id.
9. Disabled clinic_user cannot access clinic APIs.
10. Disabling doctor profile prevents routing/slot generation but does not delete history.
11. Agent enable fails if setup incomplete.
12. Agent enable succeeds after setup readiness is satisfied.

## Acceptance criteria

- All onboarding writes are transactional.
- Audit logs exist for clinic creation, user invite, user disable/enable, agent toggle.
- No direct SQL manual onboarding required in production.
