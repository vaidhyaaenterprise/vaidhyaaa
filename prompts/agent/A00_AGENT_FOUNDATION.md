# Agent Milestone A00 - Conversation Foundation and Text Console API

## Goal
Build the backend conversation foundation. Do not implement full booking yet.

## Required components
- ConversationModule
- ConversationOrchestrator skeleton
- ConversationSessionRepository
- ConversationMessageRepository
- MessageIdempotencyRepository
- LockService interface
- InMemoryLockService for local
- TemplateRenderer
- LanguageManager

## API endpoints
```http
POST /v1/conversations
POST /v1/conversations/{sessionId}/messages
GET /v1/conversations/{sessionId}
```

## Behavior
- Create session with clinic_id, channel, patient_phone, language_code.
- Default language comes from clinic default unless explicitly provided.
- Store patient and assistant messages.
- Return current_flow/current_state.
- Implement idempotency for message sends.
- Use per-session lock.
- Debug fields returned only when DEBUG_API=true.

## Do not implement yet
- real LLM
- booking actions
- slot holds
- voice
- WhatsApp

## Tests
1. Create conversation with valid clinic.
2. Reject invalid clinic.
3. Send message inserts patient and assistant message.
4. Idempotency key prevents duplicate message processing.
5. `GET /conversations/{id}` returns messages in order.
6. Session lock prevents concurrent updates to same session.
7. Different sessions can process in parallel.
8. DEBUG_API=false hides debug.
9. Language switch message updates session language.
10. Missing session returns 404.

## Acceptance criteria
- Text test API is stable.
- No business action is executed yet.
