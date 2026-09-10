# A11 Tests - Global NLU Classifier Hardening

1. `Naalaikku evening appointment venum` -> book_appointment.
2. `Doctor-a paakanum` -> book_appointment.
3. `Token venum` -> book_appointment.
4. `Fever-ku enna tablet?` -> medical_advice_request.
5. `Chest pain irukku appointment venum` -> emergency.
6. `MRI scan fee evlo?` -> ask_fee with procedure/test topic.
7. `Sunday open-a?` -> ask_timing.
8. `Dr Priya inniku irukkangala?` -> ask_doctor_availability.
9. `Scan-ku sapdalaama?` -> ask_previsit_instruction.
10. `Receptionist kitta pesanum` -> ask_human_agent.
11. `English please` -> language_switch.
12. `Cricket score enna?` -> out_of_scope.
13. Low-confidence -> safe unknown.clarify.
14. Real provider not required for CI.
