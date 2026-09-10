# A06 Expanded - Notifications, Jobs, and Workers Tests

Purpose: verify notification outbox, workers, retries, cleanup jobs, and async behavior.

## 1. Patient confirmation notification only after confirmed

Create appointment with status=pending_confirmation.

Expected:

- no patient confirmation notification sent
- optional staff notification may be created depending clinic setting

Confirm appointment.

Expected:

- notification_event created with type APPOINTMENT_CONFIRMED_PATIENT
- worker sends WhatsApp/SMS via provider adapter

## 2. Optional staff notification on pending appointment

Set clinic setting:

```text
notify_staff_on_pending_appointment=true
pending_appointment_notification_channel=whatsapp
```

Create pending appointment.

Expected:

- staff/internal notification_event created
- patient confirmation notification not created

Set false.

Expected:

- no staff notification event, but dashboard pending item exists

## 3. Appointment changed notification

Admin edits appointment time within allowed quick-edit threshold.

Expected:

- appointment_event written
- notification_event APPOINTMENT_TIME_CHANGED_PATIENT created
- worker sends notification

## 4. Appointment cancelled notification

Admin cancels appointment.

Expected:

- appointment status=cancelled
- appointment_event written
- notification_event APPOINTMENT_CANCELLED_PATIENT created
- worker sends notification

## 5. Emergency alert notification

Patient says chest pain.

Expected:

- emergency_incident created
- patient receives fixed 108 instruction immediately
- high-priority notification_event EMERGENCY_ALERT_ADMIN created
- worker sends clinic alert

## 6. Callback request alert

Patient asks receptionist callback.

Expected:

- callback_request status=pending
- notification_event CALLBACK_REQUEST_ADMIN created
- worker sends alert

## 7. User cancel/reschedule request notification

Patient requests cancel or reschedule by call.

Expected:

- appointment_action_request created
- notification_event PATIENT_CANCEL_REQUEST_ADMIN or PATIENT_RESCHEDULE_REQUEST_ADMIN created
- admin sees item in Appointments -> Reschedule / cancel

## 8. Provider failure retry

Mock provider fails first two attempts, succeeds on third.

Expected:

- worker retries with backoff
- notification_event eventually status=sent
- external send called exactly 3 times
- no duplicate event rows

## 9. Provider permanent failure

Mock provider always fails.

Expected:

- event status=failed after max attempts
- failure reason saved
- job does not crash worker process

## 10. Recording cleanup

Create call with recording_expires_at in past.

Run recording cleanup job.

Expected:

- object storage delete called
- calls.recording_deleted_at set
- recording_url removed/null or marked inaccessible
- call metadata remains

## 11. Transcript cleanup

Create transcript older than 30 days.

Run transcript cleanup job.

Expected:

- transcript text deleted/anonymized according to contract
- call metadata remains
- audit/cleanup event optional

## 12. DOCX parsing job

Upload DOCX knowledge file.

Expected:

- knowledge_file row created
- parse job enqueued
- extracted Q&A rows inserted as pending_review
- no auto-approval

## 13. Embedding job stub

Approve knowledge row.

Expected:

- embedding job queued if provider enabled
- no error if embedding provider is mock/no-op
- approved answer usable even if embedding pending when simple text search is enabled
