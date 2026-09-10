# A11 - Global NLU Classifier Hardening

## Purpose

Improve standalone intent classification for real-world receptionist messages.

## Rules

- Use global intent classifier only when no active flow exists.
- Emergency and medical advice override booking.
- LLM returns JSON only.
- Backend state machines execute actions.
- Do not store every phrase in DB.

## Implement

1. Expand supported intent schema.
2. Add capability-aware prompt context.
3. Add examples for Tamil/Tanglish spelling variation.
4. Add JSON validation and fallback.
5. Add confidence thresholds.
6. Add unsupported/out-of-scope classification.

## Intents

```text
book_appointment
reschedule_appointment
cancel_appointment
ask_fee
ask_timing
ask_location
ask_doctor_availability
ask_previsit_instruction
ask_insurance
ask_human_agent
emergency
medical_advice_request
language_switch
greeting_smalltalk
unsupported_service
out_of_scope
unknown
```

## Important examples

- `fever appointment venum` -> book_appointment
- `fever-ku enna tablet` -> medical_advice_request
- `chest pain appointment venum` -> emergency
- `tooth extraction-ku fasting venuma` -> ask_previsit_instruction
- `MRI scan fee evlo` -> ask_fee with topic=procedure/test fee, do not ask doctor fee clarification automatically
- `cricket score enna` -> out_of_scope

## Acceptance

- Mock remains default.
- Sarvam works behind env only.
- Unknown/low-confidence falls back safely.
- No DB write action in classifier.
