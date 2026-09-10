# A12 Tests - Active-State LLM Interpreter Enhancement

1. booking/ASK_DATE + `nalaki` -> date_answer or safe clarification; no flow reset.
2. booking/ASK_DATE + `this saturday` -> date_answer if referenceDate permits.
3. booking/ASK_TIME + `after 6` -> time_answer exact/preference.
4. booking/ASK_TIME + `6 arai` -> exactTime=18:30 when evening context exists or clarification if ambiguous.
5. booking/PROPOSE_SLOTS + `first one` -> selectedSlotId from offeredSlots.
6. booking/PROPOSE_SLOTS + `later slot` -> selects later offered slot or clarifies.
7. booking/PROPOSE_SLOTS + unavailable time -> does not invent slot ID.
8. booking/ASK_PATIENT_NAME + `Naan Ravi` -> patientName=Ravi.
9. booking/ASK_PATIENT_NAME + `vendam` -> flow_cancel.
10. booking/CONFIRM_DETAILS + `book pannunga` -> yes_confirmation.
11. cancel/CONFIRM_CANCEL_REQUEST + `sari cancel pannunga` -> yes_confirmation for cancel flow.
12. cancel/CONFIRM_CANCEL_REQUEST + `vendam` -> no_rejection.
13. reschedule/ASK_NEW_DATE + `next friday` -> date_answer.
14. handoff/ASK_REASON + `report pathi pesanum` -> handoff_reason.
15. booking/ASK_DATE + `Dr Priya fees evlo?` -> side_question and booking state preserved.
16. Emergency text during active flow bypasses interpreter.
17. Medical advice text during active flow bypasses interpreter.
