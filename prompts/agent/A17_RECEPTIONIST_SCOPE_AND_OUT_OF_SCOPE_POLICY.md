# A17 - Receptionist Scope and Out-of-Scope Policy

## Purpose

Make Vaidya handle out-of-scope questions safely, including when they occur inside booking/cancel/reschedule/handoff flows.

## Implement ConversationPolicyService

Policy outcomes:

- answer_and_resume
- refuse_and_resume
- fallback_staff_confirm_and_resume
- redirect_scope_and_resume
- end_flow
- switch_to_handoff
- emergency_override

## Rules

1. Fee/timing/location/availability during booking: answer from structured DB and resume booking.
2. Approved knowledge during booking: answer approved KB and resume booking.
3. No approved KB: say clinic staff will confirm; resume or offer callback depending context.
4. Random out-of-scope: politely redirect to clinic scope and resume previous prompt.
5. Medical advice: fixed refusal; resume or offer appointment.
6. Emergency: fixed 108 response, create emergency_incident, release active hold, do not continue booking.
7. Human request: start handoff, release active hold if needed.
8. Booking negative phrase: cancel booking and release hold.
9. Cancel-flow negative phrase: do not cancel appointment.

## Templates to add

- scope.out_of_scope_redirect
- scope.unsupported_service
- scope.staff_confirm_and_resume
- scope.staff_confirm_offer_callback
- scope.resume_booking_prompt
- safety.medical_advice_refusal_resume
- safety.emergency_active_flow
- handoff.started_from_active_flow

## Acceptance

- Out-of-scope does not break flow.
- Side questions resume flow.
- Emergency stops unsafe flow.
- Medical advice refused.
- Human handoff starts safely.
