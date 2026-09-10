import {
  detectActiveSideQuestion,
  extractActiveDoctorName,
  extractActiveExactTime,
  extractActivePatientName,
  extractActivePreferredDate,
  extractActiveReasonForVisit,
  extractActiveTimePreference,
  isActiveAffirmative,
  isActiveDeclining,
  isActiveFlowCancel,
  selectOfferedSlot,
} from './active-state-parsers';
import { detectActiveScopeRedirect } from './receptionist-scope-policy';
import { getDefaultLanguagePack } from './language-pack';
import { runActiveStatePreflight } from './language-pack-fast-path';
import type {
  StateEntityExtractorInput,
  StateEntityExtractorResult,
} from './state-entity-types';

const DAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

function addDaysIso(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCDate(date.getUTCDate() + days);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function dayOfWeekFromIso(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
}

function extractDayOfWeekDate(text: string, referenceDate: string): string | null {
  const normalized = text.toLowerCase();
  for (let dayIndex = 0; dayIndex < DAY_NAMES.length; dayIndex += 1) {
    const dayName = DAY_NAMES[dayIndex]!;
    if (!new RegExp(`\\b(this\\s+)?${dayName}\\b`, 'i').test(normalized)) {
      continue;
    }
    const refDow = dayOfWeekFromIso(referenceDate);
    let offset = (dayIndex - refDow + 7) % 7;
    if (offset === 0 && /\bthis\b/i.test(normalized)) {
      offset = 0;
    } else if (offset === 0) {
      offset = 7;
    }
    return addDaysIso(referenceDate, offset);
  }
  return null;
}

function extractDayNameFromText(text: string): string | null {
  for (const dayName of DAY_NAMES) {
    if (new RegExp(`\\b${dayName}\\b`, 'i').test(text)) {
      return dayName.charAt(0).toUpperCase() + dayName.slice(1);
    }
  }
  return null;
}

function extractPhoneNumber(text: string): string | null {
  const digits = text.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+${digits}`;
  }
  const explicit = text.match(/\+?\d{10,12}/);
  return explicit?.[0] ?? null;
}

function unknownResult(reason?: string): StateEntityExtractorResult {
  return {
    recognizedAs: 'unknown',
    confidence: 0.4,
    entities: {},
    needsClarification: true,
    clarificationReason: reason ?? 'unclear_active_state_answer',
  };
}

export function extractStateEntitiesMock(input: StateEntityExtractorInput): StateEntityExtractorResult {
  const pack = getDefaultLanguagePack(input.languageCode);
  const preflight = runActiveStatePreflight(input, pack);
  if (preflight) {
    return preflight;
  }

  return extractStateEntitiesMockCore(input);
}

export function extractStateEntitiesMockCore(input: StateEntityExtractorInput): StateEntityExtractorResult {
  const text = input.messageText.trim();
  const { referenceDate, currentFlow, currentState } = input;

  if (currentFlow === 'terminal_ack') {
    if (isActiveAffirmative(text)) {
      return {
        recognizedAs: 'yes_confirmation',
        confidence: 0.95,
        entities: {},
        needsClarification: false,
      };
    }
    if (isActiveDeclining(text)) {
      return {
        recognizedAs: 'no_rejection',
        confidence: 0.95,
        entities: {},
        needsClarification: false,
      };
    }
    return unknownResult('terminal_ack_not_understood');
  }

  if (currentState.includes('CONFIRM')) {
    if (/^(aama|aam|amma|ஆமா|ஆம)$/i.test(text.trim())) {
      return {
        recognizedAs: 'yes_confirmation',
        confidence: 0.95,
        entities: {},
        needsClarification: false,
      };
    }
    if (isActiveAffirmative(text)) {
      return {
        recognizedAs: 'yes_confirmation',
        confidence: 0.95,
        entities: {},
        needsClarification: false,
      };
    }
  }

  const sideQuestion = detectActiveSideQuestion(text);
  if (
    detectActiveScopeRedirect(text) &&
    ['booking', 'reschedule', 'cancel', 'handoff'].includes(currentFlow) &&
    !['CONFIRM_DETAILS', 'CONFIRM_CANCEL_REQUEST', 'CONFIRM_RESCHEDULE_REQUEST'].includes(currentState)
  ) {
    return {
      recognizedAs: 'scope_redirect',
      confidence: 0.9,
      entities: {},
      needsClarification: false,
    };
  }

  if (sideQuestion && !['CONFIRM_DETAILS', 'CONFIRM_CANCEL_REQUEST', 'CONFIRM_RESCHEDULE_REQUEST'].includes(currentState)) {
    return {
      recognizedAs: 'side_question',
      confidence: 0.9,
      entities: {
        sideQuestionIntent: sideQuestion.intent,
        sideQuestionTopic: sideQuestion.topic,
        doctorName: extractActiveDoctorName(text),
        dayName: extractDayNameFromText(text),
        date:
          extractActivePreferredDate(text, referenceDate) ??
          extractDayOfWeekDate(text, referenceDate),
      },
      needsClarification: false,
    };
  }

  if (currentFlow === 'booking' || currentFlow === 'reschedule') {
    if (
      currentState === 'BOOKING_STARTED' ||
      currentState === 'ASK_PROBLEM_OR_DOCTOR' ||
      currentState === 'ASK_REASON'
    ) {
      const doctorName = extractActiveDoctorName(text);
      const reasonForVisit = extractActiveReasonForVisit(text);
      if (doctorName && !reasonForVisit) {
        return {
          recognizedAs: 'doctor_answer',
          confidence: 0.9,
          entities: { doctorName },
          needsClarification: false,
        };
      }
      if (reasonForVisit) {
        return {
          recognizedAs: 'service_answer',
          confidence: 0.9,
          entities: { reasonForVisit },
          needsClarification: false,
        };
      }
      const bareName = text.trim().split(/\s+/);
      if (
        bareName.length === 1 &&
        /^[a-z'-]+$/i.test(bareName[0] ?? '') &&
        !extractActiveReasonForVisit(text)
      ) {
        return {
          recognizedAs: 'doctor_answer',
          confidence: 0.85,
          entities: { doctorName: bareName[0]!.toLowerCase() },
          needsClarification: false,
        };
      }
      return unknownResult('reason_or_doctor_not_understood');
    }
  }

  if (currentFlow === 'cancel' && currentState === 'CONFIRM_CANCEL_REQUEST') {
    if (/\b(cancel|yes|seri|pannunga)\b/i.test(text) && !/\b(venda|vendam|venam|no)\b/i.test(text)) {
      return {
        recognizedAs: 'yes_confirmation',
        confidence: 0.95,
        entities: {},
        needsClarification: false,
      };
    }
    if (/\b(venda|vendam|venam|no)\b/i.test(text)) {
      return {
        recognizedAs: 'no_rejection',
        confidence: 0.95,
        entities: {},
        needsClarification: false,
      };
    }
  }

  if (currentFlow === 'reschedule' && currentState === 'CONFIRM_RESCHEDULE_REQUEST') {
    if (/\b(venda|vendam|venam|no)\b/i.test(text)) {
      return {
        recognizedAs: 'no_rejection',
        confidence: 0.95,
        entities: {},
        needsClarification: false,
      };
    }
  }

  if (
    currentFlow === 'handoff' &&
    (currentState === 'ASK_REASON' || currentState === 'ASK_REASON_OPTIONAL') &&
    (isActiveFlowCancel(text) || isActiveDeclining(text))
  ) {
    return {
      recognizedAs: 'flow_cancel',
      confidence: 0.95,
      entities: {},
      needsClarification: false,
    };
  }

  if (isActiveFlowCancel(text) || isActiveDeclining(text)) {
    return {
      recognizedAs: 'flow_cancel',
      confidence: 0.95,
      entities: {},
      needsClarification: false,
    };
  }

  if (
    isActiveAffirmative(text) &&
    !['ASK_PROBLEM_OR_DOCTOR', 'ASK_REASON', 'BOOKING_STARTED'].includes(currentState)
  ) {
    return {
      recognizedAs: 'yes_confirmation',
      confidence: 0.95,
      entities: {},
      needsClarification: false,
    };
  }

  if (currentFlow === 'booking' || currentFlow === 'reschedule') {
    if (currentState === 'ASK_DATE' || currentState === 'ASK_NEW_DATE' || currentState === 'ASK_ALTERNATE_TIME') {
      const date =
        extractActivePreferredDate(text, referenceDate) ?? extractDayOfWeekDate(text, referenceDate);
      const timePreference = extractActiveTimePreference(text);
      const reasonForVisit = extractActiveReasonForVisit(text);
      if (date && !reasonForVisit) {
        return {
          recognizedAs: 'date_answer',
          confidence: 0.9,
          entities: { date, timePreference: timePreference ?? null },
          needsClarification: false,
        };
      }
      if (reasonForVisit && !date) {
        return {
          recognizedAs: 'service_answer',
          confidence: 0.9,
          entities: { reasonForVisit },
          needsClarification: false,
        };
      }
      if (date) {
        return {
          recognizedAs: 'date_answer',
          confidence: 0.9,
          entities: { date, timePreference: timePreference ?? null },
          needsClarification: false,
        };
      }
      return unknownResult('date_not_understood');
    }

    if (currentState === 'ASK_TIME' || currentState === 'ASK_NEW_TIME') {
      const date =
        extractActivePreferredDate(text, referenceDate) ?? extractDayOfWeekDate(text, referenceDate);
      if (date) {
        return {
          recognizedAs: 'date_answer',
          confidence: 0.9,
          entities: { date },
          needsClarification: false,
        };
      }
      const timePreference = extractActiveTimePreference(text);
      const exactTime = extractActiveExactTime(text);
      if (timePreference || exactTime) {
        return {
          recognizedAs: 'time_answer',
          confidence: 0.9,
          entities: {
            timePreference: timePreference ?? null,
            exactTime: exactTime ?? null,
          },
          needsClarification: false,
        };
      }
      return unknownResult('time_not_understood');
    }

    if (currentState === 'PROPOSE_SLOTS' || currentState === 'PROPOSE_NEW_SLOTS') {
      const date =
        extractActivePreferredDate(text, referenceDate) ?? extractDayOfWeekDate(text, referenceDate);
      if (date) {
        return {
          recognizedAs: 'date_answer',
          confidence: 0.9,
          entities: { date },
          needsClarification: false,
        };
      }
      const selection = selectOfferedSlot(text, input.offeredSlots ?? []);
      if (selection.slotId) {
        return {
          recognizedAs: 'slot_selection',
          confidence: 0.95,
          entities: { selectedSlotId: selection.slotId },
          needsClarification: false,
        };
      }
const dateFallback =
        extractActivePreferredDate(text, referenceDate) ?? extractDayOfWeekDate(text, referenceDate);
      if (dateFallback) {
        return {
          recognizedAs: 'date_answer',
          confidence: 0.85,
          entities: { date: dateFallback, timePreference: null },
          needsClarification: false,
        };
      }
      return {
        recognizedAs: 'unknown',
        confidence: 0.4,
        entities: { selectedSlotId: null },
        needsClarification: true,
        clarificationReason: 'requested_time_not_in_offered_slots',
      };
    }

    if (currentState === 'ASK_PATIENT_NAME') {
      const patientName = extractActivePatientName(text);
      if (patientName) {
        return {
          recognizedAs: 'patient_name',
          confidence: 0.9,
          entities: { patientName },
          needsClarification: false,
        };
      }
      return unknownResult('patient_name_not_understood');
    }
  }

  if (currentFlow === 'handoff') {
    if (
      (currentState === 'ASK_REASON' || currentState === 'ASK_REASON_OPTIONAL') &&
      text.trim().length >= 3 &&
      !extractPhoneNumber(text) &&
      !isActiveFlowCancel(text) &&
      !isActiveDeclining(text)
    ) {
      return {
        recognizedAs: 'handoff_reason',
        confidence: 0.9,
        entities: { sideQuestionTopic: text.trim() },
        needsClarification: false,
      };
    }

    if (currentState === 'ASK_NAME_IF_NEEDED') {
      const patientName = extractActivePatientName(text);
      if (patientName) {
        return {
          recognizedAs: 'patient_name',
          confidence: 0.9,
          entities: { patientName },
          needsClarification: false,
        };
      }
    }
    if (currentState === 'ASK_PHONE_IF_NEEDED') {
      const phone = extractPhoneNumber(text);
      if (phone) {
        return {
          recognizedAs: 'unknown',
          confidence: 0.85,
          entities: { sideQuestionTopic: phone },
          needsClarification: false,
        };
      }
    }
  }

  const fallbackDate =
    currentState !== 'BOOKING_STARTED'
      ? extractActivePreferredDate(text, referenceDate)
      : null;
  const fallbackTime = extractActiveTimePreference(text) ?? extractActiveExactTime(text);
  if (fallbackDate) {
    return {
      recognizedAs: 'date_answer',
      confidence: 0.75,
      entities: {
        date: fallbackDate,
        timePreference: extractActiveTimePreference(text) ?? null,
      },
      needsClarification: false,
    };
  }
  if (fallbackTime) {
    return {
      recognizedAs: 'time_answer',
      confidence: 0.75,
      entities: {
        timePreference: typeof fallbackTime === 'string' && fallbackTime.includes(':')
          ? null
          : (fallbackTime as 'morning' | 'afternoon' | 'evening'),
        exactTime: typeof fallbackTime === 'string' && fallbackTime.includes(':') ? fallbackTime : null,
      },
      needsClarification: false,
    };
  }

  return unknownResult();
}
