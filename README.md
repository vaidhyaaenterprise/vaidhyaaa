# Vaidhyaa

Vaidhyaa is a text-first, voice-ready clinic receptionist platform.

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

Browser login is shared across tabs on the same Vaidhyaa origin. Login writes one atomic, versioned browser-session envelope containing the bearer token and selected account; a duplicated tab or a newly opened deep link copies that envelope into its tab storage and validates it through `/v1/me` before rendering protected content. Account changes and sign-out propagate to every open Vaidhyaa tab. Legacy standalone `localStorage` profiles cannot authenticate a session, credentials are never placed in URLs, and malformed or mismatched shared sessions fail closed. Reloads, SPA navigation and BFCache restores retain and revalidate the current session. API requests and authentication checks discard results from an earlier login and never substitute a local mock account after a failed identity check.

During an upgrade, a retained bearer token without a tab profile is verified through `/v1/me` before reconstructing the profile from the returned memberships. Token scope or an exact legacy account hint may disambiguate those verified memberships; an arbitrary first membership is never selected. A profile alone cannot sign in. A shared signed-out marker prevents a copied older tab from resurrecting a logged-out session.

Doctor navigation uses `/doctor` for Today, `/doctor/analytics`, `/doctor/patient-history`, and `/doctor/settings`. These are real routes: refresh, duplication, opening a link in another tab, and browser Back/Forward retain the selected section. An unauthenticated deep link preserves its destination through sign-in using a role-appropriate internal allowlist; Clinic Admin's home remains `/`.

The root Vercel project deploys the Next.js web application only. The Nest API must run at a publicly reachable HTTPS origin; `localhost` on Vercel is the isolated Vercel runtime, not the computer or server running the API.

1. Deploy `apps/api` as the separate NestJS Vercel project and expose its `/v1/health` endpoint over HTTPS. Set its `DATABASE_URL` to Supabase's Transaction pooler URL (port `6543`). The deployment validator rejects a Vercel build that still uses the session pooler.
2. In the Vercel web project, set the server-only `API_BASE_URL` to that API origin, without `/v1` (for example, `https://api.example.com`). Do not set `NEXT_PUBLIC_API_BASE_URL`.
3. Ensure Vercel's Production Branch contains the current same-origin proxy, then redeploy after changing the environment variable. Vercel environment changes do not affect old deployments.
4. Verify the API directly, then verify `https://<web-domain>/api/backend/v1/health` before testing sign-in.

Use a separate Supabase/staging database for Vercel Preview deployments. If Preview must temporarily share the production project, it must still use the Transaction pooler URL; never configure Production and Preview with the session-pooler URL.

For production background jobs, use `QUEUE_MODE=bullmq`, provide `REDIS_URL`, and run `pnpm --filter @vaidya/api worker` as a separate persistent worker service. Run `pnpm db:migrate` as a release step rather than on every application startup.

Confirmed appointments stay confirmed for the entire appointment date in the clinic's timezone, even after their scheduled time has passed. Once that date has ended, `MARK_APPOINTMENT_NO_SHOWS` changes unvisited confirmed appointments to `no_show`, records a system event, and rejects their stale pending action requests atomically. Visited, cancelled, pending-confirmation and future appointments are excluded. The persistent worker checks every five minutes. Vercel schedules `GET /internal/jobs/appointment-no-shows` at 19:00 UTC (00:30 in India); configure the API's `CRON_SECRET` as for call retention. [Vercel Hobby cron execution can occur anywhere within its scheduled hour](https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs#cron-jobs-accuracy); 19:00 UTC ensures this fallback cannot run before India midnight. Appointment list reads also reconcile overdue confirmations before returning data. An open Appointments page refreshes at the clinic-date rollover and displays these records under **No show**, including when filtering by date. Retry a failed run with `pnpm --filter @vaidya/api jobs:run appointment-no-shows`. Existing overdue confirmed appointments are included on the first run; no schema migration is required.

Call Inbox has a fixed rolling **30-day display window**, enforced by the API for every inbox source, including explicit date-range queries. Call logs and their transcripts are permanently deleted once older than **45 days** (call start time, falling back to creation time); linked appointments, patient records, callback requests, and emergency/action records are preserved. The existing object-storage adapter is invoked before deleting managed recording keys (provider-hosted media has its own retention). A daily `CLEANUP_EXPIRED_CALLS` job runs in the persistent BullMQ worker. For Vercel, `apps/api/vercel.json` schedules `GET /internal/jobs/call-retention` daily at 03:30 UTC; set a strong `CRON_SECRET` on the API so Vercel can authenticate it. Internal routes are excluded from the `/v1` prefix. Other hosts must schedule the same endpoint with `Authorization: Bearer <CRON_SECRET>` or run the persistent worker. Cleanup is not dependent on someone opening the inbox. Monitor scheduler/worker failures: storage/database failures or an unfinished serverless batch return an error, never a false success. Retry an unfinished run with `pnpm --filter @vaidya/api jobs:run call-retention` until it completes; BullMQ retries failed jobs automatically. Daily cleanup means deletion occurs on the first successful run after expiry. This change requires deployment and an active scheduler, but no new database migration. It does not delete existing production data merely by editing/building the code.

Clinic hours, doctor schedules, holidays and booking-rule changes save their configuration with a durable slot-reconciliation job in the existing `background_jobs` table. The web API proxy runs these jobs with Next.js `after()` after returning the save response. Slot generation and retirement do not delay Save; appointment-conflict validation still runs before accepting the change. Affected slots cannot be offered or booked until reconciliation completes.

For recovery after a serverless timeout or process restart, keep the persistent worker above running (it also polls slot-reconciliation jobs, with or without Redis), **or** configure a scheduler to call `GET /v1/internal/jobs/slot-reconciliation` on the API at least once per minute with `Authorization: Bearer <CRON_SECRET>`. Set `CRON_SECRET` on the API only; the endpoint rejects calls when it is unset. Scheduling frequency depends on your hosting plan. No new migration is required. Failed jobs retry up to five times with backoff; exhausted failures appear in platform job health and keep stale slots unavailable. After resolving the underlying failure, replay them with `pnpm --filter @vaidya/api jobs:run slot-reconciliation --retry-failed`. Normal recovery/draining can be run with `pnpm --filter @vaidya/api jobs:run slot-reconciliation`.

Booking-rule cutovers retain an earlier effective configuration and reconcile each version only within its own date range. Generation, retirement and capacity updates share one clinic-locked database transaction, so a failed attempt cannot commit half a replacement. Existing appointments and active holds are preserved. Booking rules polls a clinic/doctor-scoped status endpoint and shows updating or failed work; clinic administrators can use **Retry slot update** to requeue failed jobs and request a fresh clinic repair without resaving configuration. Availability requests return `SLOT_UPDATE_PENDING` or `SLOT_UPDATE_FAILED` instead of a misleading empty list while reconciliation blocks booking. The runner reports failed counts explicitly; `processed` is an attempt count, not a success count. Deploy both API and web changes before using the new status/retry controls. Already-failed production jobs are not replayed merely by deploying: use the scoped UI retry or the operator command after deployment.

Saving **All doctors** replaces the weekly schedules of every currently active doctor in that clinic, in one transaction, after validating every doctor’s appointments and clinic-hour coverage. It does not create a default for doctors added later. Select one doctor before editing to change only that doctor.

The Doctor Portal's **Settings** tab uses the same holiday, doctor schedule, and booking-rule records as Clinic setup. Doctors can edit their own weekly hours, slot duration/capacity, and individual holidays; appointment conflicts and safe booking-rule cutovers use the same validation as clinic administrators. Clinic-wide and shared holidays are visible but only clinic administrators can edit them. The API derives doctor ownership from the authenticated clinic membership, rejects requests for other doctors or unlinked profiles, and queues personal holiday updates only for that doctor. Slot update status is scoped to the doctor, while retries remain administrator-only. The sidebar shows the saved doctor qualification and read-only clinic address, with Logout at the bottom. Deploy both web and API changes; no migration is needed.

The doctor appointment dashboard reads confirmed/visited appointments for its selected clinic-local calendar date and signed-in doctor. `GET /v1/clinics/:clinicId/appointments` accepts optional `date=YYYY-MM-DD` alongside its existing status filter; omitting the date retains the existing list behavior. Responses include nullable `patient_age`/`patient_gender` from the linked same-clinic patient and `has_history` from other clinical visits. The dashboard does not substitute sample patient demographics or medical notes. Working-hour labels use the saved weekday/effective doctor schedules within clinic hours, subtracting applicable full-day or partial holidays, and service labels come from active doctor-service mappings. These labels describe working hours, not free appointment slots. The dashboard refreshes on date changes, focus, and returning from doctor Settings.

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

Patient History supports `GET /v1/clinics/:clinicId/patients/history` with optional `phone`, `name`, `age`, and `date=YYYY-MM-DD` filters; at least one is required. Date can be used alone or combined with the other fields. It selects patients with appointments on that clinic-local calendar day in any status, without duplicating patients or limiting the day to 50 patients. Opening a patient still shows their complete history across all dates.

Clinic admins can correct an appointment's status from the Patient History popup with `PATCH /v1/clinics/:clinicId/appointments/:appointmentId/status`. The request accepts only `{ "status": "confirmed" | "cancelled" | "no_show" | "visited" }`; dates, patient details, and clinical notes cannot be edited through this endpoint. Linked appointment/visit history rows display the same current appointment status. This correction does not create or delete clinical visits. Restoring a future appointment to confirmed rechecks the original slot under a lock and rejects full or unavailable slots. An explicit confirmed correction made after the appointment day is preserved by no-show reconciliation; rescheduling invalidates that historical exception. Ordinary confirmations made before the end of the appointment day still expire normally.

## Milestones

Build milestone by milestone from `/prompts` and `/docs`. C00 + C00.1 bootstrap the foundation only — no business flows yet.

## Documents

See `/docs`, `/prompts`, and `/infra/sql`.
