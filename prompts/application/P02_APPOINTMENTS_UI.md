# Application Milestone P02 - Appointments UI

## Goal
Build the operational appointment dashboard.

## Sections
1. Pending confirmation
2. Confirmed
3. Visited
4. Reschedule / cancel action requests

## Appointment card/table must show
- patient name
- patient phone
- doctor
- service
- date/time
- reason_for_visit / problem
- new/follow-up badge
- routing source
- patient history indicator
- status
- source: agent/manual/admin

## Actions
Admin:
- confirm pending
- edit time quick edit
- cancel
- manual appointment
- mark visited
- view patient history
- approve/reject cancel/reschedule action request

Doctor:
- view own appointments only
- confirm own pending appointments
- mark own patient visited
- quick edit own appointments only if allowed and within rules

## Manual appointment rules
- Admin can override outside clinic hours with `override_reason`.
- Doctor can create own-slot manual appointments only.
- No one can override double booking.
- reason_for_visit is mandatory.

## Quick edit rules
- `manual_edit_cutoff_before_start_minutes` blocks edits too close to start.
- `manual_edit_max_shift_minutes` blocks more-than-threshold quick edit.
- More than threshold uses cancel/rebook/formal reschedule.

## Mark visited
Must require visit reason. Creates patient_visits row.

## Tests
1. Pending confirmation list loads.
2. Doctor sees only own appointments.
3. Doctor can confirm own appointment.
4. Doctor cannot confirm another doctor appointment.
5. Patient history appears when patient has previous visits.
6. Manual admin appointment requires reason_for_visit.
7. Admin outside-hours override requires override_reason.
8. Doctor outside-hours override blocked.
9. Quick edit within threshold succeeds if capacity available.
10. Quick edit inside cutoff blocked.
11. More than 1-hour edit routes to cancel/rebook flow.
12. Confirmed appointment sends patient notification event.
13. Pending confirmation does not send patient notification.
14. Mark visited requires reason and creates patient_visits.
15. Cancel/reschedule action request appears in Reschedule / cancel section.

## Acceptance criteria
- Appointment operations are role-safe and reflect backend statuses.
