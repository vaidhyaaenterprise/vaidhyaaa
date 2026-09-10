export type ActiveFlow =
  | 'booking'
  | 'cancel'
  | 'reschedule'
  | 'handoff'
  | 'fee_clarification'
  | 'faq_clarification';

export type StateRecognizedAs =
  | 'date_answer'
  | 'time_answer'
  | 'doctor_answer'
  | 'service_answer'
  | 'slot_selection'
  | 'patient_name'
  | 'patient_identity_selection'
  | 'yes_confirmation'
  | 'no_rejection'
  | 'flow_cancel'
  | 'side_question'
  | 'scope_redirect'
  | 'handoff_reason'
  | 'unknown';

export type SideQuestionIntent =
  | 'ask_fee'
  | 'ask_timing'
  | 'ask_location'
  | 'ask_doctor_availability'
  | 'ask_previsit_instruction'
  | 'ask_insurance'
  | 'ask_human_agent';

export type StateEntityExtractorInput = {
  clinicId: string;
  sessionId: string;
  currentFlow: ActiveFlow | string;
  currentState: string;
  languageCode: string;
  messageText: string;
  timezone: string;
  referenceDate: string;
  collected: Record<string, unknown>;
  expectedFields: string[];
  llmRuntime?: import('./llm-latency').LlmRuntimeSettings;
  offeredSlots?: Array<{
    slotId: string;
    startTime: string;
    endTime: string;
    displayTime: string;
    availableCount?: number;
  }>;
  activeDoctors?: Array<{
    doctorId: string;
    doctorName: string;
  }>;
  activeServices?: Array<{
    clinicServiceId: string;
    serviceName: string;
  }>;
  lastAssistantMessageText?: string | null;
  lastAssistantTemplateKey?: string | null;
  recentTurns?: Array<{
    role: 'patient' | 'assistant';
    text: string;
    templateKey?: string | null;
  }>;
};

export type StateEntityExtractorEntities = {
  date?: string | null;
  timePreference?: 'morning' | 'afternoon' | 'evening' | null;
  exactTime?: string | null;
  selectedSlotId?: string | null;
  doctorId?: string | null;
  doctorName?: string | null;
  clinicServiceId?: string | null;
  reasonForVisit?: string | null;
  patientName?: string | null;
  patientIdentityLabel?: string | null;
  sideQuestionIntent?: SideQuestionIntent | null;
  sideQuestionTopic?: string | null;
  dayName?: string | null;
};

export type StateEntityExtractorResult = {
  recognizedAs: StateRecognizedAs;
  confidence: number;
  entities: StateEntityExtractorEntities;
  needsClarification: boolean;
  clarificationReason?: string | null;
  llmDebug?: import('./llm-debug').LlmInvocationDebug;
};

export type MessageSafetyResult = {
  isEmergency: boolean;
  isMedicalAdviceRequest: boolean;
  reason?: string | null;
};
