# A06 Expanded - Notifications, Background Workers, and Voice-Ready Adapters

## Purpose

Implement production-ready asynchronous jobs and provider adapters for notifications, cleanup, knowledge processing, embeddings later, and voice-ready scaffolding.

This milestone fills the missing background jobs prompt.

## Required principle

Never send WhatsApp/SMS or call external providers inside the appointment transaction. Use notification_events outbox + queue worker.

## Notification outbox

Use notification_events as source of truth.

Required notification types:

- APPOINTMENT_CONFIRMED_PATIENT
- APPOINTMENT_TIME_CHANGED_PATIENT
- APPOINTMENT_CANCELLED_PATIENT
- STAFF_PENDING_APPOINTMENT_ALERT
- CALLBACK_REQUEST_ADMIN
- EMERGENCY_ALERT_ADMIN
- PATIENT_CANCEL_REQUEST_ADMIN
- PATIENT_RESCHEDULE_REQUEST_ADMIN
- KNOWLEDGE_GAP_ADMIN later

Required fields:

- clinic_id
- recipient_type
- recipient_phone/email
- channel
- event_type
- template_key
- payload_json
- status: pending | processing | sent | failed | cancelled
- scheduled_at
- attempts
- max_attempts
- last_error
- provider_message_id
- deduplication_key

## MessagingProvider interface

Implement:

- MockMessagingProvider
- WhatsApp/SMS provider interface only
- no real Twilio/Exotel provider required unless env configured

Methods:

```ts
sendWhatsApp(input)
sendSms(input)
```

## NotificationWorker

Worker should:

1. Fetch pending notification_events.
2. Mark processing safely.
3. Call provider.
4. Mark sent or failed.
5. Retry with backoff.
6. Never send duplicate if deduplication key already sent.

## Staff pending appointment notification

When Vaidya creates pending_confirmation appointment:

- Patient hears request captured; not confirmed.
- Optional staff notification is created based on clinic_settings.

Do not send patient confirmation until clinic confirms.

## Cleanup jobs

Implement job handlers:

### Recording cleanup

- Find calls with recording_expires_at < now and recording not deleted.
- Delete object storage file through ObjectStorageProvider.
- Mark recording_deleted_at.

### Transcript cleanup

- Find call_transcripts older than 30 days or transcript_expires_at < now.
- Delete or redact transcript text.
- Keep call metadata.

### Slot hold expiry

May be implemented in A03; if already exists, register it with queue/scheduler here.

### Slot generation

May be implemented in A03; if already exists, register repeatable daily job here.

### DOCX parsing

When knowledge file uploaded:

- create knowledge_files row
- enqueue PARSE_KNOWLEDGE_DOCX
- parse Q&A rows
- insert clinic_knowledge_base rows as pending_review
- never auto-approve upload rows

### Embeddings later

Add job stub:

- GENERATE_KNOWLEDGE_EMBEDDING
- no real provider required yet
- status remains pending/not_required if simple text search is active

### Daily clinic report later

Add job stub:

- GENERATE_DAILY_CLINIC_REPORT
- no production sending required yet

## ObjectStorageProvider interface

Implement:

- MockObjectStorageProvider
- S3CompatibleObjectStorageProvider stub or disabled implementation

Methods:

```ts
putObject
getSignedUrl
deleteObject
```

## Voice-ready provider interfaces

Do not implement live voice fully.

Create interfaces and mocks:

- TelephonyProvider
- STTProvider
- TTSProvider

No real Exotel/Twilio/Sarvam STT/TTS calls required in this milestone.

## Tests

1. Confirmed appointment creates patient notification_event.
2. Pending appointment creates staff notification only if setting enabled.
3. Pending appointment does not create patient confirmation event.
4. Cancelled appointment creates patient cancellation event.
5. Time edited appointment creates patient time-changed event.
6. Callback request creates admin notification.
7. Emergency incident creates high-priority clinic alert.
8. Notification worker sends pending mock event and marks sent.
9. Failed mock provider increments attempts and keeps retryable status.
10. Deduplication prevents duplicate sends.
11. Recording cleanup deletes expired mock object and updates DB.
12. Transcript cleanup removes/redacts old transcript.
13. DOCX parsing inserts pending_review Q&A only.
14. Embedding job stub does not fail when provider disabled.
15. Queue works in inline mode without Redis.
16. BullMQ mode uses Redis if configured.

## Acceptance criteria

- Notifications are asynchronous.
- No external provider required for tests.
- Jobs are observable through logs/status.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.
