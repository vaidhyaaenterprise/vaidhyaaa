# A12 - Active-State LLM Interpreter Enhancement

## Purpose

Make Vaidya understand natural replies inside active booking/cancel/reschedule/handoff flows without losing state.

This builds on A05C.

## Implement

1. Use ActiveStateInterpreter in every active flow before global classifier.
2. Add LLM-backed provider for ActiveStateInterpreter.
3. Add prompt examples for each active state.
4. Add side-question detection inside active state.
5. Add state-machine handling for side_question results.

## Active-state prompt requirements

The prompt must include:

- current_flow
- current_state
- expected_fields
- collected fields
- offered slots
- clinic timezone
- reference date
- language_code
- strict JSON schema

The prompt must say:

```text
You only extract what the patient meant in this state.
You must not decide final action.
You must not create/cancel/reschedule appointments.
You must not invent slot IDs.
If choosing a slot, choose only from offered_slots.
Return JSON only.
```

## Side-question handling

If patient asks fee/timing/location/knowledge question during booking:

- return recognizedAs=side_question
- set sideQuestionIntent/topic
- state machine answers side question using structured DB/knowledge
- then resumes previous active state prompt

## Acceptance

- `inaiku iruka` in ASK_DATE understood.
- `6 arai` in ASK_TIME understood through LLM when fast path cannot parse.
- `first one` in PROPOSE_SLOTS selects offered slot only.
- `Dr Priya fees evlo` during booking is side_question and resumes booking.
- Emergency/medical advice still override before active-state interpretation.
