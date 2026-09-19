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
2. Replace the Supabase placeholders in `DATABASE_URL` with the connection string copied from Supabase. For Vercel/serverless, select the **Transaction pooler** connection (port `6543`); do not use the session pooler on port `5432`. Keep the password in the server's secret manager or ignored `.env` file; never commit it.
3. Set `APP_ENV=qa`, `staging`, or `production`. These environments reject `localhost` and non-Supabase database URLs at startup.
4. Run `pnpm install` and `pnpm db:migrate` against the Supabase database.
5. Start the API and web applications. Every clone configured with the same `DATABASE_URL` will read and write the same Supabase data.

The web application also needs `apps/web/.env.local` with `API_BASE_URL` pointing to the running backend. In hosted environments, configure `API_BASE_URL` as a server-side environment variable (for example, `https://api.example.com`) and do not expose backend secrets to the browser. The web app sends browser requests through its same-origin `/api/backend` proxy, avoiding cross-origin and mixed-content failures. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are only used for browser Realtime subscriptions; they are not database credentials. The current Realtime subscription refreshes the knowledge-base page when `clinic_knowledge_base` changes.

### Vercel web deployment

The root Vercel project deploys the Next.js web application only. The Nest API must run at a publicly reachable HTTPS origin; `localhost` on Vercel is the isolated Vercel runtime, not the computer or server running the API.

1. Deploy `apps/api` as the separate NestJS Vercel project and expose its `/v1/health` endpoint over HTTPS. Set its `DATABASE_URL` to Supabase's Transaction pooler URL (port `6543`). The deployment validator rejects a Vercel build that still uses the session pooler.
2. In the Vercel web project, set the server-only `API_BASE_URL` to that API origin, without `/v1` (for example, `https://api.example.com`). Do not set `NEXT_PUBLIC_API_BASE_URL`.
3. Ensure Vercel's Production Branch contains the current same-origin proxy, then redeploy after changing the environment variable. Vercel environment changes do not affect old deployments.
4. Verify the API directly, then verify `https://<web-domain>/api/backend/v1/health` before testing sign-in.

Use a separate Supabase/staging database for Vercel Preview deployments. If Preview must temporarily share the production project, it must still use the Transaction pooler URL; never configure Production and Preview with the session-pooler URL.

For production background jobs, use `QUEUE_MODE=bullmq`, provide `REDIS_URL`, and run `pnpm --filter @vaidya/api worker` as a separate persistent worker service. Run `pnpm db:migrate` as a release step rather than on every application startup.

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
