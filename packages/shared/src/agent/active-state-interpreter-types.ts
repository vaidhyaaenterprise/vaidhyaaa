import type {
  StateEntityExtractorInput,
  StateEntityExtractorResult,
} from './state-entity-types';

export type ActiveStateInterpreterInput = {
  clinicId: string;
  sessionId: string;
  currentFlow: 'booking' | 'cancel' | 'reschedule' | 'handoff';
  currentState: string;
  languageCode: string;
  messageText: string;
  timezone: string;
  referenceDateIso: string;
  collected: Record<string, unknown>;
  expectedFields: string[];
  offeredSlots?: Array<{
    slotId: string;
    startTime: string;
    endTime: string;
    displayTime: string;
  }>;
};

export type ActiveStateInterpreterResult = {
  recognizedAs:
    | 'date_answer'
    | 'time_answer'
    | 'slot_selection'
    | 'patient_name'
    | 'phone_number'
    | 'yes_confirmation'
    | 'no_rejection'
    | 'flow_cancel'
    | 'side_question'
    | 'handoff_reason'
    | 'unknown';
  confidence: number;
  entities: {
    date?: string | null;
    timePreference?: 'morning' | 'afternoon' | 'evening' | null;
    exactTime?: string | null;
    selectedSlotId?: string | null;
    patientName?: string | null;
    phoneNumber?: string | null;
    sideQuestionIntent?: string | null;
    sideQuestionTopic?: string | null;
    handoffReason?: string | null;
  };
  needsClarification: boolean;
  clarificationReason?: string | null;
};

export interface ActiveStateInterpreter {
  interpret(input: ActiveStateInterpreterInput): Promise<ActiveStateInterpreterResult>;
}

export function toStateEntityExtractorInput(
  input: ActiveStateInterpreterInput,
): StateEntityExtractorInput {
  return {
    clinicId: input.clinicId,
    sessionId: input.sessionId,
    currentFlow: input.currentFlow,
    currentState: input.currentState,
    languageCode: input.languageCode,
    messageText: input.messageText,
    timezone: input.timezone,
    referenceDate: input.referenceDateIso,
    collected: input.collected,
    expectedFields: input.expectedFields,
    ...(input.offeredSlots ? { offeredSlots: input.offeredSlots } : {}),
  };
}

export function fromStateEntityExtractorResult(
  result: StateEntityExtractorResult,
): ActiveStateInterpreterResult {
  return {
    recognizedAs: result.recognizedAs as ActiveStateInterpreterResult['recognizedAs'],
    confidence: result.confidence,
    entities: {
      date: result.entities.date ?? null,
      timePreference: result.entities.timePreference ?? null,
      exactTime: result.entities.exactTime ?? null,
      selectedSlotId: result.entities.selectedSlotId ?? null,
      patientName: result.entities.patientName ?? null,
      phoneNumber: null,
      sideQuestionIntent: result.entities.sideQuestionIntent ?? null,
      sideQuestionTopic: result.entities.sideQuestionTopic ?? null,
      handoffReason: null,
    },
    needsClarification: result.needsClarification,
    clarificationReason: result.clarificationReason ?? null,
  };
}
