# A05B - Active-State LLM Interpreter and State Entity Extractor

## Purpose

Implement a production-safe active-state interpreter for booking, cancel, reschedule, and handoff flows.

This milestone corrects the earlier strict rule that said active booking answers like `inniku`, `naalaikku`, `6:30`, `seri`, and `vendam` must always be parsed only by code.

For Vaidya, Tamil/Tanglish spellings vary too much for phrase-only parsing. The production behavior should be:

```text
Active flow answer
-> StateEntityExtractor / ActiveStateInterpreter with current-state context
-> State machine updates collected fields
-> ActionValidator validates any write action
-> Domain service writes DB if needed
```

The active-state extractor may be LLM-backed. It must not be the generic intent classifier.

---

## Where this milestone fits

Implement this after:

```text
A05 - Cancel, Reschedule, Handoff, Emergency Completion
```

Before:

```text
A06 - Notifications / workers
A07 - Real LLM QA Activation
A08 - Voice Adapter Preparation
```

This milestone touches agent core, BookingMachine, CancelMachine, RescheduleMachine, and HandoffMachine, but it must not change the DB schema unless your current code needs a small logging/audit field.

---

## Corrected rule

### Do not do this

```text
If current_flow=booking and current_state=ASK_DATE, call the global IntentClassifier again.
```

That causes active flow answers like `inniku iruka`, `nalaki`, `first one`, `seri`, or `vendam` to become `unknown` or wrongly start a new flow.

### Do this instead

```text
If current_flow is active:
  safety check first
  language switch check
  route to current flow machine
  call StateEntityExtractor with current_flow + current_state + expected fields
  update collected_json
  continue the same state machine
```

---

## Non-negotiable rules

1. The StateEntityExtractor may use LLM, but it must not execute actions.
2. The StateEntityExtractor must not write DB.
3. The StateEntityExtractor must not call repositories.
4. The StateEntityExtractor must not create, cancel, confirm, or reschedule appointments.
5. The StateEntityExtractor must not invent slots.
6. Slot selection must be limited to `offeredSlots` passed by the backend.
7. Emergency and medical-advice checks run before active-state extraction.
8. If extraction fails or confidence is low, ask a safe clarification inside the same flow.
9. Do not reset `current_flow/current_state` to unknown for expected active-state answers.
10. Logs must distinguish `generic_intent_classifier` from `state_entity_extractor`.

---

## Environment variables

Add or verify:

```env
STATE_ENTITY_EXTRACTOR_PROVIDER=mock
# mock | sarvam

STATE_ENTITY_EXTRACTOR_MODEL=sarvam-30b
STATE_ENTITY_EXTRACTOR_FALLBACK_MODEL=sarvam-105b
STATE_ENTITY_EXTRACTOR_ENABLE_FALLBACK=true
STATE_ENTITY_EXTRACTOR_TIMEOUT_MS=8000
STATE_ENTITY_EXTRACTOR_LOG_RAW=false
```

Defaults:

```text
local/CI: STATE_ENTITY_EXTRACTOR_PROVIDER=mock
QA: STATE_ENTITY_EXTRACTOR_PROVIDER=sarvam after A07 activation
production: STATE_ENTITY_EXTRACTOR_PROVIDER=sarvam after QA pass
```

CI must never require a real Sarvam API key.

---

## Required components

Implement:

```text
StateEntityExtractor interface
MockStateEntityExtractor
SarvamStateEntityExtractor
StateEntityExtractorFactory
StateEntityExtractorPromptBuilder
StateEntityExtractorJsonParser
StateEntityExtractorEvaluationRunner
ActiveStateInterpretationLogger
```

Reuse existing LLM infrastructure from A01 if already available:

```text
LlmClient
LlmJsonParser
Sarvam HTTP client
timeout / invalid JSON / fallback handling
```

Do not duplicate Sarvam client logic if A01 already implemented it.

---

## StateEntityExtractor input

```ts
export type StateEntityExtractorInput = {
  clinicId: string;
  sessionId: string;
  currentFlow: 'booking' | 'cancel' | 'reschedule' | 'handoff' | 'fee_clarification' | 'faq_clarification';
  currentState: string;
  languageCode: string;
  messageText: string;
  timezone: string;
  referenceDate: string; // ISO date in clinic timezone, e.g. 2026-05-16
  collected: Record<string, unknown>;
  expectedFields: string[];
  offeredSlots?: Array<{
    slotId: string;
    startTime: string;
    endTime: string;
    displayTime: string;
    availableCount?: number;
  }>;
  activeDoctors?: Array<{
    doctorId: string;
    doctorName: string;
  }>;
  activeServices?: Array<{
    clinicServiceId: string;
    serviceName: string;
  }>;
};
```

---

## StateEntityExtractor output

```ts
export type StateEntityExtractorResult = {
  recognizedAs:
    | 'date_answer'
    | 'time_answer'
    | 'doctor_answer'
    | 'service_answer'
    | 'slot_selection'
    | 'patient_name'
    | 'patient_identity_selection'
    | 'yes_confirmation'
    | 'no_rejection'
    | 'flow_cancel'
    | 'side_question'
    | 'unknown';

  confidence: number;

  entities: {
    date?: string | null;                 // ISO date YYYY-MM-DD
    timePreference?: 'morning' | 'afternoon' | 'evening' | null;
    exactTime?: string | null;            // HH:mm 24-hour local time
    selectedSlotId?: string | null;
    doctorId?: string | null;
    doctorName?: string | null;
    clinicServiceId?: string | null;
    patientName?: string | null;
    patientIdentityLabel?: string | null;
    sideQuestionIntent?:
      | 'ask_fee'
      | 'ask_timing'
      | 'ask_location'
      | 'ask_doctor_availability'
      | 'ask_previsit_instruction'
      | 'ask_insurance'
      | 'ask_human_agent'
      | null;
    sideQuestionTopic?: string | null;
  };

  needsClarification: boolean;
  clarificationReason?: string | null;
};
```

---

## LLM prompt requirements for active-state extraction

The prompt must be small and current-state scoped.

It must include:

```text
You are Vaidya's active-state entity extractor.
You are not a general intent classifier.
You must interpret the patient's message only for the current flow/state.
Return JSON only.
Do not perform actions.
Do not create/cancel/reschedule appointments.
Do not invent slot IDs.
If selecting a slot, choose only from offeredSlots.
If the message is a side question, return side_question.
If the message cancels the active flow, return flow_cancel.
If unclear, return unknown with needsClarification=true.
```

Do not include full clinic DB data. Only include the current state, expected fields, collected fields, offeredSlots, and minimal active doctor/service choices when needed.

---

## Safety order

The orchestrator processing order for active flow must become:

```text
1. Load session and lock.
2. Store patient message.
3. Explicit language switch parser.
4. Emergency / medical-advice detector.
5. If emergency -> fixed emergency response + emergency_incident + notification_event.
6. If medical_advice_request -> fixed refusal and keep/stop flow based on handler rule.
7. If current_flow != none -> current state machine.
8. State machine calls StateEntityExtractor with current state context.
9. State machine updates collected_json or handles side question/cancel.
10. ActionValidator validates writes.
11. Domain service executes transaction.
12. TemplateRenderer replies.
```

---

## Required behavior by state

### Booking / ASK_DATE

Messages:

```text
inniku
inaiku iruka
iniku slot iruka
today
naalaikku
nalaki
tomorrow
May 16 2026
16 May
this Saturday
Saturday morning
```

Expected result:

```json
{
  "recognizedAs": "date_answer",
  "confidence": 0.9,
  "entities": {
    "date": "2026-05-16",
    "timePreference": "morning"
  },
  "needsClarification": false
}
```

If the patient gives date + time together, extract both.

### Booking / ASK_TIME

Messages:

```text
evening
eve
maalai
morning
after 6
6:30
6.30
six thirty
6 arai
```

Expected result:

```json
{
  "recognizedAs": "time_answer",
  "confidence": 0.9,
  "entities": {
    "timePreference": "evening",
    "exactTime": "18:30"
  },
  "needsClarification": false
}
```

### Booking / PROPOSE_SLOTS

Input includes offeredSlots:

```json
[
  { "slotId": "slot_630", "displayTime": "6:30 PM" },
  { "slotId": "slot_715", "displayTime": "7:15 PM" }
]
```

Messages:

```text
6:30
6.30
first one
earlier slot
7:15 okay
second slot
```

Expected:

```json
{
  "recognizedAs": "slot_selection",
  "confidence": 0.95,
  "entities": {
    "selectedSlotId": "slot_630"
  },
  "needsClarification": false
}
```

If patient says a slot not offered:

```text
8 PM
```

Expected:

```json
{
  "recognizedAs": "unknown",
  "confidence": 0.4,
  "entities": {},
  "needsClarification": true,
  "clarificationReason": "requested_time_not_in_offered_slots"
}
```

The LLM must not invent a new slot.

### Booking / ASK_PATIENT_NAME

Messages:

```text
Kumar
Naan Meena
My name is Ravi
```

Expected:

```json
{
  "recognizedAs": "patient_name",
  "confidence": 0.9,
  "entities": {
    "patientName": "Kumar"
  },
  "needsClarification": false
}
```

But these must not be treated as names:

```text
vendam
venam
venda
no
cancel
later
```

Expected:

```json
{
  "recognizedAs": "flow_cancel",
  "confidence": 0.95,
  "entities": {},
  "needsClarification": false
}
```

### Booking / CONFIRM_DETAILS

Positive:

```text
seri
sari
ok
okay
confirm
yes
book pannunga
appointment create pannunga
```

Expected:

```json
{ "recognizedAs": "yes_confirmation", "confidence": 0.95, "entities": {}, "needsClarification": false }
```

Negative:

```text
vendam
venam
venda
no
cancel
later
```

Expected:

```json
{ "recognizedAs": "no_rejection", "confidence": 0.95, "entities": {}, "needsClarification": false }
```

### Cancel / CONFIRM_CANCEL_REQUEST

In cancel confirmation state:

```text
seri cancel pannunga
cancel pannunga
yes
```

means confirmation to create cancel action request.

```text
vendam
no
cancel venda
```

means do not cancel.

The same word `cancel` must be interpreted using current state context.

### Reschedule / ASK_NEW_DATE and ASK_NEW_TIME

Use the same date/time extraction rules as booking, but keep the existing appointment doctor/service by default.

### Handoff / ASK_REASON_OPTIONAL / ASK_NAME_IF_NEEDED / ASK_PHONE_IF_NEEDED

The extractor should identify:

```text
reason
patient_name
phone
flow_cancel
```

It should not create callback_request itself.

---

## Side-question handling inside active flow

If current state is booking and patient asks:

```text
Dr Priya fees evlo?
Parking irukka?
Sunday open-a?
Scan-ku fasting venuma?
Receptionist kitta pesanum
```

Extractor returns:

```json
{
  "recognizedAs": "side_question",
  "confidence": 0.9,
  "entities": {
    "sideQuestionIntent": "ask_fee",
    "sideQuestionTopic": "Dr Priya fee"
  },
  "needsClarification": false
}
```

Then state machine must:

```text
1. route side question to structured info or knowledge handler
2. answer safely
3. resume the exact current booking prompt
4. keep current_flow/current_state unchanged
```

Example response:

```text
Dr. Priya consultation fee Rs.700. Appointment-ku endha date venum?
```

---

## Logging and debug requirements

Add structured log fields:

```ts
{
  clinic_id,
  session_id,
  current_flow,
  current_state,
  active_state_interpreter_called: true,
  generic_intent_classifier_called: false,
  state_entity_extractor_provider: 'mock' | 'sarvam',
  recognized_as,
  confidence,
  safety_override: false,
  side_question: false
}
```

In DEBUG_API responses, include only safe debug fields when enabled:

```json
{
  "debug": {
    "flow": "booking",
    "state": "ASK_DATE",
    "interpreter": "state_entity_extractor",
    "recognized_as": "date_answer",
    "generic_classifier_called": false
  }
}
```

Do not log raw Sarvam responses in production unless `STATE_ENTITY_EXTRACTOR_LOG_RAW=true`, and even then avoid patient-sensitive logs.

---

## Evaluation command

Add:

```bash
pnpm --filter api agent:evaluate:state-extractor:mock
```

Optional real command:

```bash
pnpm --filter api agent:evaluate:state-extractor:real
```

Real command skips if Sarvam key is missing.

---

## Do not implement in this milestone

Do not implement:

```text
new appointment DB schema
new booking capacity changes
notification workers
pgvector
full voice pipeline
real STT/TTS
telephony integration
```

This milestone is only active-state interpretation and integration into existing state machines.

---

## Acceptance criteria

A05B is complete when:

```text
[ ] StateEntityExtractor interface exists.
[ ] MockStateEntityExtractor works and is default in local/CI.
[ ] SarvamStateEntityExtractor exists behind env.
[ ] Active booking/cancel/reschedule/handoff flows call StateEntityExtractor instead of generic IntentClassifier for expected answers.
[ ] Generic IntentClassifier is not called for active-state date/time/name/yes/no/slot-selection answers.
[ ] Emergency and medical advice still override active flows.
[ ] Side questions during active flows are answered and original state resumes.
[ ] Slot selection can only choose from offeredSlots.
[ ] Flow cancel releases active holds and creates no appointment/callback/action request.
[ ] Invalid JSON / timeout from LLM returns safe clarification, not crash.
[ ] CI passes without Sarvam API key.
[ ] pnpm typecheck, lint, and test pass.
```
