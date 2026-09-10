# Common Milestone C00 - Project Bootstrap

Paste this into Cursor / Antigravity / Codex.

## Goal
Create the production project foundation for Vaidya from scratch. Do not implement business flows yet.

## Design source
Use the uploaded Vaidya production LLD PDF as the source of truth. Use `sql/001_initial_schema_production.sql` as the implementation schema baseline.

## Final stack
- Backend: NestJS + TypeScript using Fastify adapter
- Frontend: Next.js + TypeScript + Tailwind CSS
- Validation: Zod shared schemas where practical
- DB: PostgreSQL
- ORM/query: Drizzle ORM + SQL migrations
- Queue later: BullMQ + Redis/Valkey through interfaces
- Object storage later: S3-compatible provider adapter
- Auth later: OTP/Supabase Auth equivalent, but RBAC model must exist now

## Repo structure
Create a monorepo:

```text
apps/api
apps/web
packages/shared
packages/db
packages/config
packages/test-utils
infra/sql
```

Backend modules should be modular-monolith style:

```text
AuthModule
ClinicsModule
ClinicSetupModule
DoctorsModule
AppointmentsModule
ConversationModule
KnowledgeModule
CallsModule
NotificationsModule
AuditModule
JobsModule
```

## Required setup
1. Root package manager setup. Prefer pnpm.
2. TypeScript strict mode.
3. ESLint + Prettier.
4. Vitest/Jest for unit tests.
5. Supertest or equivalent for API tests.
6. Playwright optional placeholder for app E2E.
7. Environment validation using Zod.
8. Request ID middleware.
9. Standard API error shape.
10. Logger abstraction.
11. Shared DTO package placeholder.
12. No real voice, no real LLM calls, no WhatsApp integration yet.

## Standard API error format
Implement and use everywhere:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human readable message.",
    "details": {},
    "request_id": "req_..."
  }
}
```

## Error codes to define

```text
UNAUTHORIZED
FORBIDDEN
CLINIC_NOT_FOUND
DOCTOR_NOT_OWNER
SLOT_NOT_AVAILABLE
SLOT_FULL
SLOT_HOLD_EXPIRED
APPOINTMENT_NOT_FOUND
APPOINTMENT_NOT_CONFIRMABLE
APPOINTMENT_NOT_CANCELLABLE
CONFLICTING_APPOINTMENTS
KNOWLEDGE_NOT_APPROVED
VALIDATION_ERROR
IDEMPOTENCY_CONFLICT
PROVIDER_FAILURE
CLINIC_SETUP_INCOMPLETE
```

## Production rules
- No endpoint except explicit public webhooks bypasses auth in production.
- No direct DB access from frontend.
- All business writes go through services and validators.
- No hard deletes in normal UI.
- All clinic-owned rows must be scoped by `clinic_id`.

## Tests
Add tests for:
1. API health endpoint returns OK.
2. Env validation fails when required env is missing.
3. Standard error filter returns the standard error shape.
4. Request ID is attached to every API response.
5. Frontend can load shell page.
6. `npm/pnpm typecheck`, `lint`, and `test` pass.

## Acceptance criteria
- Monorepo boots.
- `apps/api` starts on local port.
- `apps/web` starts on local port.
- Typecheck/lint/test pass.
- No Vaidya business flow is implemented yet.
