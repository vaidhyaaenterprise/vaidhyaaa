# Agent and Application Integration Tests

## 1. Pending appointment appears in UI

Agent creates appointment_request with status=pending_confirmation.

Expected in Appointments UI:

- appears in Pending confirmation section
- shows patient name/phone
- shows doctor
- shows service
- shows reason_for_visit
- shows requested slot
- shows routing source
- confirm/cancel/edit actions visible to admin

## 2. Doctor sees own pending appointment

Login as doctor linked to appointment.doctor_id.

Expected:

- sees own pending appointment if allowed
- can confirm own appointment
- cannot see other doctor's pending appointment

## 3. Staff action request appears

Patient requests cancel/reschedule by call.

Expected:

- appointment_action_request created
- appears in Appointments -> Reschedule / cancel section
- link to call inbox appears for admin
- doctor does not see call inbox

## 4. Knowledge gap appears if configured

Patient asks unknown FAQ.

Expected:

- bot says clinic staff will confirm
- optional knowledge gap event created
- admin can later add/approve answer in Knowledge Base

## 5. Emergency appears in Home/Call Inbox

Emergency call handled.

Expected:

- emergency_incident created
- emergency alert notification event created
- Home shows urgent item
- Call inbox shows emergency outcome when voice/call records exist

## 6. Patient history visible during booking confirmation

Existing patient books same/different problem.

Expected admin appointment details include:

- previous visits
- previous doctor
- previous service
- previous reason
- follow-up validity
