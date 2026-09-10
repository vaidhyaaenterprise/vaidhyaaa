import type { IntentClassifierInput } from '../adapters/index';
import type { ServiceRouterInput } from '../adapters/index';
import type { StateEntityExtractorInput } from './state-entity-types';

const COLLECTED_KEYS_FOR_EXTRACTOR = [
  'reason_for_visit',
  'doctor_id',
  'doctor_name',
  'preferred_date',
  'time_preference',
  'clinic_service_id',
  'awaiting_terminal_ack',
  'patient_name',
] as const;

export const COMPACT_CLASSIFIER_SYSTEM_PROMPT = `Clinic receptionist NLU classifier. Return ONLY valid JSON. Tanglish spelling variants OK.
Use global classifier only when no active booking/cancel/reschedule flow is in progress.
Intents: greeting_smalltalk, book_appointment, cancel_appointment, reschedule_appointment, ask_timing, ask_fee, ask_location, ask_doctor_availability, ask_previsit_instruction, ask_insurance, ask_human_agent, emergency, medical_advice_request, language_switch, unsupported_service, out_of_scope, unknown.
Rules: emergency and medical_advice_request override booking. Symptom/reason + appointment -> book_appointment + reasonForVisit. Medication advice -> medical_advice_request. Procedure/test fee -> ask_fee + feeCategory=procedure. Cricket/weather/jokes -> out_of_scope. Clinic cannot do -> unsupported_service. Low confidence -> unknown + needsClarification=true.
Bare symptom/problem only (Fever, Knee pain, Stomach pain, Child fever, Back pain, Headache) -> book_appointment + reasonForVisit. Never classify bare symptoms as greeting_smalltalk.
greeting_smalltalk is ONLY hello/hi/vanakkam/thanks/social small talk with NO symptom, NO clinic question, and NO action request.
Examples: "fever appointment venum"->book_appointment; "Fever"->book_appointment; "fever-ku enna tablet"->medical_advice_request; "chest pain appointment venum"->emergency; "MRI scan fee evlo"->ask_fee; "cricket score enna"->out_of_scope.
Schema:{intent,confidence,languageCode,entities:{patientName,doctorName,reasonForVisit,date,timePreference,visitType,dayName,feeCategory,topic,requestedLanguageCode},safety:{isEmergency,isMedicalAdviceRequest,reason},needsClarification}`;

export const COMPACT_EXTRACTOR_SYSTEM_PROMPT = `Clinic active-state extractor. Return ONLY valid JSON matching the schema below. No prose, no extra keys, no conversational text fields.
You only extract what the patient meant in this state.
You must not decide final action.
You must not create/cancel/reschedule appointments.
You must not invent slot IDs.
If choosing a slot, choose only from offered_slots in the user payload.
Return JSON only.
Use current_flow, current_state, expected_fields, collected, offered slots, timezone, reference date, language_code, last_assistant_message, and recent_turns from the user payload. Tanglish spelling variants OK.
Interpret the patient message in context of what the assistant last asked. Example: after "which doctor?" -> "doctor Kumar paakanum" is doctor_answer with doctorName=Kumar; after slot list -> "seven ku okay" is slot_selection with exactTime=19:00 or matching offered slot.
Examples by state: ASK_PROBLEM_OR_DOCTOR/ASK_REASON "Fever"/"Knee pain"->service_answer + reasonForVisit; doctor name -> doctor_answer + doctorName; ASK_DATE "nalaki"/"inaiku"->date_answer; ASK_DATE "Naaliku evening"->date_answer + timePreference=evening; ASK_TIME "6 arai"/"after 6"/"Eveng"->time_answer evening; PROPOSE_SLOTS "first one"/"seven"/"7 maniku okay"->slot_selection from offered slots; ASK_PATIENT_NAME "Naan Ravi"->patient_name; CONFIRM "book pannunga"->yes_confirmation; side fee/timing/location during booking->side_question + sideQuestionIntent.
Side question -> recognizedAs side_question + sideQuestionIntent. Cancel -> flow_cancel. Handoff reason -> handoff_reason + sideQuestionTopic.
ASK_PROBLEM_OR_DOCTOR/ASK_REASON: symptom/problem -> recognizedAs service_answer + entities.reasonForVisit; doctor name -> doctor_answer + entities.doctorName. Do NOT copy ref date into entities.date unless patient gave a date.
Schema:{recognizedAs,confidence,entities:{date,timePreference,exactTime,selectedSlotId,doctorName,reasonForVisit,patientName,sideQuestionIntent,sideQuestionTopic,dayName},needsClarification,clarificationReason}`;

export const COMPACT_SERVICE_ROUTER_SYSTEM_PROMPT = `Clinic service router. JSON only. Use ONLY the active clinic service profiles in the user payload.
Rules: red flags or emergency symptoms -> matched=false, unsupportedReason=red_flag_emergency. doesNotHandle excludes a service. child/baby fever -> paediatric when configured. adult/mild fever -> general when configured. No cross-clinic ids. If two services fit equally, set needsClarification=true and clarificationQuestion. Unsupported specialty when clinic lacks it -> matched=false, unsupportedReason=no_matching_clinic_service.
Schema:{matched,clinicServiceId,serviceKey,confidence,unsupportedReason,needsClarification,clarificationQuestion}`;

export function buildCompactClassifierUserPayload(input: IntentClassifierInput): Record<string, unknown> {
  const known = input.knownCollectedFields ?? {};
  const slimKnown: Record<string, unknown> = {};
  for (const key of ['reason_for_visit', 'preferred_date', 'time_preference', 'doctor_id', 'patient_name']) {
    if (known[key] !== undefined && known[key] !== null && known[key] !== '') {
      slimKnown[key] = known[key];
    }
  }

  return {
    msg: input.messageText,
    flow: input.currentFlow,
    state: input.currentState,
    lang: input.languageCode,
    ...(Object.keys(slimKnown).length > 0 ? { known: slimKnown } : {}),
  };
}

export function buildCompactExtractorUserPayload(
  input: StateEntityExtractorInput,
): Record<string, unknown> {
  const collected: Record<string, unknown> = {};
  for (const key of COLLECTED_KEYS_FOR_EXTRACTOR) {
    const value = input.collected[key];
    if (value !== undefined && value !== null && value !== '') {
      collected[key] = value;
    }
  }

  const payload: Record<string, unknown> = {
    msg: input.messageText,
    flow: input.currentFlow,
    state: input.currentState,
    ref: input.referenceDate,
    timezone: input.timezone,
    language_code: input.languageCode,
    expect: input.expectedFields,
    ...(Object.keys(collected).length > 0 ? { collected } : {}),
  };

  if (input.offeredSlots?.length) {
    payload.slots = input.offeredSlots.map((slot) => ({
      id: slot.slotId,
      t: slot.displayTime,
    }));
  }

  if (input.lastAssistantMessageText) {
    payload.last_assistant_message = input.lastAssistantMessageText;
  }
  if (input.lastAssistantTemplateKey) {
    payload.last_assistant_template = input.lastAssistantTemplateKey;
  }
  if (input.recentTurns?.length) {
    payload.recent_turns = input.recentTurns.map((turn) => ({
      role: turn.role,
      text: turn.text,
      ...(turn.templateKey ? { template: turn.templateKey } : {}),
    }));
  }

  return payload;
}

export function buildCompactServiceRouterUserPayload(
  input: ServiceRouterInput,
): Record<string, unknown> {
  return {
    reason: input.reasonForVisit,
    patientAgeHint: input.patientAgeHint ?? null,
    services: input.activeClinicServices.map((service) => ({
      id: service.id,
      key: service.serviceKey,
      name: service.serviceName,
      handles: service.handlesJson,
      doesNotHandle: service.doesNotHandleJson,
      redFlags: service.redFlagsJson,
      examples: service.routingExamplesJson,
    })),
  };
}
