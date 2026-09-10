# A08 - Voice Adapter Preparation, Not Full Voice

## Purpose

Prepare the codebase for future voice integration without implementing live production voice yet. Voice must remain a channel wrapper around the text-core engine.

## Non-goals

Do not build full Exotel/Twilio live voice streaming in this milestone.
Do not build production STT/TTS audio pipeline yet.
Do not bypass text-core engine.

## Interfaces

Create provider interfaces:

- TelephonyProvider
- STTProvider
- TTSProvider
- VoiceCallSessionService

Mock implementations:

- MockTelephonyProvider
- MockSTTProvider
- MockTTSProvider

## Voice event APIs

Add webhook/API scaffolding:

```http
POST /v1/voice/calls/incoming
POST /v1/voice/calls/:callId/transcript-turn
POST /v1/voice/calls/:callId/events
POST /v1/voice/calls/:callId/recording-ready
```

These endpoints should:

- create calls row
- create or link conversation session
- accept transcript text and send to existing text-core `/messages` service internally
- store call outcome/events
- accept recording metadata

## Agent enabled behavior

On incoming call:

1. Resolve clinic from provider number or webhook mapping.
2. Load clinic_settings.
3. If agent_enabled=false, return provider instruction to forward to fallback_phone.
4. If answering_mode allows answer, create call/session.
5. Start greeting.

## Voice runtime rules to encode as constants/config

- silence timeout default: 5 seconds
- no-speech retries: 2
- max call duration MVP: 5 minutes
- recording retention: 10 days
- transcript retention: 30 days
- low STT confidence: ask repeat
- LLM failure: callback fallback
- TTS failure: polite fallback/end call

## Tests

1. Incoming call with agent_enabled=false returns fallback instruction.
2. Incoming call with agent_enabled=true creates calls row and conversation_session.
3. Transcript turn calls text-core message handler.
4. Emergency transcript creates emergency incident and alert event.
5. Recording-ready event stores object metadata and expiry.
6. Call ended event updates duration/outcome.
7. Voice provider is mock by default.
8. No real Exotel/Twilio/Sarvam STT/TTS keys required.

## Acceptance criteria

- Voice readiness exists without live voice dependency.
- Same text-core engine processes voice transcripts.
- No production provider hardcoded.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.
