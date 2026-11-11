# Sarvam setup: saved variables only

Use [sarvam-system-instructions.txt](sarvam-system-instructions.txt) as the full replacement prompt. It maps the problem using the user's fixed symptom table, validates `service_key` with `recommend_service`, and reads saved scalar variables only. Do not enable or call the separate `list_clinic_services` tool for this prompt. The existing endpoint remains available to other clients.

Deploy the local API changes before configuring the new companion text fields. Local files do not update the hosted Sarvam agent. No migration is required. The table's keys must exactly match the clinic's configured service keys; the prompt's candidate mapping is not proof that the clinic offers a service.

Base URL for the endpoint suffixes below: `https://vaidhyaa.vercel.app/api/backend/v1/api/tools`. GET inputs are query parameters; POST inputs are JSON bodies.

## How to configure

1. Create the named agent variables below. Keep text/IDs/dates/errors as String variables with blank defaults. Flags must map to true/false; the prompt understands booleans or their string forms. Do not default success flags to true. Test the resulting values in Sarvam.
2. Enable inclusion of these variables in LLM context. Populate them DURING the call using the API tool's **Advanced → Save reply into variables**, as in the user's screenshot. Post-call extraction alone is insufficient.
3. Enter the response field path on the left and select the agent variable on the right. These APIs have no `data` wrapper. Nested paths use dots, such as `location.address`.
4. In the system instruction, use Sarvam's `@` picker to insert the actual variable references where the text names `@clinic_name`, etc. A pasted name alone is not a substitute for configuring its value.
5. Configure each tool's **If it fails** message to report that THIS lookup failed and its previously saved variables must not be used. A timeout/HTTP error may not update response variables. The agent must stop the affected flow rather than reusing stale facts.

Sarvam documents mid-call response mappings, variable context visibility, and the `@` picker in [Variables](https://docs.sarvam.ai/voice-agents/build/variables-personalization) and [API tools](https://docs.sarvam.ai/voice-agents/build/tools/https-tool).

## Conditional request fields: configure omission, not empty values

The tool schema lists supported fields; they are not all required in every request. Keep case-dependent fields optional and allow them to be absent. Do not hard-bind every optional parameter to a saved variable or inject every key through a fixed request template. A prompt cannot remove fields that the integration always injects independently of the agent's arguments.

**Omit means the key is absent**, not `null`, `""`, `"null"`, `"any"`, a guessed value, or a stale value. For GET tools, omit the query parameter and do not send a JSON body. For POST tools, omit the JSON property. Do not duplicate case-dependent inputs in request headers: the API accepts header fallbacks, so a stale doctor header can accidentally restrict a search even when the query omits doctor_id. Keep genuine authentication headers as configured.

Required information must be collected/resolved first. `session_id` is included only where listed and available; a saved value existing does not make it relevant to every tool. Never copy response status/error fields into requests.

| Tool / case | Send | Omit |
| --- | --- | --- |
| `resolve_clinic` | Dialed clinic's `clinic_phone` only | Caller phone and all booking fields |
| `recommend_service`, no requested doctor | `clinic_id`, mapped `service_key`, current `reason_for_visit` | `doctor_id`, `doctor_name`, `clinic_service_id`, date/time, session/patient/search fields |
| `recommend_service`, unresolved requested name | Same base plus `doctor_name` | `doctor_id`, `clinic_service_id` and unrelated fields |
| `recommend_service`, uniquely identified doctor | Same base plus `doctor_id` | `doctor_name`, `clinic_service_id` and unrelated fields |
| `check_available_slots`, ordinary search, any doctor | `clinic_id`, validated `clinic_service_id`, `date`, applicable time fields | Both doctor fields; `mode`, `from_date`, `to_date`, `service_key`, `reason_for_visit`, session/patient/slot fields |
| Ordinary search, requested or accepted doctor | Same base plus that `doctor_id` | `doctor_name`, `exclude_doctor_ids` and unrelated fields; search only that doctor |
| Rejected random doctor, search others | Ordinary base plus non-empty same-service `exclude_doctor_ids` | Both doctor fields; old/random doctor cannot be sent as a restriction |
| `overview`, all times on one day | `clinic_id`, `clinic_service_id`, `mode=overview`, `date` | `from_date`, `to_date`, all four time filters, unrelated fields |
| `overview`, all available dates | `clinic_id`, `clinic_service_id`, `mode=overview` | `date`, `from_date`, `to_date`, all time filters, unrelated fields |
| `overview`, caller-requested date range | Same overview base plus known `from_date` and/or `to_date` | `date`, unknown range boundary, all time filters, unrelated fields |
| Any overview for a single doctor | Add that doctor's `doctor_id` | `doctor_name`, `exclude_doctor_ids` |
| Any overview for all eligible doctors | Optionally add genuine non-empty same-service `exclude_doctor_ids` | Both doctor fields |
| Exact-time recheck after overview | Ordinary search base plus exact `time`; add chosen doctor ID only if specified, otherwise optional genuine exclusions | `mode`, range dates, `time_preference`, `after_time`, `before_time`, `doctor_name` |
| `create_appointment` | `clinic_id`, `patient_name`, `phone`, `reason_for_visit`, accepted `doctor_id`, `clinic_service_id`, `date`, `time`; known `session_id` | `slot_id`, `doctor_name`, `service_key`, search/overview fields, exclusions, `appointment_id` |
| `get_appointment_status` | `clinic_id`, `phone` only | Session, appointment ID, doctor/service/date/time/search fields |
| `cancel_appointment` | `clinic_id`, `phone`, `appointment_id`; known `session_id` | Doctor/service/date/time/search fields, patient name, slot ID |
| `reschedule_appointment` write | `clinic_id`, `phone`, `appointment_id`, `new_date`, `new_time`; known `session_id` | Doctor/service fields, `date`, `time`, both slot-ID fields and all search/overview fields |
| `clinic_info`, services or location | `clinic_id`, relevant `topic` only | `doctor_id`, `day` and unrelated fields |
| `clinic_info`, fee | `clinic_id`, `topic=fee`, resolved `doctor_id` | `day` and unrelated fields |
| `clinic_info`, clinic timing | `clinic_id`, `topic=timing`; `day` only if requested | `doctor_id`; omit `day` for weekly summary |
| `clinic_info`, doctor schedule | `clinic_id`, `topic=doctor_availability`, resolved `doctor_id`; `day` if requested | `date`, time filters; omit `day` to use today |
| `search_clinic_knowledge` | `clinic_id`, `query` only | Session, topic, patient/doctor/service/date/time fields |
| `request_callback` | `clinic_id`, `phone`; known `session_id`, `name`, `reason` only | Unknown optional details, `patient_name`, `patient_phone`, all booking/search fields |
| `record_call` | `clinic_id`, `outcome`, `summary`; known `session_id`, `patient_phone`, actual individual timing fields | Unknown timing/phone values, `phone`, all booking/search and unconfigured fields |

Normal-search time fields are also conditional:

| Caller request | Send | Omit |
| --- | --- | --- |
| Morning/afternoon/evening | `time_preference` | `time`, `after_time`, `before_time` |
| After a time | `after_time` | `time`, `time_preference`, `before_time` |
| Before a time | `before_time` | `time`, `time_preference`, `after_time` |
| Between two times | `after_time`, `before_time` | `time`, `time_preference` |
| Exact/chosen time | `time` | `time_preference`, `after_time`, `before_time` |
| Any time | No time fields | All four time fields; never send `time_preference=any` |

Combine a period with a cutoff only if the caller explicitly requests both and the interval is consistent. A changed preference replaces old fields. Switching from overview to search removes `mode=overview` and range fields; switching to overview removes all time filters.

## 1. resolve_clinic

GET `/clinic-by-phone`, input `clinic_phone`; runs at call start.

| Response field path | Save into variable |
| --- | --- |
| `found` | `clinic_found` |
| `error` | `clinic_error` |
| `clinicId` | `clinic_id` |
| `clinicName` | `clinic_name` |
| `sessionId` | `session_id` |
| `currentDate` | `clinic_current_date` |
| `timezone` | `clinic_timezone` |
| `timing.hoursSummary` | `clinic_hours_summary` |
| `location.address` | `clinic_address` |

The last four clinic identity/details mappings match the screenshot's naming. Add the other mappings too; clinic ID alone does not supply the date reference or success signal.

## 2. recommend_service

GET `/recommend-service`. Always send `clinic_id`. The agent chooses `service_key` from the prompt table and includes the current `reason_for_visit`. Add `doctor_name` only for an explicitly requested doctor, or `doctor_id` when uniquely resolved. Omit outdated doctor/service arguments.

| Response field | Save into variable |
| --- | --- |
| `matched` | `recommend_matched` |
| `error` | `recommend_error` |
| `clinicServiceId` | `recommend_service_id` |
| `serviceName` | `recommend_service_name` |
| `serviceKey` | `recommend_service_key` |
| `doctorId` | `recommend_doctor_id` |
| `doctorName` | `recommend_doctor_name` |
| `doctorSelection` | `recommend_doctor_selection` |
| `doctorChoicesText` | `recommend_doctor_choices_text` |
| `availableServicesText` | `recommend_available_services_text` |
| `serviceChoicesText` | `recommend_service_choices_text` |

New scalar fields avoid array mappings:

```json
{
  "doctorChoicesText": "Dr. Arun (MBBS) | doctor_id=doctor-a\nDr. Bala (MD) | doctor_id=doctor-b",
  "availableServicesText": "General Consultation, Pediatric Consultation",
  "serviceChoicesText": "General Consultation | service_key=general_consultation | clinic_service_id=service-general"
}
```

These are companion fields in the full recommendation response, not a new endpoint. Candidate doctor IDs are for tool inputs only and must never be spoken. On ambiguity/mismatch, the text contains relevant actual candidates. A successful recommendation has `error=""`; failed routing has a non-empty error. Without a requested doctor, `matched=true` plus `doctorSelection=pending_availability` and null doctor ID/name is expected. Ignore any old doctor variable if null mappings are skipped; never pass it to an all-doctor search.

## 3. check_available_slots

GET `/check-slots`.

- Normal search: `clinic_id`, validated `clinic_service_id`, `date`; optional `time_preference`, `after_time`, `before_time`, exact `time`.
- Requested doctor: add `doctor_id` from validated caller preference. Any doctor: omit both doctor ID and name. An earlier random offer must not restrict a new preference search.
- Declined random doctor: add its ID to comma-separated `exclude_doctor_ids`. The response echoes this list into the saved rejection variable; new service searches omit it to reset it.
- Explicit overview request: `mode=overview`; use `date` for one day or omit `date` for future available dates. Optional `from_date`/`to_date` restrict the range. Omit all time filters. Restrict doctor/exclusions as requested.

| Response field | Save into variable |
| --- | --- |
| `success` | `slots_success` |
| `error` | `slots_error` |
| `availabilityStatus` | `slots_availability_status` |
| `hasAvailability` | `slots_has_availability` |
| `suggestAnotherDate` | `slots_suggest_another_date` |
| `doctorSelection` | `slots_doctor_selection` |
| `doctorId` | `slots_doctor_id` |
| `doctorName` | `slots_doctor_name` |
| `clinicServiceId` | `slots_service_id` |
| `date` | `slots_date` |
| `dateDisplay` | `slots_date_display` |
| `availableSlotsText` | `available_slots_text` |
| `excludedDoctorIdsText` | `rejected_doctor_ids` |
| `availableDatesText` | `available_dates_text` |
| `availabilityText` | `doctor_availability_text` |
| `availabilityChoicesText` | `doctor_availability_choices_text` |

Search mode fills the selected doctor/date/time fields. Overview fills the date/availability text fields and does not select a doctor randomly. Never book directly from an overview; recheck the chosen doctor/date/exact time in normal search.

`availableSlotsText` is comma-separated 24-hour HH:mm, e.g. `09:00, 13:30, 18:00`; no `slots` array. `matched` means requested-window match; `same_day_alternative` means the returned times are nearest same-day alternatives outside that window; `no_slots` asks for another date without searching it automatically.

`availabilityChoicesText` is a flat string with doctor IDs, qualifications and actual dates/times, e.g. `Dr. Arun (MBBS) | doctor_id=doctor-a | 2026-11-04: 09:00, 09:30`. This allows a selected doctor's ID to be used without reading `doctorAvailability` arrays. Use `doctor_availability_text` for speech and `doctor_availability_choices_text` for internal matching.

Searches choose uniformly among doctors with matching slots, not by creation order or slot count. An explicit doctor remains fixed even for same-day alternatives. `after_time` takes the first three starts at/after the cutoff; `before_time` the last three strictly before it; both use `[after_time, before_time)`. Exact time restricts random selection to doctors at that time. Queries stay within the fixed 45-day booking horizon; overview across days runs only on explicit request.

## 4. create_appointment

POST `/create-appointment`. After confirmation, send only `clinic_id`, `patient_name`, `phone`, `reason_for_visit`, accepted `doctor_id`, `clinic_service_id`, `date`, `time` in HH:mm; include `session_id` when available. Omit `slot_id` and all search-only fields. Use current slot variables, never an older random doctor.

| Response field | Save into variable |
| --- | --- |
| `error` | `booking_error` |
| `status` | `booking_status` |
| `missingFieldsText` | `booking_missing_fields_text` |
| `appointmentId` | `booking_appointment_id` |

`missingFieldsText` is a new scalar companion to the legacy `missing` array. Success explicitly clears `error` and `missingFieldsText` to empty strings. `confirmed` means booked; `pending` means awaiting clinic confirmation. Check error first so old status values cannot turn a failed booking into success. `/create-appointment-fast` exposes the same scalar response fields if that alternative tool is used; do not call both creation tools for one booking.

## 5. get_appointment_status

GET `/appointment-status`, inputs `clinic_id`, `phone`.

| Response field | Save into variable |
| --- | --- |
| `error` | `status_error` |
| `found` | `status_found` |
| `appointmentId` | `status_appointment_id` |
| `patientName` | `status_patient_name` |
| `doctorId` | `status_doctor_id` |
| `doctorName` | `status_doctor_name` |
| `clinicServiceId` | `status_service_id` |
| `date` | `status_date` |
| `dateDisplay` | `status_date_display` |
| `time` | `status_time` |
| `timeText` | `status_time_text` |
| `statusDisplay` | `status_display` |

Only use details when this call succeeded, `status_error` is empty and `status_found=true`. The endpoint returns one appointment. Keep these separate from booking-search variables to avoid cancelling/rescheduling a different record.

## 6. cancel_appointment

POST `/cancel-appointment`, after confirmation: only `clinic_id`, `phone`, `appointment_id` from status; include `session_id` when available. Omit doctor/service/date/time and search fields.

| Response field | Save into variable |
| --- | --- |
| `error` | `cancel_error` |
| `cancelled` | `cancelled` |

Check error before the flag. Success clears the error; only `cancelled=true` confirms cancellation.

## 7. reschedule_appointment

POST `/reschedule-appointment`, after confirmation: only `clinic_id`, `phone`, `appointment_id`, `new_date`, `new_time` in HH:mm; include `session_id` when available. Omit `date`, `time`, both slot IDs and doctor/service/search fields. Check availability separately for the existing appointment's doctor/service.

| Response field | Save into variable |
| --- | --- |
| `error` | `reschedule_error` |
| `submitted` | `reschedule_submitted` |
| `actionRequestId` | `reschedule_request_id` |

No error plus submitted=true means a request awaiting clinic confirmation, not an already moved appointment.

## 8. clinic_info

GET `/clinic-info`, inputs `clinic_id`, `topic`, optional `doctor_id`, `day`. `topic=services` returns actual service names through this tool; the agent does not call the separate list-services API. Its response can internally share catalogue code without introducing another external tool call.

| Response field | Save into variable |
| --- | --- |
| `error` | `info_error` |
| `found` | `info_found` |
| `servicesText` | `info_services_text` |
| `doctorName` | `info_doctor_name` |
| `consultationFee` | `info_consultation_fee` |
| `followupFee` | `info_followup_fee` |
| `hoursSummary` | `info_hours_summary` |
| `day` | `info_day` |
| `hours` | `info_hours` |
| `available` | `info_available` |
| `timingsText` | `info_timings_text` |
| `address` | `info_address` |

Only fields for the CURRENT topic are fresh; ignore unrelated variables left by other topics. `timingsText` is a new flat companion to `timings`, e.g. `9:00 AM - 1:00 PM, 4:00 PM - 7:00 PM`. A closed clinic day returns found=false with hours=closed; a missing doctor schedule returns available=false and timingsText empty. Fees are formatted strings or empty when unavailable.

## 9. search_clinic_knowledge

GET `/search-knowledge`, inputs `clinic_id`, `query`.

| Response field | Save into variable |
| --- | --- |
| `error` | `knowledge_error` |
| `found` | `knowledge_found` |
| `answer` | `knowledge_answer` |
| `score` | `knowledge_score` |

Only use a fresh found=true result with sufficient score (at least 0.6 when provided). A found=false result must not reuse an older answer.

## 10. request_callback

POST `/request-callback`, inputs `clinic_id`, `phone`; include only known `session_id`, `name`, `reason`. Omit unknown optional values, booking/search fields and the incorrect aliases `patient_name`/`patient_phone`.

| Response field | Save into variable |
| --- | --- |
| `error` | `callback_error` |
| `submitted` | `callback_submitted` |
| `callbackRequestId` | `callback_request_id` |

Require an empty error, submitted=true and a non-empty ID. No inserted record now reports submitted=false with callback_create_failed, preventing stale saved IDs from implying success.

## 11. record_call

POST `/record-call`, inputs `clinic_id`, `outcome`, `summary`; include known `session_id`, `patient_phone`, and each actual measured `started_at`, `ended_at`, `duration_seconds` when available. Omit unknown values and unrelated booking/search fields. Use `patient_phone`, not `phone`.

| Response field | Save into variable |
| --- | --- |
| `error` | `record_error` |
| `success` | `record_success` |
| `callId` | `record_call_id` |

Use actual outcomes and timings, never invented values. Do not describe a pending request as confirmed.

## Final validation

- Confirm every `@variable` in the prompt exists and its API field is mapped. No prompt rule relies on an array being parsed by Sarvam.
- Test success, business error, not-found and HTTP failure paths. Read each current error first; transport failures invalidate previous values even if mappings were not updated.
- Verify concern-only booking maps the table key without a catalogue tool call, then searches all eligible doctors. Named-doctor booking stays restricted after validation; ambiguity uses saved doctor-choice text.
- Verify same-day fallback, rejection exclusions, explicit overview and exact-time booking preserve the accepted doctor/date/time.
- Deploy API plus these mappings and the replacement prompt together. A variable name in the instruction does not create its value automatically.
