# C05 - Redis, BullMQ, and Background Job Foundation

## Purpose

Add production-ready background job infrastructure with local fallback. This milestone does not implement all business jobs fully; it creates the queue foundation that later milestones use.

## Required architecture

Create interfaces:

- QueueService
- SchedulerService
- LockService
- RateLimitService

Provide implementations:

- InlineQueueService for local/dev without Redis
- InMemoryLockService for local/dev
- BullMQQueueService for Redis production mode
- RedisLockService for Redis production mode

## Environment

Add or verify env vars:

```env
QUEUE_MODE=inline # inline | bullmq
REDIS_URL=
JOB_WORKER_ENABLED=false
```

Local development should work without Redis.

Production mode should require Redis when `QUEUE_MODE=bullmq`.

## Queue names

Create queue names/constants:

- notifications
- slot-holds
- slot-generation
- recordings-cleanup
- transcripts-cleanup
- knowledge-processing
- embeddings
- daily-reports

## Job types to define now

Define types/interfaces, not full business logic yet:

- SEND_NOTIFICATION
- EXPIRE_SLOT_HOLDS
- GENERATE_SLOTS
- CLEANUP_EXPIRED_RECORDINGS
- CLEANUP_EXPIRED_TRANSCRIPTS
- PARSE_KNOWLEDGE_DOCX
- GENERATE_KNOWLEDGE_EMBEDDING
- GENERATE_DAILY_CLINIC_REPORT

## Job worker app

Add a worker entrypoint if repo structure supports it:

- `apps/api/src/worker.ts` or `apps/worker`

It should start only when explicitly run:

```bash
pnpm --filter api worker:dev
```

Do not start workers automatically in API dev unless intended.

## Queue behavior

- Jobs must have unique job ids where deduplication matters.
- Retries must use exponential backoff.
- Failed jobs should be logged.
- Add request_id/correlation_id when available.
- Job payloads must contain clinic_id if clinic-scoped.

## LockService

Implement per-session lock interface:

```ts
withLock(key, ttlMs, fn)
```

Use cases:

- conversation session message processing
- optional job deduplication
- provider rate limiting later

Do not use Redis lock for slot booking correctness. Slot booking correctness must use PostgreSQL transaction and row lock.

## Health endpoint

Add `/health` details or `/health/infra` with:

- database ok
- queue mode
- redis connected if bullmq mode
- worker enabled flag

## Tests

1. Inline queue executes job handler in local mode.
2. In-memory lock serializes two calls with same key.
3. QueueService can enqueue notification job payload.
4. BullMQ mode fails fast if REDIS_URL missing.
5. API can start with QUEUE_MODE=inline and no Redis.
6. Worker can start in inline mode without Redis.
7. No job requires real WhatsApp/SMS/STT/TTS providers yet.

## Acceptance criteria

- API local dev works without Redis.
- Queue interfaces are available to domain services.
- BullMQ implementation exists but is env-gated.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.
