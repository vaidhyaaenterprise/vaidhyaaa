# A05C - Active-State Variation Interpreter and Language Packs

## Purpose

Improve Vaidya's ability to understand real-world active-flow replies in Tamil/Tanglish/English without relying on exhaustive phrase tables.

This is an add-on milestone after A05 and before A06/A07/A08.

## Problem to solve

Patient replies during active flows can be short, misspelled, mixed-language, or context-dependent:

```text
vendam / venam / venda / no / cancel / later
seri / sari / ok / okay / confirm pannunga
inniku / inaiku / iniku / today
naalaikku / nalaiku / nalaki / tomorrow
6:30 / 6.30 / six thirty / 6 arai
first one / earlier slot / second slot
```

Do not solve this by storing every phrase in DB. Instead, implement a layered active-state interpretation system.

## Required design

### 1. LanguagePackService

Create a language-pack system that stores small curated language-specific helpers.

Use existing `language_pack_configs` table if available, otherwise add config-backed implementation first.

Required structure:

```ts
export type LanguagePack = {
  languageCode: string;
  yesWords: string[];
  noWords: string[];
  cancelWords: string[];
  todayWords: string[];
  tomorrowWords: string[];
  timePreferenceWords: {
    morning: string[];
    afternoon: string[];
    evening: string[];
  };
  laterWords: string[];
};
```

Seed at least:

- `ta_tanglish`
- `english`

Do not treat these lists as exhaustive. They are only fast-path helpers.

### 2. ActiveStateInterpreter interface

Create or update:

```ts
export type ActiveStateInterpreterInput = {
  clinicId: string;
  sessionId: string;
  currentFlow: 'booking' | 'cancel' | 'reschedule' | 'handoff';
  currentState: string;
  languageCode: string;
  messageText: string;
  timezone: string;
  referenceDateIso: string;
  collected: Record<string, unknown>;
  expectedFields: string[];
  offeredSlots?: Array<{
    slotId: string;
    startTime: string;
    endTime: string;
    displayTime: string;
  }>;
};

export type ActiveStateInterpreterResult = {
  recognizedAs:
    | 'date_answer'
    | 'time_answer'
    | 'slot_selection'
    | 'patient_name'
    | 'phone_number'
    | 'yes_confirmation'
    | 'no_rejection'
    | 'flow_cancel'
    | 'side_question'
    | 'handoff_reason'
    | 'unknown';
  confidence: number;
  entities: {
    date?: string | null;
    timePreference?: 'morning' | 'afternoon' | 'evening' | null;
    exactTime?: string | null;
    selectedSlotId?: string | null;
    patientName?: string | null;
    phoneNumber?: string | null;
    sideQuestionIntent?: string | null;
    sideQuestionTopic?: string | null;
    handoffReason?: string | null;
  };
  needsClarification: boolean;
  clarificationReason?: string | null;
};

export interface ActiveStateInterpreter {
  interpret(input: ActiveStateInterpreterInput): Promise<ActiveStateInterpreterResult>;
}
```

### 3. Providers

Implement:

- `MockActiveStateInterpreter`
- `LanguagePackFastPathInterpreter`
- `SarvamActiveStateInterpreter`
- `CompositeActiveStateInterpreter`

Provider behavior:

```text
CompositeActiveStateInterpreter:
1. Try LanguagePackFastPathInterpreter.
2. If high confidence, return result.
3. If not confident and provider env allows LLM, call SarvamActiveStateInterpreter.
4. If LLM fails or low confidence, return unknown/needsClarification safely.
```

Environment:

```env
ACTIVE_STATE_INTERPRETER_PROVIDER=composite
ACTIVE_STATE_LLM_PROVIDER=mock # mock | sarvam
ACTIVE_STATE_LLM_MODEL=sarvam-30b
ACTIVE_STATE_LLM_FALLBACK_MODEL=sarvam-105b
ACTIVE_STATE_LLM_TIMEOUT_MS=8000
ACTIVE_STATE_LLM_ENABLE_FALLBACK=true
```

Default local/CI should not require real Sarvam.

### 4. Context-sensitive interpretation

The same phrase can mean different things depending on state.

Rules:

- booking/CONFIRM_DETAILS + vendam/no/cancel/later => flow_cancel; release active hold; no appointment.
- cancel/CONFIRM_CANCEL_REQUEST + vendam/no => no_rejection; do not cancel appointment.
- reschedule/CONFIRM_RESCHEDULE_REQUEST + vendam/no => no_rejection; release new hold; keep old appointment.
- handoff/ASK_REASON + vendam/no => flow_cancel; do not create callback.
- booking/ASK_PATIENT_NAME + vendam/no/cancel => flow_cancel, not patient name.

### 5. Do not overuse generic classifier

Inside active booking/cancel/reschedule/handoff flows:

- Do not call generic global IntentClassifier for expected answers.
- Use ActiveStateInterpreter.
- Generic classifier may be used only for side-question/interrupt classification if policy requires it.

Debug logs must show:

```json
{
  "current_flow": "booking",
  "current_state": "ASK_DATE",
  "active_state_interpreter_called": true,
  "generic_intent_classifier_called": false
}
```

### 6. LLM prompt for active-state interpreter

Implement a compact JSON-only prompt. It must include:

- current flow/state
- expected fields
- offered slots if any
- reference date/timezone
- collected fields
- strict output schema
- instruction: do not invent slot IDs
- instruction: return only one recognizedAs
- instruction: do not perform actions

The LLM output is not an action. It only informs the state machine.

### 7. Safety priority

Emergency and medical-advice detection must run before active-state interpretation.

If patient says chest pain during booking, do not treat it as reason/date/name. Emergency wins.

## Acceptance criteria

- Active-state spelling variations are understood better than phrase-only matching.
- Generic classifier is not called for expected active-state answers.
- LLM extractor is allowed for active-state understanding.
- LLM never writes DB or performs actions.
- Context-sensitive `vendam/no/cancel/later` behavior works.
- Tests pass with mock provider and without Sarvam key.
