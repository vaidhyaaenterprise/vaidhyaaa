# P02 Appointments UI - What to Test and How

## Goal
Verify all appointment sections, role visibility, manual booking, confirmation, quick edit thresholds, cancel/rebook, visited reason, and patient history display.

## Sections

```text
[ ] Pending confirmation
[ ] Confirmed
[ ] Visited
[ ] Reschedule / cancel action requests
```

## Admin view

```text
[ ] Admin sees all clinic appointments
[ ] Pending confirmation shows only pending_confirmation
[ ] Confirmed shows confirmed appointments
[ ] Visited shows visited appointments
[ ] Reschedule/cancel shows appointment_action_requests
```

## Doctor view

```text
[ ] Doctor sees only own appointments
[ ] Doctor can confirm only own pending appointments
[ ] Doctor can mark own appointment visited if enabled
[ ] Doctor cannot see other doctors' appointments
[ ] Doctor cannot see admin-only reschedule/cancel queue unless allowed later
```

## Appointment card fields

Every card/row must show:

```text
[ ] patient_name
[ ] patient_phone
[ ] doctor
[ ] service
[ ] appointment date/time
[ ] reason_for_visit/problem
[ ] new/follow-up badge
[ ] routing_source
[ ] status
[ ] patient history indicator if exists
```

## Confirm appointment

```text
[ ] Admin confirm changes status to confirmed
[ ] Doctor confirm works only for own appointment
[ ] Patient WhatsApp/SMS notification event created only after confirmation
[ ] Pending appointment does not send patient confirmation
```

## Manual booking

```text
[ ] Admin can create manual appointment
[ ] Admin can override outside clinic hours with override_reason
[ ] Doctor can create only own-slot appointment
[ ] Doctor cannot override outside hours in v1
[ ] No double booking allowed
[ ] Patient history is shown during manual booking if phone/name matches
```

## Quick edit and cancel/rebook

Settings:

```text
manual_edit_cutoff_before_start_minutes = 60
manual_edit_max_shift_minutes = 60
```

Expected:

```text
[ ] Quick edit within shift threshold allowed if capacity exists
[ ] Quick edit within cutoff before start is blocked
[ ] Shift greater than threshold triggers cancel/rebook/formal reschedule flow
[ ] Admin override outside-hours requires reason
[ ] Doctor cannot move appointment to another doctor
[ ] Cancel/rebook links old and new appointments if implemented
```

## Mark visited

```text
[ ] Visit reason is required
[ ] patient_visits row created
[ ] appointment status becomes visited
[ ] visited/cancelled appointment cannot be edited as normal
```

## Pass condition

P02 passes when appointment operations are safe, role-aware, history-aware, and aligned with capacity/threshold rules.
