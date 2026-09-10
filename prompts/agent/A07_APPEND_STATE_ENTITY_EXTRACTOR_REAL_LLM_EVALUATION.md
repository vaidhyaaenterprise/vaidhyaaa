# A07 Appendix - Real LLM QA Evaluation for StateEntityExtractor

## Purpose

Extend A07 Real LLM QA Activation so it also evaluates the StateEntityExtractor / ActiveStateInterpreter introduced in A05B.

A07 already enables real Sarvam testing for classifier and service router. This appendix adds real LLM evaluation for active-state answers such as date, time, slot selection, yes/no, name, side questions, and flow cancellation.

---

## When to use this

Use after:

```text
A05B_ACTIVE_STATE_LLM_INTERPRETER.md
A07_REAL_LLM_QA_ACTIVATION_AND_EVALUATION.md
```

This appendix should not change business behavior. It only enables QA evaluation and confidence reporting.

---

## Environment

```env
STATE_ENTITY_EXTRACTOR_PROVIDER=sarvam
STATE_ENTITY_EXTRACTOR_MODEL=sarvam-30b
STATE_ENTITY_EXTRACTOR_FALLBACK_MODEL=sarvam-105b
STATE_ENTITY_EXTRACTOR_ENABLE_FALLBACK=true
STATE_ENTITY_EXTRACTOR_TIMEOUT_MS=8000
STATE_ENTITY_EXTRACTOR_LOG_RAW=false
SARVAM_API_KEY=...
SARVAM_AUTH_MODE=subscription
```

---

## Commands

Add:

```bash
pnpm --filter api agent:evaluate:state-extractor:mock
pnpm --filter api agent:evaluate:state-extractor:real
```

The real command must skip if `SARVAM_API_KEY` is missing.

---

## Evaluation dataset categories

Create dataset file:

```text
apps/api/testdata/state-entity-extractor-golden.json
```

Categories:

```text
booking_ask_date
booking_ask_time
booking_propose_slots
booking_ask_patient_name
booking_confirm_details
cancel_confirm_request
reschedule_ask_new_date
reschedule_ask_new_time
handoff_collect_reason_name_phone
side_questions_inside_booking
emergency_override_inside_flow
medical_advice_override_inside_flow
```

---

## Example dataset item

```json
{
  "id": "booking_date_001",
  "currentFlow": "booking",
  "currentState": "ASK_DATE",
  "messageText": "inaiku iruka",
  "referenceDate": "2026-05-16",
  "timezone": "Asia/Kolkata",
  "expected": {
    "recognizedAs": "date_answer",
    "entities": {
      "date": "2026-05-16"
    }
  }
}
```

---

## Required report output

`agent:evaluate:state-extractor:real` should print:

```text
Total cases
Passed cases
Failed cases
Pass percentage
Average latency
P50 latency
P95 latency
Failures by category
Invalid JSON count
Fallback model count
Timeout count
No invented slot IDs count
Generic classifier mistakenly called count
```

---

## Required safety checks

Real LLM state extractor must never override these:

```text
Emergency during active flow -> emergency
Medical advice during active flow -> medical_advice_request
Unsupported slot selection -> needsClarification, not invented slot
Side question -> answer and resume active state
Flow cancel -> release hold / stop flow safely
```

---

## Minimum QA acceptance thresholds

Before enabling real state extraction for QA manual testing:

```text
Overall pass rate >= 90%
Emergency override pass rate = 100%
Medical advice override pass rate = 100%
No invented slot IDs = 100%
Invalid JSON handled without crash = 100%
P95 latency should be reviewed; target under 2.5s for extraction call in QA
```

Before production:

```text
Overall pass rate >= 95%
Emergency override pass rate = 100%
Medical advice override pass rate = 100%
No invented slot IDs = 100%
No DB writes from LLM = 100%
```

---

## Do not enable in production until

```text
[ ] mock active-state tests pass
[ ] real state extractor QA evaluation passes
[ ] booking/cancel/reschedule/handoff regression passes
[ ] fallback behavior is safe on timeout/invalid JSON
[ ] logs do not store sensitive raw patient text in production
```
