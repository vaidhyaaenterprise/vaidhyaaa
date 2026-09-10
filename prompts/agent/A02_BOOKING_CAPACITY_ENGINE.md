# Agent Milestone A02 - Booking Flow and Appointment Capacity Engine

## Goal
Implement the production-safe booking state machine using `appointment_slots`, `slot_holds`, and `appointment_requests`.

## Non-negotiable slot model
- `appointment_slots` = doctor-service time window with capacity.
- `slot_holds` = temporary reservation after patient chooses a specific slot.
- `appointment_requests` = actual patient appointment/request.
- Proposed slots are snapshots, not guarantees.
- Hold is created only after patient selects one slot.

## Required components
- BookingMachine
- SlotService.findAvailableSlots
- SlotService.tryHoldSlot
- SlotService.releaseHold
- SlotService.expireOldHolds
- AppointmentService.createFromConfirmedHold
- PatientVisitService.findReturningPatientMatch
- ActionValidator.validateCreateAppointment

## Booking states
```text
BOOKING_STARTED
ASK_PROBLEM_OR_DOCTOR
EXTRACT_BOOKING_DETAILS
CHECK_RETURNING_PATIENT_HISTORY
ROUTE_SERVICE
SELECT_DOCTOR
ASK_DATE
ASK_TIME
CHECK_SLOTS
PROPOSE_SLOTS
HOLD_SLOT
ASK_PATIENT_NAME
ASK_PHONE_IF_NEEDED
CONFIRM_DETAILS
CREATE_APPOINTMENT_REQUEST
DONE
```

## Booking behavior
1. Greeting asks problem first.
2. Extract all fields from compound messages.
3. If same phone has multiple patients and name unknown, ask who appointment is for.
4. Same-problem follow-up prefers previous doctor only if doctor active and still handles service.
5. New/different problem uses service router.
6. Unsupported service never books wrong doctor.
7. Ask only missing fields.
8. Propose slots with `available_count > 0`.
9. When patient chooses slot, create slot_hold using DB transaction and `SELECT FOR UPDATE` on appointment_slots.
10. Ask final confirmation.
11. If confirmed before hold expiry, create appointment request.
12. If hold expired, re-check capacity.
13. If booking_mode=pending_confirmation, create status pending_confirmation.
14. If booking_mode=auto_confirm and plan/settings allow, create status confirmed and notification event.
15. Release hold if user says vendam/no/cancel during booking.

## Availability formula
```text
available_count = capacity_total - active_appointments - active_holds
```
Active appointments: `pending_confirmation`, `confirmed`.
Active holds: `slot_holds.status=active AND hold_expires_at > now()`.

## Concurrent hold transaction
Use one transaction:
1. Lock `appointment_slots` row with `FOR UPDATE`.
2. Count active appointments.
3. Count active non-expired holds.
4. If occupied < capacity_total, insert hold.
5. Else rollback and return SLOT_FULL.

## Tests
1. Booking happy path: problem -> service -> doctor -> slots -> hold -> name -> confirmation -> appointment request.
2. Compound first message extracts problem/date/time/name.
3. Doctor-name booking skips service routing.
4. Returning patient same problem prefers previous doctor.
5. Same phone multiple patients asks patient identity.
6. Previous doctor inactive falls back to service doctor or asks clarification.
7. Unsupported service returns no appointment.
8. Slot proposal does not create holds.
9. Selecting slot creates one active hold.
10. Hold expires after time and no longer consumes capacity.
11. Confirm after expired hold re-checks capacity.
12. Two users choose same capacity-1 slot concurrently: only one hold succeeds.
13. Capacity-3 slot allows exactly three concurrent active holds/appointments, fourth fails.
14. Patient says vendam after hold: hold released, no appointment created.
15. Pending confirmation does not send patient confirmation notification.
16. Auto-confirm sends notification event only if setting and plan allow.
17. `reason_for_visit` is always stored.
18. Appointment card/history fields are populated.

## Acceptance criteria
- No double booking possible.
- Booking flow works without real LLM.
- All writes go through ActionValidator and transactions.
