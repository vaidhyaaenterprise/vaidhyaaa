# Regression Checklist After Every Milestone

Run this after every common, agent, and application milestone.

## Commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## API health

```bash
curl http://localhost:3000/health
```

Expected:

```text
[ ] API healthy
[ ] request_id present/logged
[ ] no unhandled exception in terminal
```

## DB smoke

```sql
SELECT COUNT(*) FROM clinics;
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM clinic_users;
SELECT COUNT(*) FROM doctors;
SELECT COUNT(*) FROM clinic_services;
SELECT COUNT(*) FROM doctor_services;
```

Expected:

```text
[ ] Seed data still exists
[ ] Migrations still work on fresh DB
```

## RBAC smoke

```text
[ ] Admin can access admin-only API
[ ] Doctor cannot access call inbox
[ ] Doctor cannot access another doctor's data
```

## Safety smoke

Through text console/API:

```text
Chest pain irukku -> emergency response
Fever-ku enna tablet? -> medical advice refusal
```

Expected:

```text
[ ] No medical advice
[ ] Emergency creates alert/incident when that module exists
```

## Booking smoke once agent booking exists

```text
Naalaikku evening appointment venum
Knee pain
6:30
Kumar
Seri
```

Expected:

```text
[ ] pending appointment request created
[ ] reason_for_visit stored
[ ] slot capacity consumed correctly
```

## UI smoke once web exists

```text
[ ] Admin sees all five tabs
[ ] Doctor does not see Call inbox
[ ] Doctor sees only own appointments
[ ] No console runtime errors
```
