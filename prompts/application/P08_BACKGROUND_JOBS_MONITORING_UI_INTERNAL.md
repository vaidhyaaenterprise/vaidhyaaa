# P08 - Internal Background Jobs and Notification Monitoring UI

## Purpose

Create platform/internal UI to inspect notification events and background job health. This is not a doctor-facing or clinic admin primary screen.

## Screens

### 1. Notification events

Path:

```text
/internal/platform/notifications
```

Columns:

- created_at
- clinic
- event_type
- channel
- recipient
- status
- attempts
- last_error
- provider_message_id

Filters:

- status
- event_type
- clinic
- date range

Actions:

- retry failed
- cancel pending
- view payload

### 2. Job health

Path:

```text
/internal/platform/jobs
```

Cards:

- queue mode
- Redis connected yes/no
- pending jobs
- failed jobs
- last slot generation run
- last hold expiry run
- last recording cleanup run
- last transcript cleanup run

### 3. Job run history optional

If backend stores job_run_logs, show:

- job name
- started_at
- finished_at
- status
- processed count
- error

## Tests

1. platform_admin can view notification events.
2. clinic_admin cannot view platform job UI.
3. failed notification can be retried.
4. pending notification can be cancelled.
5. job health displays inline mode without Redis.
6. job health displays Redis status when BullMQ enabled.
7. payload viewer masks sensitive data where required.

## Acceptance criteria

- Internal support can inspect notifications/jobs.
- No patient-facing UI exposes provider internals.
- No direct DB access from frontend.
