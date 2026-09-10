# Common Milestone C01 - Database, Drizzle, Migrations, Seed

## Goal
Implement the PostgreSQL schema from `sql/001_initial_schema_production.sql`, wire Drizzle, and add minimal QA seed data.

## Inputs
- `sql/001_initial_schema_production.sql`
- `sql/002_seed_minimal_qa.sql`
- Uploaded design PDF

## Implementation requirements
1. Configure Drizzle for SQL-first migrations.
2. Use the SQL file as the initial migration. Do not let ORM auto-redesign schema.
3. Add a DB module in NestJS.
4. Expose typed repository helpers for common tables.
5. Add seed command for QA/dev.
6. Add migration status command.
7. Add DB reset command only for local/QA, never production.

## Schema rules to preserve
- `appointment_slots` is a capacity window, not a booking.
- `slot_holds` is temporary reservation after slot selection.
- `appointment_requests` is actual appointment/request.
- `doctor_service_booking_rules` controls slot duration/capacity per doctor-service.
- `users` are login identities.
- `clinic_users` are clinic memberships/roles.
- `doctors` are clinical profiles and may exist without login.
- `clinic_settings.agent_enabled` controls agent runtime behavior.
- `clinic_telephony_settings` maps clinic to provider number.
- `clinic_onboarding_checklist` prevents premature agent enablement.
- `notification_events` is the async outbox.

## Critical DB service functions to stub now
- `getClinicScopedRecordOrThrow`
- `assertDoctorBelongsToClinic`
- `assertServiceBelongsToClinic`
- `assertDoctorHandlesService`
- `withTransaction`
- `withSlotForUpdate`
- `insertAuditLog`

## Tests
1. Migration applies cleanly to empty database.
2. Seed applies after migration.
3. Seed creates one clinic, admin, doctors, services, doctor-service mappings, booking rules, templates, and knowledge rows.
4. Composite clinic-scoped FK prevents doctor from another clinic being used.
5. `appointment_slots.capacity_total > 0` constraint works.
6. `appointment_slots.end_time > start_time` constraint works.
7. `slot_holds.status` rejects invalid value.
8. `appointment_requests.reason_for_visit` is required.
9. Patient phone/name uniqueness works with normalized fields.
10. No table stores MP3 binary data.

## Acceptance criteria
- Migration and seed scripts are reproducible.
- DB schema matches the implementation SQL.
- All DB tests pass.
