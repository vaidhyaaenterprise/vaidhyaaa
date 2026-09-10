import type { ExtractedBookingFields } from '@vaidya/shared';
import type { StateEntityExtractorResult } from '@vaidya/shared';

export function mapStateEntityToBookingFields(
  result: StateEntityExtractorResult,
): ExtractedBookingFields {
  const fields: ExtractedBookingFields = {};

  if (result.entities.date) {
    fields.preferred_date = result.entities.date;
  }
  if (result.entities.timePreference) {
    fields.time_preference = result.entities.timePreference;
  }
  if (result.entities.exactTime) {
    fields.selected_time = result.entities.exactTime;
  }
  if (result.entities.selectedSlotId) {
    fields.selected_slot_id = result.entities.selectedSlotId;
  }
  if (result.entities.doctorName) {
    fields.doctor_name_fragment = result.entities.doctorName.toLowerCase();
  }
  if (result.entities.reasonForVisit) {
    fields.reason_for_visit = result.entities.reasonForVisit;
  }
  if (result.entities.patientName) {
    fields.patient_name = result.entities.patientName;
  }
  if (result.recognizedAs === 'yes_confirmation') {
    fields.confirmation = 'yes';
  }
  if (result.recognizedAs === 'no_rejection' || result.recognizedAs === 'flow_cancel') {
    fields.confirmation = 'no';
  }

  return fields;
}

export function buildSideQuestionClassification(
  interpretation: StateEntityExtractorResult,
  messageText: string,
  languageCode: string,
): import('@vaidya/shared').IntentClassifierResult {
  const intent = sideQuestionIntentToAgentIntent(interpretation.entities.sideQuestionIntent);
  const feeCategory =
    /\bmri\b/i.test(messageText) ||
    /\bscan fee\b/i.test(messageText) ||
    /\bprocedure fee\b/i.test(messageText) ||
    /\bx[- ]?ray fee\b/i.test(messageText)
      ? ('procedure' as const)
      : null;
  return {
    intent,
    confidence: interpretation.confidence,
    languageCode,
    entities: {
      topic: interpretation.entities.sideQuestionTopic ?? messageText,
      doctorName: interpretation.entities.doctorName ?? null,
      dayName: interpretation.entities.dayName ?? null,
      date: interpretation.entities.date ?? null,
      feeCategory,
    },
    safety: {
      isEmergency: false,
      isMedicalAdviceRequest: false,
    },
    needsClarification: false,
  };
}
export function sideQuestionIntentToAgentIntent(
  sideQuestionIntent: StateEntityExtractorResult['entities']['sideQuestionIntent'],
): string {
  switch (sideQuestionIntent) {
    case 'ask_fee':
      return 'ask_fee';
    case 'ask_timing':
      return 'ask_timing';
    case 'ask_location':
      return 'ask_location';
    case 'ask_doctor_availability':
      return 'ask_doctor_availability';
    case 'ask_previsit_instruction':
      return 'ask_previsit_instruction';
    case 'ask_insurance':
      return 'ask_insurance';
    case 'ask_human_agent':
      return 'ask_human_agent';
    default:
      return 'ask_previsit_instruction';
  }
}
