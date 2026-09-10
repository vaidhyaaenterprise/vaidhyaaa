# Golden Edge Cases for Vaidya

Use these for final milestone QA and before demo/pilot.

## Booking

```text
[ ] Compound message: "Naalaikku evening knee pain-ku appointment venum. En peyar Kumar."
[ ] Returning patient same problem routes/prefer previous doctor only when identity clear
[ ] Same phone multiple patients asks which patient
[ ] Unsupported service does not book wrong doctor
[ ] Patient asks fee during booking; answer and resume booking
[ ] Patient says vendam during booking; release hold and stop
```

## Capacity and concurrency

```text
[ ] Capacity 1: two concurrent users choose same slot; only one succeeds
[ ] Capacity 2: two users succeed; third fails
[ ] Proposed slot becomes full before choose; offer alternatives
[ ] Expired hold does not consume capacity
[ ] Confirm after expired hold re-checks capacity
[ ] Cancelled appointment releases capacity
```

## Schedule/rule changes

```text
[ ] Capacity increase no conflict works
[ ] Capacity decrease no conflict works
[ ] Capacity decrease with conflict is blocked
[ ] Duration increase no conflict supersedes old slots and creates new slots
[ ] Duration increase with conflict is blocked
[ ] Holiday change with future appointments is blocked/show conflicts; no auto-cancel
```

## Knowledge and structured info

```text
[ ] Fee/timing/location use structured DB
[ ] KB never overrides structured fee/timing
[ ] Approved KB answer works
[ ] Pending KB answer not used
[ ] Other clinic KB answer not used
[ ] Unknown KB -> clinic staff will confirm
```

## Safety

```text
[ ] Emergency overrides active booking/reschedule/handoff
[ ] Medical advice never answered from KB
[ ] Dosage/treatment request refused
```

## RBAC

```text
[ ] Doctor cannot see call inbox
[ ] Doctor cannot manage other doctor appointments
[ ] Doctor cannot toggle agent
[ ] Inactive clinic user blocked
```

## Notifications

```text
[ ] Pending confirmation does not notify patient as confirmed
[ ] Confirmed appointment creates patient notification
[ ] Emergency creates clinic alert
[ ] Callback creates staff alert
```
