# A02 Booking Capacity Engine - What to Test and How

## Goal
Verify booking state machine, appointment slot capacity model, slot_holds, concurrent holds, final confirmation, and pending/confirmed booking behavior.

## Happy path: new patient booking

Messages:

```text
Naalaikku evening appointment venum
Knee pain
6:30
Kumar
Seri
```

Expected:

```text
[ ] problem routes to correct clinic_service
[ ] correct doctor selected through doctor_services
[ ] available slots proposed
[ ] slot_hold created only after user chooses 6:30
[ ] appointment_request created after final confirmation
[ ] reason_for_visit stored as knee pain
[ ] default status = pending_confirmation
[ ] conversation ends cleanly
```

DB checks:

```sql
SELECT status, reason_for_visit, doctor_id, clinic_service_id, slot_id
FROM appointment_requests
WHERE source_session_id = '<SESSION_ID>';

SELECT status, hold_expires_at
FROM slot_holds
WHERE session_id = '<SESSION_ID>';
```

## Capacity > 1 test

Setup one slot with capacity_total=2.

Create two separate sessions and book same slot.

Expected:

```text
[ ] First patient can hold/book
[ ] Second patient can hold/book
[ ] Third patient gets SLOT_FULL / alternative slot response
```

## Concurrent hold test

Trigger two hold attempts for same capacity=1 slot at nearly same time.

Expected:

```text
[ ] Only one hold succeeds
[ ] Other hold fails with slot unavailable
[ ] No duplicate appointment_requests for same capacity unit
[ ] Postgres transaction uses SELECT FOR UPDATE or equivalent row lock
```

## Proposed slot becomes full before selection

Flow:

```text
Session A gets 6:30 proposed
Session B books 6:30
Session A says 6:30
```

Expected:

```text
[ ] Session A does not get stale booking
[ ] Vaidya says slot is now full and offers alternatives
```

## Hold expiry test

Set hold expiry short or manually expire:

```sql
UPDATE slot_holds SET hold_expires_at = NOW() - INTERVAL '1 minute' WHERE session_id = '<SESSION_ID>';
```

Then patient confirms.

Expected:

```text
[ ] Backend re-checks capacity
[ ] If available, creates new hold or creates appointment transactionally
[ ] If unavailable, asks for another slot
[ ] No appointment created from expired hold without re-check
```

## Cancel during booking

Messages:

```text
Naalaikku evening appointment venum
Knee pain
6:30
vendam
```

Expected:

```text
[ ] Active slot hold is released
[ ] No appointment_request created
[ ] current_flow returns to none/IDLE
```

## Returning patient booking

Use seeded patient with history.

Message:

```text
Knee pain follow-up appointment venum
```

Expected:

```text
[ ] Same previous doctor preferred only if patient identity clear
[ ] If same phone has multiple patients, asks which patient
[ ] If previous doctor inactive/no slots, offers service-mapped alternative
```

## Pass condition

A02 passes when bookings use the capacity model correctly, slot_holds protect user choices temporarily, expired holds are safe, and concurrency cannot double-book capacity.
