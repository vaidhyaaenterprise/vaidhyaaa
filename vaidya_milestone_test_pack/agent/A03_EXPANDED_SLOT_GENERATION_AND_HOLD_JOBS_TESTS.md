# A03 Expanded - Slot Generation and Hold Jobs Tests

Purpose: verify 45-day slot generation, capacity model, slot holds, expiry, and schedule/rule change handling.

## 1. Daily 45-day generation

Given:

- active clinic
- active doctor
- active clinic service
- active doctor_service mapping
- doctor_service_booking_rule with booking_horizon_days=45
- doctor schedule Monday-Saturday 18:00-21:00

Run:

```bash
pnpm --filter api jobs:run slot-generation
```

Expected:

- slots generated from today through today + 45 days
- no slots on holidays
- no slots outside doctor schedule
- slots have capacity_total from booking rule
- slots store generated_from_rule_id, generation_batch_id, config_version
- running job twice does not duplicate slots

## 2. Capacity per slot

Rule:

```text
slot_duration_minutes=30
capacity_per_slot=3
```

Expected slot:

```text
18:00-18:30 capacity_total=3
```

Do not create 3 duplicate slot rows for the same time unless explicitly using seat-row model. Final design uses capacity window model.

## 3. Hold creation

Given slot capacity_total=2 and available_count=2.

When patient chooses slot:

Expected:

- slot_holds row created
- status=active
- hold_expires_at approximately now + 5 minutes
- appointment_request not created yet

## 4. Concurrent hold prevention

Given slot capacity_total=1.

Simulate two parallel hold attempts.

Expected:

- exactly one succeeds
- one fails with SLOT_FULL or SLOT_NOT_AVAILABLE
- only one active slot_hold exists
- no double booking

Use real DB transaction and SELECT FOR UPDATE.

## 5. Capacity > 1 concurrent holds

Given slot capacity_total=3.

Run 4 concurrent hold attempts.

Expected:

- 3 succeed
- 1 fails
- active hold count = 3

## 6. Expired hold ignored by availability

Create active hold with hold_expires_at in the past.

Expected:

- availability query ignores it
- available_count includes that capacity again

## 7. SlotHoldExpiryJob

Run:

```bash
pnpm --filter api jobs:run slot-hold-expiry
```

Expected:

- active expired holds become expired
- active non-expired holds remain active
- converted/released holds unchanged
- job is idempotent

## 8. Confirm after hold expiry

Create hold, expire it, then send patient confirmation.

Case A: capacity still available.

Expected:

- backend re-checks capacity
- appointment can be created transactionally

Case B: capacity now full.

Expected:

- appointment not created
- bot asks for another slot

## 9. Cancel releases capacity

Create confirmed appointment against slot capacity=1.

Cancel appointment by admin action.

Expected:

- appointment status=cancelled
- slot available_count becomes 1
- no stale hold remains

## 10. Capacity increase

Change booking rule capacity 2 -> 3.

Expected:

- future open slots capacity_total updated to 3
- occupied slots not harmed
- no conflict returned

## 11. Capacity decrease without conflict

Change capacity 3 -> 2 where occupancy <= 2.

Expected:

- future open slots update to capacity_total=2
- no rows deleted
- no conflict

## 12. Capacity decrease with conflict

Change capacity 3 -> 1 where occupancy=2.

Expected:

- change blocked
- conflict list returned
- no auto-cancel
- old rule/slots remain unchanged

## 13. Slot duration increase without conflict

Change duration 15 -> 30 with no future holds/appointments.

Expected:

- old future open slots marked superseded
- new 30-minute slots generated
- no hard delete

## 14. Slot duration increase with conflict

Change duration 15 -> 30 where a future pending/confirmed appointment exists in affected period.

Expected:

- change blocked
- conflict list returned
- no slots superseded
- no appointments cancelled

## 15. Doctor/service inactive behavior

If doctor_service mapping is disabled:

Expected:

- no new slots generated
- existing future open slots marked superseded or blocked according to contract
- existing appointments returned as conflicts if impacted
