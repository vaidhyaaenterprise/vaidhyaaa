# Vaidya Master Test Matrix

Use this as the QA checklist across all milestones.

## Common foundation
- Health endpoint returns OK.
- Env validation fails if DATABASE_URL missing.
- Standard API error shape is returned.
- Request ID exists on all API responses.
- DB migration and seed run cleanly.
- Dev auth works only outside production.
- RBAC blocks cross-clinic access.

## Agent and conversation
- Create session with valid clinic.
- Reject session creation for invalid clinic.
- Message idempotency prevents duplicate patient/assistant rows.
- Language switch works.
- DEBUG_API controls debug output.
- Emergency overrides all flows.
- Medical advice request is refused.
- Unknown falls back safely.

## Booking
- New patient booking by problem routes to correct service and doctor.
- Doctor-name booking skips service routing.
- Returning same-problem patient prefers previous doctor if valid.
- Same phone multiple patients asks identity.
- Previous doctor inactive or unavailable falls back safely.
- Unsupported service does not book wrong doctor.
- Compound message extracts date/time/name/problem.
- Side-question during booking is answered and booking resumes.
- Vendam/no cancels active booking and releases hold.
- Appointment request stores reason_for_visit.

## Slot capacity and concurrency
- Proposed slots do not create holds.
- Chosen slot creates active hold.
- Hold expires and stops consuming capacity.
- Confirm after expired hold re-checks capacity.
- Capacity-1 slot with two concurrent selections allows only one.
- Capacity-3 slot allows three holds/bookings, fourth fails.
- Cancelled appointment releases capacity.
- Superseded slots are not proposed.

## Slot generation
- Daily job creates missing slots for next 45 days.
- Job is idempotent.
- Holidays and blocked slots are respected.
- Inactive doctor/service/mapping generate no slots.
- Capacity increase updates future open slots.
- Capacity decrease with conflict blocks change.
- Slot duration change with conflict blocks change.
- No schedule/holiday change auto-cancels appointments.

## Structured info and knowledge
- Doctor-specific consultation fee works.
- Fee clarification works.
- Follow-up fee returns only follow-up fee.
- MRI/unknown procedure fee returns staff confirmation.
- Sunday open question returns Sunday only.
- Today doctor availability returns today only.
- Location comes from structured clinic table.
- Approved knowledge answer works.
- Pending/disabled knowledge is not used.
- Another clinic's knowledge is not used.

## Cancel/reschedule/handoff
- Patient cancel creates appointment_action_request by default.
- Cancel no appointment found falls back safely.
- Cancel multiple appointments asks which.
- Patient reschedule creates appointment_action_request by default.
- Reschedule no appointment found falls back safely.
- Handoff collects reason/name/phone and creates callback_request.
- Handoff can be cancelled before completion.
- Idempotency prevents duplicate action requests/callbacks.

## Application / RBAC
- Admin sees all five tabs.
- Doctor hides Call inbox and Knowledge base.
- Doctor sees only own appointments.
- Doctor can confirm own pending appointment.
- Doctor cannot confirm another doctor appointment.
- Admin can create manual appointment outside hours with override reason.
- Doctor cannot override outside hours.
- Mark visited requires visit reason.
- Clinic setup conflict list is displayed.

## Notifications
- Patient confirmation sent only after status confirmed.
- No patient notification for pending confirmation.
- Staff pending appointment notification is controlled by setting.
- Emergency alert notification is queued.
- Callback notification is queued.
- Notification retry and failure status work.

## Retention
- Recording signed URL available only within 10 days.
- Transcript available only within 30 days.
- Cleanup jobs are idempotent.
- Recording/transcript access is audited.

