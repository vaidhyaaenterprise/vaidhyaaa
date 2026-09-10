# Testing Rules for Vaidya

## Non-negotiable rules

- No milestone is complete if `pnpm typecheck`, `pnpm lint`, `pnpm test`, or `pnpm build` fails.
- No production-like code should require real LLM, STT, TTS, WhatsApp, or telephony providers in local development.
- PostgreSQL is the source of truth. Redis/queue cannot be required for correctness in local common milestones.
- LLM/agent code must never write directly to DB.
- All write actions must go through validated domain services.
- No hard deletes for operational data in normal APIs.
- All clinic-owned queries must be scoped by `clinic_id`.
- Doctor role must only see or edit own doctor-linked data.
- Call Inbox is admin-only.

## Standard API error format

All API errors should follow one shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human readable error",
    "details": {},
    "request_id": "req_..."
  }
}
```

## Standard smoke check after any milestone

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm --filter api dev
pnpm --filter web dev
```

Then verify:

```text
[ ] API /health works
[ ] Web opens
[ ] DB migration works on a fresh DB
[ ] Seed data loads
[ ] /v1/me works for admin and doctor dev users
[ ] No real secrets committed
```
