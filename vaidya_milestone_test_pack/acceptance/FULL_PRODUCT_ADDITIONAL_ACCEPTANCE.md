# Full Product Additional Acceptance Criteria

The product is not accepted as production-ready until these additional acceptance criteria pass.

## Schema and data

- all latest tables exist
- DB migrations run on fresh DB
- seed loads demo clinic
- clinic settings default agent off
- language and subscription seed exists
- no cross-clinic FK mismatch allowed

## Appointment engine

- capacity-window model implemented
- slot_holds implemented
- concurrent holds safe
- hold expiry safe
- cancel releases capacity
- 45-day generation implemented
- schedule/rule change conflicts safe
- no auto-cancel on holiday/timing changes

## Agent

- mock provider default
- Sarvam provider implemented behind env
- classifier/router return JSON only
- active state parsing avoids unnecessary LLM
- no LLM DB writes
- emergency/medical safety pass

## Application

- platform onboarding works
- clinic admin and doctor RBAC works
- appointments UI shows reason and history
- clinic setup supports booking rules
- subscription/language settings visible
- call inbox remains admin-only

## Jobs

- inline mode works without Redis
- BullMQ mode works with Redis
- notifications retry
- hold expiry job works
- slot generation job works
- cleanup jobs work

## Production safety

- standard error format used
- request_id logged
- audit logs written
- no hard delete in normal UI
- dev auth disabled in production
- real provider secrets not required in tests
