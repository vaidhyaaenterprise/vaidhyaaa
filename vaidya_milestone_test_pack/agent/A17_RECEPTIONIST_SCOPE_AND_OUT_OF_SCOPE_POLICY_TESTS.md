# A17 Tests - Receptionist Scope and Out-of-Scope Policy

1. booking/ASK_DATE + `Dr Priya fees evlo?` -> fee answer + ask date again.
2. booking/ASK_TIME + `Parking irukka?` -> KB answer/no-answer + ask time again.
3. booking/PROPOSE_SLOTS + `Weather eppadi?` -> scope redirect + repeat slots.
4. booking/ASK_PATIENT_NAME + `Fever-ku enna tablet?` -> medical advice refusal + ask name again.
5. booking/PROPOSE_SLOTS + `Chest pain` -> emergency response + incident + hold released.
6. booking with hold + `Receptionist kitta pesanum` -> handoff starts + hold released.
7. booking/CONFIRM_DETAILS + `vendam` -> booking cancelled.
8. cancel/CONFIRM_CANCEL_REQUEST + `vendam` -> do not cancel appointment.
9. reschedule/PROPOSE_NEW_SLOTS + `clinic timing enna?` -> timing answer + resume slot selection.
10. standalone `Cricket score enna?` -> scope redirect, no DB write.
11. unsupported `Eye checkup venum` -> unsupported service, no wrong booking.
12. no hallucination when no KB/fee exists.
