# C02 Auth, RBAC, and Onboarding - What to Test and How

## Goal
Verify login/membership foundations, platform onboarding, admin/doctor permissions, and user enable/disable behavior.

## Dev auth checks

```bash
curl -H "x-dev-user-role: clinic_admin" http://localhost:3000/v1/me
curl -H "x-dev-user-role: doctor" http://localhost:3000/v1/me
```

Expected:

```text
[ ] Admin /v1/me returns clinic membership with role clinic_admin
[ ] Doctor /v1/me returns role doctor and doctor_id
[ ] Unknown/inactive user is rejected
[ ] Production mode does not allow dev auth
```

## Platform onboarding flow

Test internal clinic creation API or CLI:

```text
platform admin creates clinic
```

Verify DB rows created:

```sql
SELECT * FROM clinics ORDER BY created_at DESC LIMIT 1;
SELECT * FROM clinic_settings ORDER BY created_at DESC LIMIT 1;
SELECT * FROM clinic_languages ORDER BY created_at DESC LIMIT 5;
SELECT * FROM clinic_subscriptions ORDER BY created_at DESC LIMIT 1;
SELECT * FROM clinic_users ORDER BY created_at DESC LIMIT 5;
SELECT * FROM clinic_onboarding_checklist ORDER BY created_at DESC LIMIT 1;
SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 5;
```

Expected:

```text
[ ] clinics row created
[ ] clinic_settings row created with agent_enabled=false
[ ] clinic_languages created
[ ] clinic_subscription created if subscription tables enabled
[ ] first clinic_admin membership created
[ ] onboarding checklist created
[ ] audit log created
```

## Doctor without login

Using clinic admin API:

```text
Create doctor profile without user login.
```

Verify:

```sql
SELECT id, name, user_id, active FROM doctors WHERE name ILIKE '%Priya%';
```

Expected:

```text
[ ] doctor_id exists
[ ] user_id is null
[ ] admin can configure schedule/service/fees for this doctor
```

## Doctor login later

Invite/link doctor login.

Verify:

```sql
SELECT u.id, u.name, cu.role, cu.doctor_id, cu.active
FROM users u JOIN clinic_users cu ON cu.user_id = u.id
WHERE cu.role = 'doctor';
```

Expected:

```text
[ ] user row created
[ ] clinic_users row links user_id to existing doctor_id
[ ] doctor can only access own data
```

## RBAC checks

```text
[ ] Admin can access clinic-wide setup APIs
[ ] Admin can see Call Inbox APIs
[ ] Admin can toggle agent setting
[ ] Doctor cannot see Call Inbox
[ ] Doctor cannot toggle agent
[ ] Doctor can access own appointments
[ ] Doctor cannot access another doctor's appointments
[ ] Doctor can edit own schedule only
[ ] Inactive clinic_users.active=false blocks access to clinic
[ ] doctors.active=false stops new routing/slots but does not delete history
```

## Pass condition

C02 passes when platform onboarding creates safe defaults, doctor login mapping works, and every protected endpoint enforces clinic role and doctor ownership.
