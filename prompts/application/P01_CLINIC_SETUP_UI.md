# Application Milestone P01 - Clinic Setup UI

## Goal
Build Clinic Setup screens for admin and limited doctor access.

## Sections
1. Bot answering mode
2. Doctor available timings
3. Clinic regular working hours
4. Holiday setup
5. Services Vaidya can route
6. Doctor-service booking rules
7. User management enable/disable

## Admin capabilities
- Edit agent_enabled, answering_mode, fallback_phone, overflow_after_rings.
- Edit booking_mode, max_concurrent_calls, retention settings.
- Create/edit/disable doctors.
- Create/edit/disable clinic services.
- Create/edit/disable doctor-service mappings.
- Edit fees on doctor-service mappings.
- Edit doctor schedules.
- Edit clinic hours.
- Add holidays.
- Edit booking rules: slot_duration, capacity, horizon, min notice, edit cutoff, max shift.
- Enable/disable clinic user access.

## Doctor capabilities
- View/edit own timings only.
- View/edit own service availability only if `allow_doctor_service_edit=true`.
- Cannot edit clinic-wide hours, holidays, agent mode, knowledge, or other doctors.

## API method rules
- clinic_settings: GET/PATCH, optional PUT, no POST.
- doctor schedules: GET/PUT full replacement/POST add/PATCH edit/disable action.
- clinic hours: GET/PUT full replacement/POST add/PATCH edit/disable action.
- booking rule: GET/PUT/PATCH.

## Conflict behavior
- Holiday/schedule/rule changes must show conflict list if future pending/confirmed appointments or active holds are affected.
- Never auto-cancel appointments.
- Block save by default when conflicts exist.

## Tests
1. Admin can edit agent settings.
2. Doctor cannot see/edit agent settings.
3. Admin can add doctor without login user.
4. Doctor login linked later shows own profile.
5. Admin can create service and doctor-service mapping.
6. Admin can configure capacity_per_slot and slot_duration.
7. Capacity decrease with conflicts shows conflict dialog.
8. Slot duration increase with conflicts shows conflict dialog.
9. Clinic holiday with existing appointment blocks save.
10. Doctor can edit own schedule only.
11. Doctor cannot edit another doctor's schedule.
12. Disabling clinic user removes access.

## Acceptance criteria
- Clinic setup is complete enough to create valid slots and enable the agent.
