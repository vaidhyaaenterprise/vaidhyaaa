# A03 Expanded - Slot Generation, Slot Holds, Capacity, and Jobs

## Purpose

Implement the full appointment slot capacity engine and the background jobs that keep slots usable.

If an earlier A03 exists, use this prompt to replace or extend it.

## Final slot model

- appointment_slots = doctor-service time window + capacity.
- slot_holds = temporary reservation while patient confirms.
- appointment_requests = actual patient appointment/request.

Proposed slots are snapshots, not guarantees. Holds are created only after the patient chooses one slot.

## Required services

- SlotService
- SlotHoldService
- SlotGenerationService
- SlotRuleChangeImpactService
- SlotHoldExpiryJob
- SlotGenerationJob

## Slot availability formula

```
active_appointments = appointment_requests where status in pending_confirmation, confirmed
active_holds = slot_holds where status=active and hold_expires_at > now
available_count = appointment_slots.capacity_total - active_appointments - active_holds
```

Only slots with `available_count > 0` are proposed or held.

## Hold transaction

Implement `holdSlot(input)` with Postgres transaction:

1. BEGIN.
2. SELECT appointment_slots row FOR UPDATE by slot_id and clinic_id.
3. Verify status=open.
4. Count active appointments.
5. Count active non-expired holds.
6. If occupied_count >= capacity_total, rollback and return SLOT_FULL.
7. Insert slot_holds status=active, expires now + default 5 minutes.
8. COMMIT.

Do not use Redis for booking correctness.

## Confirm after expired hold

If user confirms after hold expiry:

- re-check capacity inside transaction.
- if capacity still exists, create fresh hold or create appointment transactionally.
- if full, ask patient to choose another slot.

## SlotHoldExpiryJob

Runs every 1 minute.

Logic:

- active holds with hold_expires_at < now -> expired
- active holds for completed/abandoned/expired sessions -> released

Must be idempotent.

## SlotGenerationJob

Runs daily at 1:00 AM clinic timezone.

For each active clinic and active doctor-service mapping:

- load doctor_service_booking_rule
- load doctor schedule
- load clinic hours
- load clinic holidays
- load doctor blocked slots
- generate missing slots for today through today + booking_horizon_days default 45
- skip holidays and blocked periods
- insert only missing slots
- save generated_from_rule_id, generation_batch_id, config_version

## Config change regeneration

Triggered by:

- doctor schedule change
- clinic hour change
- holiday change
- doctor blocked slot change
- booking rule change
- doctor_service activation/deactivation
- clinic_service activation/deactivation
- doctor activation/deactivation

Process:

1. Preview affected future slots.
2. Check active appointments and active holds.
3. If no conflicts, regenerate safe future open slots.
4. If conflicts exist, block change and return conflict list.
5. Never auto-cancel appointments.

## Capacity changes

Capacity increase:

- safe; update future open slots.

Capacity decrease no conflict:

- update future open slots if occupancy <= new capacity.

Capacity decrease conflict:

- block and return affected appointments.

## Duration changes

Duration increase/decrease with no conflicts:

- mark affected old future open slots as superseded.
- generate new slots with new duration.

Duration change with conflicts:

- block and return conflict list.

## Tests

1. Slot generation creates 45-day future slots for active doctor-service mapping.
2. Slot generation skips clinic holiday.
3. Slot generation skips doctor blocked slots.
4. Slot generation inserts only missing slots; repeated job does not duplicate.
5. Slot proposal returns only slots with capacity available.
6. Holding slot creates slot_holds active row.
7. Two concurrent hold attempts on capacity=1 allow only one.
8. Capacity=3 allows three concurrent holds/bookings but rejects fourth.
9. Expired hold no longer consumes capacity.
10. SlotHoldExpiryJob marks expired holds.
11. Confirm after expired hold rechecks capacity.
12. Cancelled appointment releases capacity.
13. Capacity increase updates future open slots.
14. Capacity decrease with no conflict succeeds.
15. Capacity decrease with conflict blocks change.
16. Duration increase with no conflict supersedes old slots and generates new slots.
17. Duration change with conflict blocks change.
18. No auto-cancel occurs on schedule/rule changes.

## Acceptance criteria

- Capacity engine is transaction-safe.
- No double booking under concurrency tests.
- Jobs work in inline queue mode and BullMQ mode.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.
