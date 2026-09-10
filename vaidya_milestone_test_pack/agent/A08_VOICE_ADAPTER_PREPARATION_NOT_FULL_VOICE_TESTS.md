# A08 - Voice Adapter Preparation Tests, Not Full Voice

Purpose: verify voice-ready interfaces exist without building full telephony integration yet.

## 1. Provider interfaces

Verify interfaces exist:

```text
TelephonyProvider
STTProvider
TTSProvider
VoiceAdapter
CallRecordingStorage
```

Mock implementations should exist for local/QA.

## 2. Agent off behavior

Given clinic_settings.agent_enabled=false:

Incoming call event should return/trigger forwarding instruction to fallback_phone.

Expected:

- Vaidya conversation session not started
- call forwarded/marked fallback
- audit/call event recorded

## 3. Answering modes

Test mode decisions:

```text
always_on -> Vaidya handles call
after_hours_only -> Vaidya handles only outside hours/holidays
overflow_after_n_rings -> provider forwards only after no answer
holiday_only -> Vaidya handles only holidays
off -> fallback_phone
```

## 4. Text-core reuse

Voice adapter must call the same conversation message API/service after STT.

Expected:

- no separate voice-only booking logic
- voice transcript creates conversation_messages just like text console

## 5. Recording metadata

Mock call ended + recording ready event.

Expected:

- calls row updated
- recording metadata stored
- recording_expires_at = call time + 10 days
- audio object stored outside Postgres

## 6. Transcript retention

Voice transcript rows must use 30-day retention policy.

## 7. Timeout/failure placeholders

Verify constants/config exist for:

```text
silence_timeout_seconds
no_speech_retry_count
max_call_duration_seconds
stt_low_confidence_threshold
llm_timeout_ms
tts_timeout_ms
```

No full voice implementation required in this milestone.
