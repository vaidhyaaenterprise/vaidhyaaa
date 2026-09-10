# C05 - Redis/BullMQ Background Job Foundation Tests

Purpose: verify queue/lock/scheduler interfaces and local/production implementations are ready.

## 1. Interface existence

Verify these interfaces/services exist:

```text
QueueService
LockService
SchedulerService
RateLimitService
JobRegistry
WorkerBootstrap
```

## 2. Local mode without Redis

Set:

```env
QUEUE_MODE=inline
REDIS_URL=
```

Run:

```bash
pnpm --filter api dev
pnpm --filter api test
```

Expected:

- API starts without Redis
- jobs can be enqueued in inline/no-op mode
- no Redis connection error
- session lock uses in-memory implementation

## 3. Redis mode

Start Redis locally:

```bash
docker run --name vaidya-redis -p 6379:6379 -d redis:7
```

Set:

```env
QUEUE_MODE=bullmq
REDIS_URL=redis://localhost:6379
```

Run API and worker if separate:

```bash
pnpm --filter api dev
pnpm --filter api worker:dev
```

Expected:

- API connects to Redis
- worker starts
- no duplicate worker registration error
- repeatable job registration is idempotent

## 4. Queue names

Verify these queue names are registered or planned:

```text
notifications
slot-holds
slot-generation
recording-cleanup
transcript-cleanup
knowledge-processing
embeddings
daily-reports
```

## 5. Job payload validation

Every queued job must validate payload using Zod/shared DTOs.

Bad payload should fail safely and not crash worker process.

## 6. Retry behavior

Test a fake provider failure for notification job.

Expected:

- job retries with backoff
- after max attempts, job moves to failed/dead-letter state or notification_events.status=failed
- no duplicate external send when retry succeeds after first failure

## 7. Distributed lock behavior

Test lock service:

- acquire lock once succeeds
- acquire same lock again before TTL fails or waits
- release lock succeeds
- expired lock can be acquired again

Do not use Redis as source of truth for appointment slot booking. Slot booking correctness must still rely on Postgres row locks.
