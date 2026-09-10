# A05B Tests - Active-State LLM Interpreter and State Entity Extractor

## Purpose

Verify that active booking/cancel/reschedule/handoff flows use a state-aware entity extractor instead of re-running the generic global intent classifier.

The tests must prove:

```text
- generic IntentClassifier is not called for expected active-state answers
- StateEntityExtractor is called
- LLM-backed extractor is allowed behind env
- backend state machines still own all actions
- emergency and medical-advice checks override active flows
```

---

## Global commands

Run after implementation:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter api agent:evaluate:state-extractor:mock
```

Optional real test:

```bash
SARVAM_API_KEY=... STATE_ENTITY_EXTRACTOR_PROVIDER=sarvam pnpm --filter api agent:evaluate:state-extractor:real
```

The real command must skip gracefully if `SARVAM_API_KEY` is missing.

---

## Unit tests: provider selection

### Test 1 - default provider is mock

Env:

```env
STATE_ENTITY_EXTRACTOR_PROVIDER=mock
```

Expected:

```text
StateEntityExtractorFactory returns MockStateEntityExtractor.
No Sarvam HTTP call occurs.
```

### Test 2 - Sarvam provider selected by env

Env:

```env
STATE_ENTITY_EXTRACTOR_PROVIDER=sarvam
```

Expected:

```text
StateEntityExtractorFactory returns SarvamStateEntityExtractor.
Sarvam calls are still mocked in unit tests.
```

### Test 3 - invalid provider fails fast

Env:

```env
STATE_ENTITY_EXTRACTOR_PROVIDER=random
```

Expected:

```text
API startup/config validation fails with useful error.
```

---

## Unit tests: strict JSON parsing

### Test 4 - valid JSON accepted

Mock LLM returns:

```json
{
  "recognizedAs": "date_answer",
  "confidence": 0.92,
  "entities": { "date": "2026-05-16" },
  "needsClarification": false
}
```

Expected:

```text
Parsed successfully.
```

### Test 5 - code fenced JSON accepted

Mock LLM returns:

```text
```json
{"recognizedAs":"yes_confirmation","confidence":0.95,"entities":{},"needsClarification":false}
```
```

Expected:

```text
Parser strips fence and parses JSON.
```

### Test 6 - invalid JSON returns safe fallback

Mock LLM returns non-JSON.

Expected:

```text
Extractor returns recognizedAs=unknown, needsClarification=true or uses fallback model if enabled.
API does not crash.
```

---

## Booking active-flow tests

Create a conversation in:

```text
current_flow=booking
current_state=ASK_DATE
```

Spy on:

```text
IntentClassifierAdapter.classify
StateEntityExtractor.extract
```

### Test 7 - ASK_DATE: inniku variants

Messages:

```text
inniku
inaiku iruka
iniku slot iruka
today
```

Expected:

```text
StateEntityExtractor called.
Generic IntentClassifier not called.
recognizedAs=date_answer.
entities.date = today's date in clinic timezone.
current_flow remains booking.
state advances according to BookingMachine.
```

### Test 8 - ASK_DATE: tomorrow variants

Messages:

```text
naalaikku
nalaki
tomorrow
```

Expected:

```text
recognizedAs=date_answer.
entities.date = tomorrow in clinic timezone.
```

### Test 9 - ASK_DATE: explicit date

Messages:

```text
May 16 2026
16 May
2026-05-16
```

Expected:

```text
entities.date = 2026-05-16.
```

### Test 10 - ASK_DATE: compound date + time

Message:

```text
Saturday morning
```

Expected:

```text
recognizedAs=date_answer.
entities.date populated.
entities.timePreference=morning.
BookingMachine should not ask time again if enough information exists.
```

---

## Booking ASK_TIME tests

Set:

```text
current_flow=booking
current_state=ASK_TIME
```

### Test 11 - time preference variants

Messages:

```text
morning
after noon
evening
eve
maalai
```

Expected:

```text
recognizedAs=time_answer.
timePreference normalized to morning/afternoon/evening.
Generic IntentClassifier not called.
```

### Test 12 - exact time variants

Messages:

```text
6:30
6.30
six thirty
6 arai
18:30
```

Expected:

```text
recognizedAs=time_answer.
exactTime normalized to HH:mm, e.g. 18:30 when context implies evening if available.
```

---

## Booking PROPOSE_SLOTS tests

Set:

```text
current_flow=booking
current_state=PROPOSE_SLOTS
```

Offered slots:

```json
[
  { "slotId": "slot_630", "displayTime": "6:30 PM" },
  { "slotId": "slot_715", "displayTime": "7:15 PM" }
]
```

### Test 13 - select by exact display time

Messages:

```text
6:30
6.30
6:30 okay
```

Expected:

```text
recognizedAs=slot_selection.
selectedSlotId=slot_630.
Only after this should SlotService.tryHoldSlot run.
```

### Test 14 - select by ordinal / relative phrase

Messages:

```text
first one
earlier slot
second slot
later one
```

Expected:

```text
first one / earlier slot -> slot_630
second slot / later one -> slot_715
```

### Test 15 - cannot invent slot

Message:

```text
8 PM
```

Expected:

```text
recognizedAs=unknown OR needsClarification=true.
selectedSlotId=null.
SlotService.tryHoldSlot is not called.
Reply asks to choose from offered slots or asks another time/date.
```

---

## Booking ASK_PATIENT_NAME tests

Set:

```text
current_flow=booking
current_state=ASK_PATIENT_NAME
```

### Test 16 - name extraction

Messages:

```text
Kumar
Naan Meena
My name is Ravi
```

Expected:

```text
recognizedAs=patient_name.
patientName normalized.
```

### Test 17 - negative words are not names

Messages:

```text
vendam
venam
venda
no
cancel
later
```

Expected:

```text
recognizedAs=flow_cancel.
patientName=null.
BookingMachine releases active hold if present.
No appointment_request created.
```

---

## Booking CONFIRM_DETAILS tests

Set:

```text
current_flow=booking
current_state=CONFIRM_DETAILS
```

### Test 18 - positive confirmation

Messages:

```text
seri
sari
ok
okay
confirm
book pannunga
appointment create pannunga
```

Expected:

```text
recognizedAs=yes_confirmation.
AppointmentService.createFromConfirmedHold is called only after ActionValidator passes.
```

### Test 19 - negative confirmation

Messages:

```text
vendam
venam
venda
no
later
cancel
```

Expected:

```text
recognizedAs=no_rejection.
Active hold released.
No appointment_request created.
```

---

## Side-question tests inside active booking

Set:

```text
current_flow=booking
current_state=ASK_DATE
```

### Test 20 - fee side question

Message:

```text
Dr Priya fees evlo?
```

Expected:

```text
recognizedAs=side_question.
sideQuestionIntent=ask_fee.
FeeHandler answers from structured DB.
Then response resumes ASK_DATE prompt.
current_flow=booking.
current_state=ASK_DATE.
```

### Test 21 - knowledge side question

Message:

```text
Parking irukka?
```

Expected:

```text
recognizedAs=side_question.
sideQuestionIntent=ask_previsit_instruction.
Knowledge handler answers approved answer or no-answer fallback.
Booking prompt resumes.
```

### Test 22 - timing side question

Message:

```text
Sunday open-a?
```

Expected:

```text
Structured TimingHandler answers only Sunday.
Booking prompt resumes.
```

---

## Cancel flow active-state tests

Set:

```text
current_flow=cancel
current_state=CONFIRM_CANCEL_REQUEST
```

### Test 23 - cancel confirmation

Messages:

```text
seri cancel pannunga
yes
cancel pannunga
```

Expected:

```text
recognizedAs=yes_confirmation.
appointment_action_request type=cancel is created.
appointment itself is not directly cancelled unless allow_patient_auto_cancel=true.
```

### Test 24 - cancel rejection

Messages:

```text
vendam
no
cancel venda
```

Expected:

```text
recognizedAs=no_rejection.
No appointment_action_request created.
Flow completes safely.
```

---

## Reschedule flow active-state tests

Set:

```text
current_flow=reschedule
current_state=ASK_NEW_DATE
```

### Test 25 - new date variants

Messages:

```text
naalaikku
this Friday
May 16 2026
```

Expected:

```text
recognizedAs=date_answer.
new requested date stored.
Same doctor/service kept by default.
```

Set:

```text
current_flow=reschedule
current_state=ASK_NEW_TIME
```

### Test 26 - new time variants

Messages:

```text
evening
6:30
maalai after 6
```

Expected:

```text
recognizedAs=time_answer.
new time preference/exact time stored.
```

---

## Handoff active-state tests

### Test 27 - collect reason

Set:

```text
current_flow=handoff
current_state=ASK_REASON_OPTIONAL
```

Message:

```text
Report pathi pesanum
```

Expected:

```text
recognizedAs=unknown or side_question with topic captured based on implementation.
HandoffMachine stores reason.
No callback_request until required name/phone present.
```

### Test 28 - vendam cancels handoff

Message:

```text
vendam
```

Expected:

```text
recognizedAs=flow_cancel.
No callback_request created.
```

---

## Safety override tests

### Test 29 - emergency overrides booking

Set:

```text
current_flow=booking
current_state=ASK_DATE
```

Message:

```text
chest pain irukku
```

Expected:

```text
Emergency detector wins before StateEntityExtractor.
EmergencyIncident created.
Emergency notification_event created.
No booking state advancement.
No appointment created.
```

### Test 30 - medical advice overrides booking

Message:

```text
fever-ku enna tablet?
```

Expected:

```text
medical_advice_request wins before StateEntityExtractor.
Fixed refusal template.
No knowledge answer.
No appointment created.
```

---

## Logging tests

### Test 31 - generic classifier not called in active state

For active booking state with message:

```text
naalaikku
```

Expected logs/debug:

```json
{
  "current_flow": "booking",
  "current_state": "ASK_DATE",
  "interpreter": "state_entity_extractor",
  "generic_classifier_called": false
}
```

### Test 32 - generic classifier still called when no active flow

Set:

```text
current_flow=none
current_state=IDLE
```

Message:

```text
Naalaikku appointment venum
```

Expected:

```text
Generic IntentClassifier called.
StateEntityExtractor not called.
Booking flow starts.
```

---

## Real LLM integration tests, skipped by default

These tests should run only when:

```text
SARVAM_API_KEY exists
STATE_ENTITY_EXTRACTOR_PROVIDER=sarvam
```

### Test 33 - real extractor Tamil/Tanglish date variants

Dataset:

```text
inniku
inaiku iruka
nalaki
indha Saturday
```

Expected:

```text
>= 90% correct recognizedAs/date extraction.
```

### Test 34 - real extractor yes/no/cancel variants

Dataset:

```text
seri
sari
ok pannunga
vendam
venam
later paakalam
```

Expected:

```text
positive/negative/flow_cancel correctly classified according to current_state.
```

### Test 35 - real extractor slot selection variants

Offered slots:

```text
6:30 PM, 7:15 PM
```

Dataset:

```text
first one
6 arai
7:15 okay
second slot
```

Expected:

```text
>= 90% correct selectedSlotId.
No invented slot IDs.
```

---

## Regression checklist after A05B

Run earlier milestone tests again:

```text
A00 conversation foundation
A01 classifier/router/template tests
A02 booking capacity tests
A04 structured info + knowledge tests
A05 cancel/reschedule/handoff/emergency tests
```

Especially verify:

```text
[ ] booking happy path still passes
[ ] no double booking still passes
[ ] cancel/reschedule action request behavior still passes
[ ] side questions during booking still pass
[ ] emergency override still passes
[ ] medical advice refusal still passes
```

---

## Final pass condition

A05B passes only when:

```text
[ ] pnpm typecheck passes
[ ] pnpm lint passes
[ ] pnpm test passes
[ ] agent:evaluate:state-extractor:mock passes
[ ] CI does not need real Sarvam key
[ ] no generic IntentClassifier is called for expected active-state answers
[ ] StateEntityExtractor is allowed and logged for active states
[ ] LLM cannot write DB or perform actions
```
