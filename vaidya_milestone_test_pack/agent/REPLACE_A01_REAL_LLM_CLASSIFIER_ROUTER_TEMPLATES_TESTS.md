# REPLACE_A01 - Real LLM Classifier/Router/Templates Tests

Purpose: verify real LLM adapters are implemented safely while mock remains default.

## 1. Default remains mock

With env:

```env
PRIMARY_LLM_PROVIDER=mock
SERVICE_ROUTER_PROVIDER=mock
```

Expected:

- tests do not need SARVAM_API_KEY
- classifier works with mock
- service router works with mock
- no external network call in unit tests

## 2. Provider factory

Verify provider selection:

```text
mock -> MockIntentClassifier / MockServiceRouter
sarvam -> SarvamIntentClassifier / SarvamServiceRouter
unknown -> startup validation error
```

## 3. Sarvam adapter exists but is disabled by default

Code should include:

```text
SarvamIntentClassifier
SarvamServiceRouter
SarvamClient
LLM JSON parser
LLM timeout handler
LLM retry-on-invalid-json handler
```

But API should not call Sarvam unless env provider is `sarvam`.

## 4. JSON-only parser tests

Mock Sarvam responses:

- valid JSON object
- JSON inside code fence
- JSON with extra text
- invalid JSON
- empty content
- timeout
- HTTP 500

Expected:

- valid JSON parsed
- invalid/empty/timeout returns safe error or fallback
- no unhandled exception leaks
- standard error/log event recorded

## 5. Classifier intents

Test these messages with mock and mocked Sarvam fixture:

```text
Naalaikku evening appointment venum -> book_appointment
Doctor-a paakanum -> book_appointment
Token edukka venum -> book_appointment
Appointment cancel pannunga -> cancel_appointment
Appointment time change panna venum -> reschedule_appointment
Fees evlo? -> ask_fee
Dr Priya fees evlo? -> ask_fee
Sunday open-a? -> ask_timing
Clinic enga irukku? -> ask_location
Dr Priya inniku irukkangala? -> ask_doctor_availability
Scan-ku fasting venuma? -> ask_previsit_instruction
Parking irukka? -> ask_previsit_instruction
Insurance accept pannuveengala? -> ask_insurance
Receptionist kitta pesanum -> ask_human_agent
Chest pain irukku -> emergency
Fever-ku enna tablet? -> medical_advice_request
English please -> language_switch
Tooth extraction-ku fasting venuma? -> ask_previsit_instruction, not booking
```

## 6. Safety priority

Messages containing emergency plus appointment words must classify emergency:

```text
Chest pain irukku appointment venum
Moochu vida kashtama irukku doctor paakanum
Accident aayiduchu appointment book pannunga
```

Expected:

- emergency wins
- no booking flow started

## 7. Service router tenant isolation

Given Clinic A services and Clinic B services:

- Clinic A does not have dental
- Clinic B has dental

Message:

```text
Tooth pain appointment venum
```

Expected for Clinic A:

- unsupported or no_match
- never routes to Clinic B dental service

## 8. Confidence behavior

If primary model confidence < threshold:

- fallback model may be called if configured
- if fallback also low confidence, return unknown/clarify
- no DB action executed

## 9. Template registry

Verify template registry has ta_tanglish and english for at least:

```text
booking.greeting
booking.ask_problem_or_doctor
booking.ask_date
booking.ask_time
booking.propose_slots
booking.confirm_details
booking.created_pending
booking.flow_cancelled
safety.emergency
safety.medical_advice_refusal
knowledge.no_answer
unknown.clarify
language.switched
```

Missing template in QA should fail tests.
