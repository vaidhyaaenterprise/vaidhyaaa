# A00 Agent Foundation - What to Test and How

## Goal
Verify the text-core conversation engine skeleton, session/message persistence, locking abstraction, template renderer, and provider adapter interfaces.

## API smoke

Create a session:

```bash
curl -s -X POST http://localhost:3000/v1/conversations \
  -H "Content-Type: application/json" \
  -d '{"clinic_id":"<CLINIC_ID>","channel":"web_demo","patient_phone":"+919111111111"}' | jq
```

Send a message:

```bash
curl -s -X POST http://localhost:3000/v1/conversations/<SESSION_ID>/messages \
  -H "Content-Type: application/json" \
  -d '{"message_text":"Hello","idempotency_key":"a00_001"}' | jq
```

## Verify behavior

```text
[ ] conversation_sessions row is created
[ ] patient_phone and clinic_id are stored
[ ] language defaults to clinic default
[ ] patient message row is stored
[ ] assistant message row is stored
[ ] current_flow/current_state returned in API response
[ ] template renderer is used for replies
[ ] no real LLM is called when provider=mock
[ ] session lock abstraction exists
[ ] idempotency prevents duplicate message processing
```

## Idempotency test

Send same message twice with same `idempotency_key`.

Expected:

```text
[ ] Only one patient/assistant pair is stored
[ ] Same response is returned or duplicate is safely ignored
```

DB check:

```sql
SELECT sender, message_text, intent, reply_template_key
FROM conversation_messages
WHERE session_id = '<SESSION_ID>'
ORDER BY created_at;
```

## Negative checks

```text
[ ] Invalid session_id returns standard 404 error
[ ] Invalid clinic_id on session create returns standard error
[ ] Missing message_text returns VALIDATION_ERROR
[ ] Debug block appears only when DEBUG_API=true
```

## Pass condition

A00 passes when conversation sessions/messages work, locks/idempotency are in place, and all provider adapters are mockable.
