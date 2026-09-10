# A05C Tests - Active-State Variation Interpreter and Language Packs

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter api test -- active-state
```

## Fast-path language pack tests

1. booking/ASK_DATE + `inniku` -> date_answer, date=today.
2. booking/ASK_DATE + `inaiku` -> date_answer, date=today.
3. booking/ASK_DATE + `iniku` -> date_answer, date=today.
4. booking/ASK_DATE + `naalaikku` -> date_answer, date=tomorrow.
5. booking/ASK_DATE + `nalaki` -> either date_answer through LLM or unknown if mock cannot parse; must not reset flow.
6. booking/ASK_TIME + `morning` -> time_answer, timePreference=morning.
7. booking/ASK_TIME + `maalai` -> time_answer, timePreference=evening.
8. booking/ASK_TIME + `6:30` -> time_answer, exactTime=18:30 when context implies evening or exact time resolves safely.
9. booking/CONFIRM_DETAILS + `seri` -> yes_confirmation.
10. booking/CONFIRM_DETAILS + `sari` -> yes_confirmation.
11. booking/CONFIRM_DETAILS + `ok` -> yes_confirmation.

## Context-sensitive negative tests

12. booking/CONFIRM_DETAILS + `vendam` -> flow_cancel; no appointment created.
13. booking/ASK_PATIENT_NAME + `venam` -> flow_cancel; not patientName.
14. booking/PROPOSE_SLOTS + `later` -> flow_cancel or no_rejection based product policy; active hold released.
15. cancel/CONFIRM_CANCEL_REQUEST + `vendam` -> no_rejection; appointment not cancelled.
16. reschedule/CONFIRM_RESCHEDULE_REQUEST + `venda` -> no_rejection; new hold released; old appointment unchanged.
17. handoff/ASK_REASON + `no` -> flow_cancel; no callback_request.

## Slot-selection tests

18. booking/PROPOSE_SLOTS with offered slots 6:30/7:15 + `first one` -> selectedSlotId of 6:30.
19. booking/PROPOSE_SLOTS + `second one` -> selectedSlotId of 7:15.
20. booking/PROPOSE_SLOTS + `earlier slot` -> selected earliest offered slot.
21. booking/PROPOSE_SLOTS + `8:00` when not offered -> needsClarification; do not invent slot ID.

## LLM provider behavior tests

22. With mock provider, no Sarvam key required.
23. With ACTIVE_STATE_LLM_PROVIDER=sarvam but no key, real tests skip gracefully.
24. Invalid JSON from LLM returns unknown/needsClarification, does not crash.
25. Low-confidence LLM result does not perform action.

## Logging tests

26. For expected active-state answer, debug has active_state_interpreter_called=true.
27. For expected active-state answer, generic_intent_classifier_called=false.
28. For side-question during booking, active flow/current state is preserved after answer.

## Safety tests

29. booking/ASK_PATIENT_NAME + `chest pain irukku` -> emergency, emergency_incident created, no patientName.
30. booking/ASK_TIME + `fever-ku enna tablet` -> medical advice refusal, no time extracted.
