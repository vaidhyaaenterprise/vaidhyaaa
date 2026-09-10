# Vaidya

Vaidya is a text-first, voice-ready clinic receptionist platform.

## Monorepo layout

```text
apps/api          NestJS + Fastify API (modular monolith, /v1 prefix)
apps/web          Next.js + Tailwind web shell
packages/config   Zod environment validation
packages/shared   API envelopes, error codes, RBAC, adapter interfaces
packages/db       Drizzle client + schema baseline pointer
packages/test-utils
infra/sql         Production SQL migrations (canonical; sql/ is legacy copy)
```

Backend modules (stubs): `AuthModule`, `ClinicsModule`, `ClinicSetupModule`, `DoctorsModule`, `AppointmentModule`, `ConversationModule`, `KnowledgeModule`, `CallInboxModule`, `NotificationModule`, `AuditModule`, `JobsModule`.

## Stack

- Backend: NestJS + TypeScript + Fastify adapter
- Frontend: Next.js + TypeScript + Tailwind CSS
- Database: PostgreSQL
- ORM/migrations: Drizzle + SQL migrations (`infra/sql`)
- Validation: Zod shared schemas

## Supabase Deployment

All application instances must use the same Supabase PostgreSQL connection string. The backend does not replicate data between local databases; it writes directly to the database in `DATABASE_URL`. The shared API database client and migration runner also reject local database URLs outside test mode.

1. Copy `.env.example` to `.env` on the server.
2. Replace the Supabase placeholders in `DATABASE_URL` with the server-side database connection string from Supabase. Keep the password in the server's secret manager or ignored `.env` file; never commit it.
3. Set `APP_ENV=qa`, `staging`, or `production`. These environments reject `localhost` and non-Supabase database URLs at startup.
4. Run `pnpm install` and `pnpm db:migrate` against the Supabase database.
5. Start the API and web applications. Every clone configured with the same `DATABASE_URL` will read and write the same Supabase data.

The web application also needs `apps/web/.env.local` with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for browser Realtime subscriptions. These are not database credentials. The current Realtime subscription refreshes the knowledge-base page when `clinic_knowledge_base` changes.

Tests are the only supported local-database workflow. Set `NODE_ENV=test`/`APP_ENV=local` and use `TEST_DATABASE_URL` for the test Postgres container.

## Quick start

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm build
pnpm dev
```

- API: http://localhost:3000/v1/health
- Conversation test console: http://localhost:3000/v1/dev/conversation-console
- Web: http://localhost:3001

## Commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm dev:api
pnpm dev:web
pnpm conversation:console
```

## API conventions

- All routes are under `/v1`
- Success: `{ "data": {...}, "meta": { "request_id": "req_...", "debug": null } }`
- Error: `{ "error": { "code", "message", "details", "request_id" } }`

## Milestones

Build milestone by milestone from `/prompts` and `/docs`. C00 + C00.1 bootstrap the foundation only — no business flows yet.

## Documents

See `/docs`, `/prompts`, and `/infra/sql`.
