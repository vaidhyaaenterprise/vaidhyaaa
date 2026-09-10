# P06 - Platform Admin Onboarding UI

## Purpose

Build internal platform admin screens for controlled clinic onboarding. This is not visible to clinic admins or doctors.

## Prerequisites

- Platform admin APIs exist.
- RBAC can identify platform_admin.
- Clinic setup APIs exist or are stubbed.

## Screens

### 1. Platform clinics list

Path suggestion:

```text
/internal/platform/clinics
```

Columns:

- clinic name
- city
- phone
- onboarding status
- agent_enabled
- plan
- active/suspended
- created_at
- actions

Actions:

- create clinic
- view onboarding
- suspend/activate
- invite admin

### 2. Create clinic wizard

Fields:

- clinic name
- clinic phone
- address
- city/state/country
- timezone default Asia/Kolkata
- fallback phone
- default language ta_tanglish
- initial plan/pilot
- initial clinic admin name
- clinic admin phone/email

Submit calls:

```http
POST /internal/platform/clinics
```

### 3. Onboarding status detail

Show checklist:

- clinic details done
- admin user done
- clinic hours done
- doctors done
- services done
- doctor-service mapping done
- schedules done
- booking rules done
- knowledge base done
- telephony setup done
- test conversation done
- ready for agent

### 4. Invite admin

Calls:

```http
POST /internal/platform/clinics/:clinicId/admins/invite
```

## UX rules

- Platform pages must not appear for clinic_admin or doctor.
- Creation failure must show backend error code/message.
- Agent should not be enabled automatically on clinic creation.
- Onboarding status should clearly show incomplete requirements.

## Tests

1. platform_admin can view clinics list.
2. clinic_admin cannot access internal platform route.
3. doctor cannot access internal platform route.
4. Create clinic wizard validates required fields.
5. Successful create displays new clinic.
6. New clinic shows agent disabled.
7. Onboarding checklist renders.
8. Suspend/activate actions work with confirmation modal.
9. Error response format is displayed cleanly.

## Acceptance criteria

- Internal platform onboarding UI works end-to-end with backend.
- No direct DB access from frontend.
- RBAC restrictions enforced client and server side.
