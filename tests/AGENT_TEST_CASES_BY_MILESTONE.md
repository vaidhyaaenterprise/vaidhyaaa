# Agent Test Cases by Milestone

## A00 Conversation Foundation
- Create conversation with seeded clinic.
- Send message with new idempotency key.
- Re-send same message and key: no duplicate.
- Send two messages concurrently to same session: order remains valid.
- GET conversation returns session and messages.

## A01 Classifier / Router / Safety
- `Chest pain irukku appointment venum` -> emergency.
- `Fever-ku enna tablet?` -> medical_advice_request.
- `Tooth extraction-ku fasting venuma?` -> ask_previsit_instruction.
- `Eye checkup venum` in clinic without eye service -> unsupported.
- `English please` changes language.

## A02 Booking Capacity
- `Naalaikku evening appointment venum` -> asks problem/doctor.
- `Knee pain` -> ortho service and Dr Kumar.
- `6:30` -> hold created.
- `Kumar` -> name stored.
- `Seri` -> appointment request created pending_confirmation.
- Two sessions choose same capacity-1 slot concurrently; one fails.
- Hold expired then confirmation attempts re-check.

## A03 Slot Generation
- Create booking rule and schedule; run job; slots appear.
- Rerun job; no duplicates.
- Add holiday; conflict check if appointment exists.
- Increase capacity; slots updated.
- Increase duration with existing appointment; change blocked.

## A04 Structured / Knowledge
- `Fees evlo?` -> ask doctor.
- `Dr Murugan` -> answer fee.
- `Dr Murugan follow-up fee evlo?` -> follow-up only.
- `Sunday open-a?` -> Sunday only.
- `Parking irukka?` -> approved knowledge.
- `Report ready-a?` if no approved answer -> staff confirm.

## A05 Cancel / Reschedule / Handoff
- Existing appointment cancel request -> appointment_action_request pending.
- Reschedule request -> appointment_action_request pending.
- Handoff -> callback_request.
- Emergency during handoff -> emergency_incident.

