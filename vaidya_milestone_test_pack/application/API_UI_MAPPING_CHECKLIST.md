# API to UI Mapping Checklist

Use this when testing Application milestones.

## Home

```text
[ ] GET summary endpoint exists or placeholder data clearly marked
[ ] Pending confirmations count maps to appointment_requests status=pending_confirmation
[ ] Callback count maps to callback_requests status=pending
[ ] Emergency alert count maps to emergency_incidents
[ ] Agent status maps to clinic_settings.agent_enabled + answering_mode
```

## Call Inbox

```text
[ ] GET /v1/calls used for list
[ ] GET /v1/calls/{id} used for detail
[ ] GET /v1/calls/{id}/transcript used for transcript
[ ] GET /v1/calls/{id}/recording-url used for signed recording URL
```

## Appointments

```text
[ ] pending tab filters pending_confirmation
[ ] confirmed tab filters confirmed
[ ] visited tab filters visited
[ ] reschedule/cancel tab uses appointment_action_requests
[ ] doctor view adds doctor_id ownership filter
```

## Clinic Setup

```text
[ ] clinic settings use GET/PATCH /v1/clinic/settings
[ ] clinic hours use GET/PUT/POST/PATCH pattern
[ ] doctor schedules use GET/PUT/POST/PATCH pattern
[ ] services and mappings use clinic_services and doctor_services APIs
[ ] booking rules use doctor-service booking-rule APIs
```

## Knowledge

```text
[ ] manual Q&A uses POST /v1/knowledge/manual
[ ] upload uses POST /v1/knowledge/upload-docx
[ ] approvals use approve/bulk approve APIs
[ ] status filters pending_review/approved/disabled
```
