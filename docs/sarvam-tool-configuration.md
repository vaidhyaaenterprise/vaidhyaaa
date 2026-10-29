# Sarvam routing deployment

Deploy the API changes, then replace the entire Sarvam system instruction with `sarvam-system-instructions.txt`. Do not append it to the old prompt: the old symptom table, missing variable placeholders, and default-doctor rules contradict the replacement.

These are suggested Sarvam tool names mapped to the actual API. If an existing tool uses another name (for example `get_clinic_info` instead of `clinic_info`), rename the prompt's reference to match it consistently. Use the web-proxy base `https://vaidhyaa.vercel.app/api/backend` or the API's own origin; do not add another `/api/backend` when using the proxy base.

| Tool name in replacement prompt | Method and path | Inputs |
| --- | --- | --- |
| `resolve_clinic` | GET `/v1/api/tools/clinic-by-phone` | `clinic_phone` from the dialed clinic number |
| `list_clinic_services` | GET `/v1/api/tools/list-services` | `clinic_id` |
| `recommend_service` | GET `/v1/api/tools/recommend-service` | `clinic_id`; current `reason_for_visit`, OR `clinic_service_id`/`service_key`, OR `doctor_name`/`doctor_id`; optional doctor preference with concern/service |
| `check_available_slots` | GET `/v1/api/tools/check-slots` | `clinic_id`, current `doctor_id`, `clinic_service_id`, `date`; optional `doctor_name`, `time_preference`, `after_time`, `before_time` |
| `create_appointment` | POST `/v1/api/tools/create-appointment` | JSON: `clinic_id`, `session_id`, `patient_name`, `phone`, `reason_for_visit`, `doctor_id`, `clinic_service_id`, `date`, `slot_id`; optional `doctor_name`; use `time` only if the slot ID cannot be forwarded |
| `get_appointment_status` | GET `/v1/api/tools/appointment-status` | `clinic_id`, `phone` |
| `cancel_appointment` | POST `/v1/api/tools/cancel-appointment` | JSON: `clinic_id`, `session_id`, `phone`, `appointment_id` |
| `reschedule_appointment` | POST `/v1/api/tools/reschedule-appointment` | JSON: `clinic_id`, `session_id`, `phone`, `appointment_id`, `new_date`, `new_time` |
| `clinic_info` | GET `/v1/api/tools/clinic-info` | `clinic_id`, `topic`; `doctor_id` for fees/doctor availability; optional `day` |
| `search_clinic_knowledge` | GET `/v1/api/tools/search-knowledge` | `clinic_id`, `query` |
| `request_callback` | POST `/v1/api/tools/request-callback` | JSON: `clinic_id`, `session_id`, `phone`, optional `name`, `reason` |
| `record_call` | POST `/v1/api/tools/record-call` | JSON: `clinic_id`, `session_id`, `patient_phone`, `outcome`, `summary`; optional actual `started_at`, `ended_at`, `duration_seconds`, `call_id`, provider identifiers |

## Response mappings and state resets

- Map `resolve_clinic.currentDate`, `timezone`, `clinicId`, `clinicName`, `sessionId`, `location`, and `timing`. No clinic is hardcoded. The service catalogue is fetched separately when needed.
- Give the agent the complete `list_clinic_services.services` array, `serviceNames`, and `servicesText`. Do not map a multi-doctor `doctors` array into one scalar that gets overwritten by each doctor's entry.
- `recommend_service` accepts doctor names without requiring a concern first. A success has `matched=true`, `doctorId`, `doctorName`, `clinicServiceId`, `serviceName`, `serviceKey`, all `doctors` for that service, and `doctorSelection` (`requested` or `automatic`). This flag describes the request parameters, not proof of human intent: keep explicit caller preference separately in conversation state.
- On a new/replacement concern, clear previous selected service, automatic doctor, slot/time, hold and confirmation. Omit old automatic doctor/service inputs from the next recommendation. Retain only a doctor preference actually stated by the caller. An explicit service input is authoritative; sending an old `clinic_service_id` along with new symptoms cannot represent a genuine service change. Re-route with the current concern instead.
- On every successful recommendation, overwrite selected routing values from that response. On failure, clear selections; the response includes `doctorId=null` and `clinicServiceId=null`. Configure mappings to clear nulls or add an explicit conversation-state reset if Sarvam skips null-valued mappings.
- Pass `doctor_name` and the relevant concern/service when resolving same-named doctors. Do not retain an arbitrary old `doctor_id` while asking to resolve an ambiguous name. Once uniquely resolved, pass that ID consistently to availability and booking.
- `doctor_ambiguous` and `service_required_for_doctor` have `needsClarification=true`, `doctors` (including qualification when configured) and `services` choices. Ask which service/issue; retry recommendation. If still ambiguous, ask about a real distinguishing detail or offer a callback.
- `doctor_service_mismatch`, `doctor_name_id_mismatch`, and `service_id_key_mismatch` are clarification errors, not permission to silently substitute a doctor/service. No slot lookup or booking is performed for an unresolved pair.
- Slot responses retain `availableSlotsText` and add a `slots` array with `slotId`, `doctorId`, `doctorName`, `clinicServiceId`, `date`, `dateDisplay`, 24-hour `time`, spoken-period `timeText`, `appointmentStart` and `appointmentEnd`. Forward the full array to the agent. Keep the chosen slot and its routing IDs together.
- `after_time=12:00`: first three starts at or after noon. `before_time=12:00`: last three starts strictly before noon, in chronological order. Both bounds: first three within `[after_time, before_time)`. Do not map a missing/failed response to previously returned slots. `availableSlotsText` preserves the previous display format; use each structured slot's `timeText` to avoid AM/PM ambiguity.
- Booking validates both the selected doctor and service against the actual locked slot. Old slot IDs must not be reused after a routing change. A mismatch returns an error, not a successful booking under the wrong service.
- `appointment-status` now includes `clinicServiceId` for reschedule availability. The endpoint still returns one appointment, not an appointment list; multi-appointment ambiguity still requires staff help.
- For callbacks use `phone` and `name`, not `patient_phone`/`patient_name`; success is `submitted=true` with a non-null `callbackRequestId`. Record-call uses `outcome`, `summary`, `started_at`, `ended_at`, `duration_seconds`, not the old prompt's `call_outcome`/`call_summary`/`call_duration` names.

## Four acceptance conversations

1. **Services:** “What services do you have?” → list-services → read all returned active service names. No symptom mapping or invented specialty.
2. **Named doctor in a shared service:** a service returns Dr. A and Dr. B; caller says “Dr. B” → recommend-service with that current service and Dr. B → check-slots for B → book B. Never replace B with the default A.
3. **Changed issue:** initial concern routes to service A/automatic doctor A; caller replaces the issue with one for service B → clear old automatic routing/slots → recommend-service with the new concern only → select B's returned doctor → fetch new slots. If the caller had explicitly requested doctor A, ask about a returned compatible alternative instead of silently switching.
4. **Doctor first / duplicate names:** “I want Dr. Ravi” → recommend-service with doctor_name only. Unique doctor/service resolves directly. Two Ravi doctors yield doctor_ambiguous → ask service/issue → recommend again with name plus clarified concern/service. Same-name/same-service ambiguity must remain unresolved until a genuine distinguishing detail is provided.

The prompt file and code edits do not update a hosted Sarvam agent automatically. Deploy the API and apply these tool parameter/response mappings and the replacement prompt in the Sarvam dashboard before live testing. No database migration is required.
