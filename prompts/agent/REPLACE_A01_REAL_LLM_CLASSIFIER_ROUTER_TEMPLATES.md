# A01 - Real LLM Classifier, Service Router, and Template Registry

## Purpose

Replace/extend the original A01 prompt. The original pack used mock classifier/router heavily, which is correct for early deterministic tests, but production needs real provider adapters. Implement real LLM provider integration now, but keep the default runtime provider as mock until QA activation.

## Important runtime policy

- CI and unit tests must never require real Sarvam keys.
- Local dev defaults to mock provider.
- Real Sarvam can be enabled by env in QA after deterministic flows are stable.
- LLM returns JSON only.
- LLM never writes DB, never calls repositories, never executes actions.

## Environment

Add/verify:

```env
PRIMARY_LLM_PROVIDER=mock # mock | sarvam
PRIMARY_LLM_MODEL=sarvam-30b
FALLBACK_LLM_MODEL=sarvam-105b
LLM_TIMEOUT_MS=8000
LLM_ENABLE_FALLBACK=true
LLM_LOG_RAW=false
SARVAM_API_KEY=
SARVAM_AUTH_MODE=subscription
```

## Interfaces

Implement:

```ts
IntentClassifierAdapter
ServiceRouterAdapter
LlmClient
LlmJsonParser
LlmEvaluationRunner
```

Intent classifier input:

```ts
{
  clinicId: string;
  sessionId?: string;
  messageText: string;
  currentFlow: string;
  currentState: string;
  languageCode: string;
  knownCollectedFields: Record<string, unknown>;
}
```

Intent classifier output:

```ts
{
  intent: string;
  confidence: number;
  languageCode: string;
  entities: {
    patientName?: string | null;
    doctorName?: string | null;
    reasonForVisit?: string | null;
    date?: string | null;
    timePreference?: string | null;
    visitType?: string | null;
    topic?: string | null;
    requestedLanguageCode?: string | null;
  };
  safety: {
    isEmergency: boolean;
    isMedicalAdviceRequest: boolean;
    reason?: string | null;
  };
  needsClarification: boolean;
}
```

Service router input:

```ts
{
  clinicId: string;
  reasonForVisit: string;
  patientAgeHint?: string | null;
  activeClinicServices: Array<{
    id: string;
    serviceKey: string;
    serviceName: string;
    handlesJson: unknown;
    doesNotHandleJson: unknown;
    redFlagsJson: unknown;
    routingExamplesJson: unknown;
  }>;
}
```

Service router output:

```ts
{
  matched: boolean;
  clinicServiceId?: string;
  serviceKey?: string;
  confidence: number;
  unsupportedReason?: string;
  needsClarification?: boolean;
}
```

## Providers

Implement:

- MockIntentClassifierAdapter
- MockServiceRouterAdapter
- SarvamIntentClassifierAdapter
- SarvamServiceRouterAdapter

Provider selection:

```ts
if PRIMARY_LLM_PROVIDER=mock -> mock provider
if PRIMARY_LLM_PROVIDER=sarvam -> Sarvam provider
```

## Sarvam call rules

- Use Sarvam 30B primary.
- Use Sarvam 105B fallback only when:
  - primary request fails
  - JSON invalid after one repair attempt
  - confidence below threshold and fallback enabled
- Timeout each request.
- Retry at most once for transient HTTP/network failures.
- Do not parse reasoning_content as final JSON.
- Only parse assistant message content.
- If model returns non-JSON, try robust JSON extraction; if still invalid, return `unknown` or fallback provider depending configuration.

## Prompt requirements

Prompt must be compact, strict, and JSON-only. It must include:

- valid intent list
- emergency vs medical advice distinction
- booking vs medical-advice examples
- handoff examples
- language switch examples
- FAQ/knowledge examples
- output schema

The prompt must not include templates or DB data except minimal active clinic service profiles for service routing.

## Safety priority

Emergency and medical-advice must override booking.

Examples:

- "chest pain irukku appointment venum" -> emergency
- "fever-ku enna tablet" -> medical_advice_request
- "fever irukku appointment venum" -> book_appointment
- "tooth extraction-ku fasting venuma" -> ask_previsit_instruction, not booking

## Template registry

Implement a template registry with keys and language variants. Store in code or DB depending current architecture, but do not hardcode random reply text inside handlers.

Minimum template keys:

- booking.greeting
- booking.ask_problem_or_doctor
- booking.ask_date
- booking.ask_time
- booking.propose_slots
- booking.ask_patient_name
- booking.ask_phone
- booking.confirm_details
- booking.created_pending
- booking.created_confirmed
- booking.unsupported_service
- booking.flow_cancelled
- fee.answer
- fee.ask_doctor
- fee.not_found
- timing.answer
- timing.day_answer
- timing.day_closed
- location.answer
- availability.today_slots
- availability.no_slots
- availability.not_available
- knowledge.answer
- knowledge.no_answer
- cancel.confirm
- cancel.completed
- cancel.not_cancelled
- cancel.no_appointment_found
- reschedule.ask_new_date
- reschedule.ask_new_time
- reschedule.propose_slots
- reschedule.confirm
- reschedule.completed
- reschedule.not_changed
- handoff.ask_reason
- handoff.ask_name
- handoff.ask_phone
- handoff.created
- handoff.cancelled
- safety.emergency
- safety.medical_advice_refusal
- unknown.clarify
- language.switched

Languages required now:

- ta_tanglish
- english

## Evaluation harness

Add golden evaluation file for classifier/router:

- Tamil/Tanglish messages
- English messages
- emergency cases
- medical advice cases
- fee/timing/location
- knowledge questions
- service routing examples
- unsupported service examples

Run command:

```bash
pnpm --filter api agent:evaluate:mock
```

Optional real command:

```bash
pnpm --filter api agent:evaluate:real
```

Real command must skip if SARVAM_API_KEY missing.

## Tests

Mock tests:

1. `Naalaikku evening appointment venum` -> book_appointment.
2. `Knee pain appointment venum` -> book_appointment with reason.
3. `Fever-ku enna tablet?` -> medical_advice_request.
4. `Chest pain irukku appointment venum` -> emergency.
5. `Receptionist kitta pesanum` -> ask_human_agent.
6. `English please` -> language_switch.
7. `Parking irukka?` -> ask_previsit_instruction.
8. `Tooth extraction-ku fasting venuma?` -> ask_previsit_instruction, not booking.
9. Service router maps knee pain to ortho only if clinic service exists.
10. Service router returns unsupported when no matching clinic service exists.
11. Real provider is not called in unit tests.
12. Sarvam adapter handles invalid JSON gracefully.
13. Sarvam adapter falls back to 105B when configured and primary confidence low.

## Acceptance criteria

- Mock remains default provider.
- Real Sarvam provider can be enabled through env.
- No CI test needs real API key.
- Templates exist in ta_tanglish and english.
- Classifier/router cannot write DB.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.
