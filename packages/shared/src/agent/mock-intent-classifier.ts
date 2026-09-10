import type { IntentClassifierInput, IntentClassifierResult } from '../adapters/index';
import { DEFAULT_INTENT_CONFIDENCE, LOW_INTENT_CONFIDENCE } from './intents';

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function containsAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function extractDoctorName(text: string): string | null {
  const match = text.match(/\bdr\.?\s+([a-z]+)/i);
  return match?.[1] ? match[1].toLowerCase() : null;
}

function extractMockDayName(text: string): string | null {
  for (const [key, value] of Object.entries({
    sunday: 'Sunday',
    monday: 'Monday',
    tuesday: 'Tuesday',
    wednesday: 'Wednesday',
    thursday: 'Thursday',
    friday: 'Friday',
    saturday: 'Saturday',
  })) {
    if (new RegExp(`\\b${key}\\b`, 'i').test(text)) {
      return value;
    }
  }
  return null;
}

function extractMockTimePreference(text: string): string | null {
  const normalized = normalize(text);
  if (/\bevening\b|\bmaalai\b/i.test(normalized)) {
    return 'evening';
  }
  if (/\bmorning\b|\bkaalai\b/i.test(normalized)) {
    return 'morning';
  }
  if (/\bafternoon\b|\bmadiyanam\b/i.test(normalized)) {
    return 'afternoon';
  }
  return null;
}

function extractMockDate(text: string): string | null {
  const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch?.[1]) {
    return isoMatch[1];
  }

  const dmyMatch = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/);
  if (dmyMatch?.[1] && dmyMatch[2] && dmyMatch[3]) {
    return `${dmyMatch[3]}-${String(dmyMatch[2]).padStart(2, '0')}-${String(dmyMatch[1]).padStart(2, '0')}`;
  }

  const normalized = normalize(text);
  const today = new Date();
  const formatIso = (date: Date) => date.toISOString().slice(0, 10);
  if (/\b(inniku|inaiku|today|indru)\b/i.test(normalized)) {
    return formatIso(today);
  }
  if (/\b(naalaikku|naaliku|naalaiku|nalaki|tomorrow)\b/i.test(normalized)) {
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return formatIso(tomorrow);
  }

  const monthDay = text.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
  );
  if (monthDay?.[1] && monthDay[2]) {
    const monthNames: Record<string, number> = {
      january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5,
      june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
      october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
    };
    const month = monthNames[monthDay[1].toLowerCase()];
    const day = Number(monthDay[2]);
    if (month) {
      const year = today.getUTCFullYear();
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}

function extractMockFeeCategory(text: string): 'procedure' | null {
  const normalized = normalize(text);
  if (
    /\bmri\b/i.test(normalized) ||
    /\bscan fee\b/i.test(normalized) ||
    /\bprocedure fee\b/i.test(normalized) ||
    /\bx[- ]?ray fee\b/i.test(normalized)
  ) {
    return 'procedure';
  }
  return null;
}

function extractPatientNameIntro(text: string): string | null {
  const patterns = [
    /\bnaan\s+([a-z][a-z\s'-]{0,30}?)\s+pesur/i,
    /\bi am\s+([a-z][a-z\s'-]{0,30})\b/i,
    /\bmy name is\s+([a-z][a-z\s'-]{0,30})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const name = match?.[1]?.trim();
    if (name && name.length >= 2) {
      return name.split(/\s+/)[0]!.replace(/^./, (char) => char.toUpperCase());
    }
  }
  return null;
}

function detectGreeting(text: string): boolean {
  const normalized = normalize(text);
  if (detectBooking(text) || extractReasonForVisit(text)) {
    return false;
  }
  return (
    /^(hi+|hello+|hey+|vanakkam|good morning|good evening|namaste)\b/i.test(normalized) ||
    /\bnaan\s+[a-z]+\s+pesur/i.test(normalized)
  );
}

function buildMockEntities(text: string) {
  const visitType = detectFollowUpFee(text) || /\bfollow[- ]?up\b/i.test(text) ? 'followup' : null;
  return {
    patientName: extractPatientNameIntro(text),
    doctorName: extractDoctorName(text),
    reasonForVisit: extractReasonForVisit(text),
    date: extractMockDate(text),
    timePreference: extractMockTimePreference(text),
    visitType,
    dayName: extractMockDayName(text),
    feeCategory: extractMockFeeCategory(text),
    topic: detectHumanAgent(text) ? text : null,
    requestedLanguageCode: detectLanguageSwitch(text) ? 'english' : null,
  };
}

function extractReasonForVisit(text: string): string | null {
  const patterns = [
    /\b(knee pain|tooth pain|tooth extraction|fever|chest pain|back pain|headache|eye checkup)\b/i,
    /\b([a-z]+ pain)\b/i,
    /\b(follow[- ]?up)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }
  const singleSymptom = text.trim().match(/^(knee|fever|headache|tooth|chest|back)$/i);
  if (singleSymptom?.[1]) {
    const value = singleSymptom[1].toLowerCase();
    return value === 'knee' ? 'knee pain' : value;
  }
  return null;
}

function detectEmergency(text: string): boolean {
  return containsAny(text, [
    /\bchest pain\b/i,
    /\bmoochu vida kashtama\b/i,
    /\baccident\b/i,
    /\bbreath(ing)? (trouble|problem|kashtama)\b/i,
    /\b108\b/,
    /\bemergency\b/i,
  ]);
}

function detectMedicalAdvice(text: string): boolean {
  return containsAny(text, [
    /\bfever-ku enna tablet\b/i,
    /\bfever-ku enna medicine\b/i,
    /\benn[aae]? tablet\b/i,
    /\bmedicine (kudukka|edukka|sollunga)\b/i,
    /\bmedical advice\b/i,
    /\bwhat tablet\b/i,
    /\bwhich medicine\b/i,
  ]);
}

function detectOutOfScope(text: string): boolean {
  return containsAny(text, [
    /\bcricket score\b/i,
    /\bcricket\b/i,
    /\bhoroscope\b/i,
    /\bgold rate\b/i,
    /\bjoke sollunga\b/i,
    /\bweather\b/i,
    /\bpolitics\b/i,
  ]);
}

function detectUnsupportedService(text: string): boolean {
  return containsAny(text, [
    /\btattoo\b/i,
    /\bhair transplant\b/i,
    /\bpet clinic\b/i,
    /\bpassport photo\b/i,
    /\bvet clinic\b/i,
    /\bhoroscope\b/i,
    /\beye checkup\b/i,
  ]);
}

function detectPrevisitInstruction(text: string): boolean {
  return containsAny(text, [
    /\bfasting\b/i,
    /\bparking\b/i,
    /\bkondu varanum\b/i,
    /\bpre[- ]?visit\b/i,
    /\binsurance\b/i,
    /\baccept pannuveengala\b/i,
    /\breport ready\b/i,
    /\bscan-ku\b/i,
    /\bsapdalaama\b/i,
  ]);
}

function detectInsurance(text: string): boolean {
  return containsAny(text, [/\binsurance\b/i, /\baccept pannuveengala\b/i]);
}

function detectLanguageSwitch(text: string): boolean {
  return containsAny(text, [
    /\benglish please\b/i,
    /\bspeak english\b/i,
    /\btamil please\b/i,
    /\btamil-la pesunga\b/i,
    /\btamil la pesunga\b/i,
  ]);
}

function detectHumanAgent(text: string): boolean {
  return containsAny(text, [
    /\breceptionist\b/i,
    /\bhuman agent\b/i,
    /\bkitta pesanum\b/i,
    /\btalk to (staff|person)\b/i,
  ]);
}

function detectBooking(text: string): boolean {
  return containsAny(text, [
    /\bappointment\b/i,
    /\bbook pannunga\b/i,
    /\bpaakanum\b/i,
    /\btoken venum\b/i,
    /\btoken edukka\b/i,
    /\bvenum\b/i,
    /\bschedule\b/i,
  ]);
}

function detectCancel(text: string): boolean {
  return containsAny(text, [/\bcancel\b/i, /\bcancel pannunga\b/i]);
}

function detectReschedule(text: string): boolean {
  return containsAny(text, [
    /\breschedule\b/i,
    /\btime change\b/i,
    /\bchange panna venum\b/i,
  ]);
}

function detectFee(text: string): boolean {
  return containsAny(text, [/\bfees?\b/i, /\bevlo\b/i, /\bcost\b/i, /\bprice\b/i]);
}

function detectFollowUpFee(text: string): boolean {
  return /\bfollow[- ]?up\b/i.test(text) && detectFee(text);
}

function detectTiming(text: string): boolean {
  return containsAny(text, [
    /\bopen-a\b/i,
    /\bopen\b/i,
    /\btiming\b/i,
    /\bsunday\b/i,
    /\bmonday\b/i,
    /\binniku\b/i,
    /\binaiku\b/i,
    /\btoday\b/i,
  ]);
}

function detectLocation(text: string): boolean {
  return containsAny(text, [/\benga irukku\b/i, /\blocation\b/i, /\baddress\b/i, /\bwhere\b/i]);
}

function detectDoctorAvailability(text: string): boolean {
  return containsAny(text, [
    /\b(inniku|inaiku|naalaikku|naalaiku|nalaki|tomorrow)\b.*\b(irukkangala|irukkaangala|available)\b/i,
    /\b(irukkangala|irukkaangala|available)\b.*\b(inniku|inaiku|naalaikku|naalaiku|nalaki|tomorrow)\b/i,
    /\bdr\.?\s+\w+.*\b(inniku|inaiku|naalaikku|naalaiku|nalaki|tomorrow)\b/i,
    /\binniku irukkangala\b/i,
    /\binniku irukkaangala\b/i,
    /\bavailable today\b/i,
    /\bdoctor.*available\b/i,
  ]);
}

export function classifyIntentMock(input: IntentClassifierInput): IntentClassifierResult {
  const text = normalize(input.messageText);
  const languageCode = input.languageCode;
  const baseEntities = buildMockEntities(input.messageText);

  if (detectEmergency(text)) {
    return {
      intent: 'emergency',
      confidence: DEFAULT_INTENT_CONFIDENCE,
      languageCode,
      entities: baseEntities,
      safety: {
        isEmergency: true,
        isMedicalAdviceRequest: false,
        reason: 'emergency_symptoms_detected',
      },
      needsClarification: false,
    };
  }

  if (detectMedicalAdvice(text)) {
    return {
      intent: 'medical_advice_request',
      confidence: DEFAULT_INTENT_CONFIDENCE,
      languageCode,
      entities: baseEntities,
      safety: {
        isEmergency: false,
        isMedicalAdviceRequest: true,
        reason: 'medication_advice_request',
      },
      needsClarification: false,
    };
  }

  if (detectLanguageSwitch(text)) {
    return {
      intent: 'language_switch',
      confidence: DEFAULT_INTENT_CONFIDENCE,
      languageCode,
      entities: { ...baseEntities, requestedLanguageCode: 'english' },
      safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
      needsClarification: false,
    };
  }

  if (detectHumanAgent(text)) {
    return {
      intent: 'ask_human_agent',
      confidence: DEFAULT_INTENT_CONFIDENCE,
      languageCode,
      entities: baseEntities,
      safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
      needsClarification: false,
    };
  }

  if (detectOutOfScope(text)) {
    return {
      intent: 'out_of_scope',
      confidence: DEFAULT_INTENT_CONFIDENCE,
      languageCode,
      entities: { ...baseEntities, topic: text },
      safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
      needsClarification: false,
    };
  }

  if (detectUnsupportedService(text)) {
    return {
      intent: 'unsupported_service',
      confidence: DEFAULT_INTENT_CONFIDENCE,
      languageCode,
      entities: { ...baseEntities, topic: text },
      safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
      needsClarification: false,
    };
  }

  if (detectGreeting(text)) {
    return {
      intent: 'greeting_smalltalk',
      confidence: DEFAULT_INTENT_CONFIDENCE,
      languageCode,
      entities: baseEntities,
      safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
      needsClarification: false,
    };
  }

  if (detectInsurance(text)) {
    return {
      intent: 'ask_insurance',
      confidence: DEFAULT_INTENT_CONFIDENCE,
      languageCode,
      entities: { ...baseEntities, topic: text },
      safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
      needsClarification: false,
    };
  }

  if (detectPrevisitInstruction(text) && !detectBooking(text)) {
    return {
      intent: 'ask_previsit_instruction',
      confidence: DEFAULT_INTENT_CONFIDENCE,
      languageCode,
      entities: {
        ...baseEntities,
        topic: baseEntities.reasonForVisit ?? text,
      },
      safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
      needsClarification: false,
    };
  }

  if (detectCancel(text)) {
    return {
      intent: 'cancel_appointment',
      confidence: DEFAULT_INTENT_CONFIDENCE,
      languageCode,
      entities: baseEntities,
      safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
      needsClarification: false,
    };
  }

  if (detectReschedule(text)) {
    return {
      intent: 'reschedule_appointment',
      confidence: DEFAULT_INTENT_CONFIDENCE,
      languageCode,
      entities: baseEntities,
      safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
      needsClarification: false,
    };
  }

  if (detectDoctorAvailability(text)) {
    return {
      intent: 'ask_doctor_availability',
      confidence: DEFAULT_INTENT_CONFIDENCE,
      languageCode,
      entities: {
        ...baseEntities,
        dayName:
          baseEntities.dayName ??
          (/\b(naalaikku|naalaiku|nalaki|tomorrow)\b/i.test(text)
            ? 'naalaikku'
            : /\b(inniku|inaiku|today|indru)\b/i.test(text)
              ? 'inniku'
              : null),
      },
      safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
      needsClarification: false,
    };
  }

  if (detectFee(text) || (extractDoctorName(text) && input.currentFlow === 'fee_clarification')) {
    return {
      intent: 'ask_fee',
      confidence: DEFAULT_INTENT_CONFIDENCE,
      languageCode,
      entities: baseEntities,
      safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
      needsClarification: false,
    };
  }

  if (detectTiming(text)) {
    return {
      intent: 'ask_timing',
      confidence: DEFAULT_INTENT_CONFIDENCE,
      languageCode,
      entities: baseEntities,
      safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
      needsClarification: false,
    };
  }

  if (detectLocation(text)) {
    return {
      intent: 'ask_location',
      confidence: DEFAULT_INTENT_CONFIDENCE,
      languageCode,
      entities: baseEntities,
      safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
      needsClarification: false,
    };
  }

  if (detectBooking(text)) {
    return {
      intent: 'book_appointment',
      confidence: DEFAULT_INTENT_CONFIDENCE,
      languageCode,
      entities: baseEntities,
      safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
      needsClarification: false,
    };
  }

  if (/\bdoctor-a paakanum\b/i.test(text) || /\bpaakanum\b/i.test(text)) {
    return {
      intent: 'book_appointment',
      confidence: DEFAULT_INTENT_CONFIDENCE,
      languageCode,
      entities: baseEntities,
      safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
      needsClarification: false,
    };
  }

  if (baseEntities.reasonForVisit) {
    return {
      intent: 'book_appointment',
      confidence: DEFAULT_INTENT_CONFIDENCE,
      languageCode,
      entities: baseEntities,
      safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
      needsClarification: false,
    };
  }

  return {
    intent: 'unknown',
    confidence: LOW_INTENT_CONFIDENCE,
    languageCode,
    entities: baseEntities,
    safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
    needsClarification: true,
  };
}

/** High-confidence local intent match — skips Sarvam when result is not unknown. */
export function tryDeterministicIntentClassification(
  input: IntentClassifierInput,
): IntentClassifierResult | null {
  const result = classifyIntentMock(input);
  if (result.intent === 'unknown' || result.needsClarification) {
    return null;
  }
  return result;
}
