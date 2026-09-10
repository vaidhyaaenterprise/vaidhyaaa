# P01 Clinic Setup UI - What to Test and How

## Goal
Verify clinic settings, doctors, schedules, clinic hours, holidays, services, doctor-service mappings, booking rules, and agent enablement UI.

## Admin setup sections

```text
[ ] Bot answering mode
[ ] Doctor available timings
[ ] Clinic regular working hours
[ ] Holiday setup
[ ] Services Vaidya can route
[ ] Doctor-service booking rules
[ ] User enable/disable management if included
```

## Clinic settings tests

```text
[ ] GET /v1/clinic/settings loads settings
[ ] PATCH can turn agent_enabled on/off
[ ] PATCH can update fallback_phone
[ ] booking_mode defaults pending_confirmation
[ ] agent cannot be enabled if onboarding incomplete
[ ] agent toggle is admin-only
```

## Doctor profile tests

```text
[ ] Admin can create doctor profile without login user
[ ] doctor_id generated immediately
[ ] user_id can be null
[ ] Admin can later invite/link doctor login
[ ] Admin can disable doctor login by clinic_users.active=false
[ ] Admin can disable doctor profile by doctors.active=false
```

## Schedules and clinic hours

```text
[ ] PUT full doctor weekly schedule works
[ ] POST add one doctor schedule window works
[ ] PATCH edit one doctor schedule window works
[ ] Disable schedule window works; no hard delete
[ ] PUT full clinic hours works
[ ] POST/PATCH clinic-hour window works
[ ] Split sessions per day are supported
```

## Conflict handling

When changing schedule/holiday/clinic hours:

```text
[ ] Conflict preview runs
[ ] Future pending/confirmed conflicting appointments are listed
[ ] No auto-cancel happens
[ ] Change is blocked by default if conflicts exist
```

## Doctor-service booking rules

```text
[ ] Admin can set slot_duration_minutes
[ ] Admin can set capacity_per_slot
[ ] Admin can set booking_horizon_days default 45
[ ] Admin can set manual_edit_cutoff_before_start_minutes
[ ] Admin can set manual_edit_max_shift_minutes
[ ] Changing rules triggers preview/regeneration flow
```

## Doctor view

```text
[ ] Doctor can edit own schedule only
[ ] Doctor cannot edit clinic hours
[ ] Doctor cannot edit holidays
[ ] Doctor cannot edit other doctors
[ ] Doctor service editing depends on clinic setting
```

## Pass condition

P01 passes when admin can fully configure clinic setup safely and doctor setup access is limited to own data.
