# Agent Milestone A05 - Cancel, Reschedule, Handoff, Emergency Completion

## Goal
Implement multi-step cancel, reschedule, and handoff flows with production-safe patient action request behavior.

## Important decision
Patient cancel/reschedule by call creates `appointment_action_request` by default. Admin performs final cancel/reschedule from Appointments -> Reschedule / cancel.

## Cancel flow
States:
```text
CANCEL_STARTED
FIND_EXISTING_APPOINTMENT
SELECT_APPOINTMENT_IF_MULTIPLE
CONFIRM_CANCEL_REQUEST
CREATE_CANCEL_ACTION_REQUEST
DONE
```

Behavior:
- Find upcoming pending/confirmed appointments by clinic + phone.
- If multiple, ask which.
- Ask patient confirmation.
- If confirmed, create appointment_action_request type=cancel status=pending.
- Notify admin, link to call inbox.
- Do not directly cancel appointment unless clinic setting explicitly allows patient auto-cancel.

## Reschedule flow
States:
```text
RESCHEDULE_STARTED
FIND_EXISTING_APPOINTMENT
SELECT_APPOINTMENT_IF_MULTIPLE
ASK_NEW_DATE
ASK_NEW_TIME
CHECK_NEW_SLOTS
PROPOSE_NEW_SLOTS
HOLD_NEW_SLOT
CONFIRM_RESCHEDULE_REQUEST
CREATE_RESCHEDULE_ACTION_REQUEST
DONE
```

Behavior:
- Keep same doctor/service by default.
- Hold requested new slot temporarily if selected.
- Create appointment_action_request type=reschedule status=pending.
- Admin approves final reschedule.
- If patient says no/vendam, release new hold.

## Handoff flow
States:
```text
HANDOFF_STARTED
ASK_REASON_OPTIONAL
ASK_NAME_IF_NEEDED
ASK_PHONE_IF_NEEDED
CREATE_CALLBACK_REQUEST
DONE
```

Behavior:
- Collect reason, name if missing, phone if missing.
- Create callback_request only after needed info.
- Patient can cancel with vendam/no before completion.

## Emergency behavior
- Emergency overrides all flows.
- Fixed 108 response.
- Create emergency_incident.
- Create high-priority notification_event for clinic.

## Tests
1. Cancel request creates appointment_action_request, not direct cancellation.
2. Cancel no appointment found offers callback/staff confirmation.
3. Cancel multiple appointments asks which.
4. Cancel vendam creates no action request.
5. Reschedule creates pending action request and holds requested new slot.
6. Reschedule vendam releases new hold.
7. Admin approval of action request changes appointment in AppointmentService later.
8. Handoff creates callback_request after reason/name/phone.
9. Handoff vendam creates no callback_request.
10. Emergency during cancel/reschedule/handoff overrides and creates emergency_incident.
11. Medical advice during any flow refuses advice and does not create appointment/callback.
12. Idempotency prevents duplicate action requests.

## Acceptance criteria
- Patient-originated cancel/reschedule is safe and admin-controlled.
- Emergency and medical-advice guardrails work in every active flow.
