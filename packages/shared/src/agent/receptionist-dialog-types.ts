import { z } from 'zod';

export const RECEPTIONIST_TURN_TYPES = [
  'continue_current_task',
  'answer_question',
  'answer_question_and_resume',
  'ask_clarification',
  'ask_clarification_and_keep_task',
  'switch_task',
  'start_new_task',
  'pause_current_task',
  'cancel_current_task',
  'complete_acknowledgement',
  'out_of_scope_redirect',
  'medical_advice_refusal',
  'emergency_response',
  'handoff_to_staff',
  'unknown_safe_fallback',
] as const;

export const RECEPTIONIST_USER_MOVES = [
  'answer_to_previous_question',
  'new_request',
  'side_question',
  'vague_information_request',
  'correction',
  'confirmation',
  'rejection',
  'thanks_or_closing',
  'smalltalk',
  'complaint',
  'human_request',
  'medical_question',
  'emergency_symptom',
  'out_of_scope',
  'unknown',
] as const;

export const RECEPTIONIST_DIALOG_CAPABILITIES = [
  'book_appointment',
  'cancel_appointment',
  'reschedule_appointment',
  'ask_fee',
  'ask_timing',
  'ask_location',
  'ask_doctor_availability',
  'ask_previsit_instruction',
  'ask_insurance',
  'ask_report_status',
  'ask_human_agent',
  'language_switch',
  'greeting_smalltalk',
  'thanks_acknowledgement',
  'medical_advice_request',
  'emergency',
  'unsupported_service',
  'out_of_scope',
  'unknown',
] as const;

export const RECEPTIONIST_ANSWER_HANDLERS = [
  'FeeHandler',
  'TimingHandler',
  'LocationHandler',
  'DoctorAvailabilityHandler',
  'KnowledgeRuntimeHandler',
  'MedicalAdviceHandler',
  'EmergencyHandler',
  'HandoffMachine',
  'BookingMachine',
  'CancelMachine',
  'RescheduleMachine',
  'UnknownHandler',
  'ScopeHandler',
  'AckHandler',
] as const;

export const RECEPTIONIST_RESPONSE_COMPOSITIONS = [
  'single_reply',
  'answer_then_resume_prompt',
  'clarify_then_wait',
  'ack_then_offer_help',
  'safety_reply_only',
] as const;

export const RECEPTIONIST_SOURCE_OF_TRUTH = [
  'structured_db',
  'approved_knowledge',
  'fixed_template',
  'state_machine',
  'callback',
  'none',
] as const;

export type ReceptionistTurnType = (typeof RECEPTIONIST_TURN_TYPES)[number];
export type ReceptionistUserMove = (typeof RECEPTIONIST_USER_MOVES)[number];
export type ReceptionistDialogCapability = (typeof RECEPTIONIST_DIALOG_CAPABILITIES)[number];
export type ReceptionistAnswerHandler = (typeof RECEPTIONIST_ANSWER_HANDLERS)[number];
export type ReceptionistResponseComposition = (typeof RECEPTIONIST_RESPONSE_COMPOSITIONS)[number];

export type ReceptionistTaskSnapshot = {
  flow: string;
  state: string;
  promptKey: string;
  expectedFields: string[];
  collectedSnapshot?: Record<string, unknown>;
};

export type ReceptionistCompletedTaskSnapshot = {
  flow: string;
  finalTemplateKey: string;
  completedAt: string;
  summary?: Record<string, unknown>;
};

export type ReceptionistConversationTurn = {
  role: 'patient' | 'assistant';
  text: string;
  templateKey?: string | null;
};

export type ReceptionistDialogInput = {
  clinicId: string;
  sessionId: string;
  messageText: string;
  languageCode: string;
  currentFlow: string;
  currentState: string;
  lastAssistantMessageText?: string | null;
  lastAssistantTemplateKey?: string | null;
  recentTurns?: ReceptionistConversationTurn[];
  collected: Record<string, unknown>;
  activeTask?: ReceptionistTaskSnapshot | null;
  suspendedTask?: ReceptionistTaskSnapshot | null;
  lastCompletedTask?: ReceptionistCompletedTaskSnapshot | null;
  clinicCapabilities: Array<{
    capabilityKey: string;
    sourceOfTruth:
      | 'state_machine'
      | 'structured_db'
      | 'approved_knowledge'
      | 'fixed_template'
      | 'callback'
      | 'unsupported';
    allowedDuringActiveTask: boolean;
    resumeActiveTaskAfterAnswer: boolean;
    endsActiveTask: boolean;
  }>;
  clinicContextSummary: {
    clinicName: string;
    defaultLanguageCode: string;
    enabledLanguages: string[];
    activeServices: Array<{
      serviceId: string;
      serviceName: string;
      handlesJson: unknown;
      doesNotHandleJson: unknown;
      redFlagsJson: unknown;
    }>;
  };
};

export type ReceptionistDialogPlan = {
  turnType: ReceptionistTurnType;
  userMove: ReceptionistUserMove;
  capability: ReceptionistDialogCapability;
  confidence: number;
  extractedEntities: {
    reasonForVisit?: string | null;
    doctorName?: string | null;
    patientName?: string | null;
    date?: string | null;
    timePreference?: string | null;
    exactTime?: string | null;
    selectedSlotId?: string | null;
    topic?: string | null;
    requestedDetailType?: string | null;
    correctionField?: string | null;
    correctionValue?: string | null;
    requestedLanguageCode?: string | null;
  };
  answerPlan?: {
    sourceOfTruth: (typeof RECEPTIONIST_SOURCE_OF_TRUTH)[number];
    handler: ReceptionistAnswerHandler;
    mustNotUseKnowledge?: boolean;
    mustNotUseLLMFreeText?: boolean;
  } | null;
  taskPlan: {
    shouldResumeActiveTask: boolean;
    shouldSuspendActiveTask: boolean;
    shouldEndActiveTask: boolean;
    shouldReleaseActiveHold: boolean;
    nextFlow?: string | null;
    nextState?: string | null;
    resumePromptKey?: string | null;
  };
  responseComposition: ReceptionistResponseComposition;
  clarificationReason?: string | null;
};

const extractedEntitiesSchema = z.object({
  reasonForVisit: z.string().nullable().optional(),
  doctorName: z.string().nullable().optional(),
  patientName: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  timePreference: z.string().nullable().optional(),
  exactTime: z.string().nullable().optional(),
  selectedSlotId: z.string().nullable().optional(),
  topic: z.string().nullable().optional(),
  requestedDetailType: z.string().nullable().optional(),
  correctionField: z.string().nullable().optional(),
  correctionValue: z.string().nullable().optional(),
  requestedLanguageCode: z.string().nullable().optional(),
});

export const receptionistDialogPlanSchema = z.object({
  turnType: z.enum(RECEPTIONIST_TURN_TYPES),
  userMove: z.enum(RECEPTIONIST_USER_MOVES),
  capability: z.enum(RECEPTIONIST_DIALOG_CAPABILITIES),
  confidence: z.number().min(0).max(1),
  extractedEntities: extractedEntitiesSchema.default({}),
  answerPlan: z
    .object({
      sourceOfTruth: z.enum(RECEPTIONIST_SOURCE_OF_TRUTH),
      handler: z.enum(RECEPTIONIST_ANSWER_HANDLERS),
      mustNotUseKnowledge: z.boolean().optional(),
      mustNotUseLLMFreeText: z.boolean().optional(),
    })
    .nullable()
    .optional(),
  taskPlan: z.object({
    shouldResumeActiveTask: z.boolean(),
    shouldSuspendActiveTask: z.boolean(),
    shouldEndActiveTask: z.boolean(),
    shouldReleaseActiveHold: z.boolean(),
    nextFlow: z.string().nullable().optional(),
    nextState: z.string().nullable().optional(),
    resumePromptKey: z.string().nullable().optional(),
  }),
  responseComposition: z.enum(RECEPTIONIST_RESPONSE_COMPOSITIONS),
  clarificationReason: z.string().nullable().optional(),
});

export function parseReceptionistDialogPlan(raw: unknown): ReceptionistDialogPlan | null {
  const parsed = receptionistDialogPlanSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const data = parsed.data;
  const entities = data.extractedEntities;
  return {
    turnType: data.turnType,
    userMove: data.userMove,
    capability: data.capability,
    confidence: data.confidence,
    extractedEntities: {
      reasonForVisit: entities.reasonForVisit ?? null,
      doctorName: entities.doctorName ?? null,
      patientName: entities.patientName ?? null,
      date: entities.date ?? null,
      timePreference: entities.timePreference ?? null,
      exactTime: entities.exactTime ?? null,
      selectedSlotId: entities.selectedSlotId ?? null,
      topic: entities.topic ?? null,
      requestedDetailType: entities.requestedDetailType ?? null,
      correctionField: entities.correctionField ?? null,
      correctionValue: entities.correctionValue ?? null,
      requestedLanguageCode: entities.requestedLanguageCode ?? null,
    },
    answerPlan: data.answerPlan
      ? {
          sourceOfTruth: data.answerPlan.sourceOfTruth,
          handler: data.answerPlan.handler,
          ...(data.answerPlan.mustNotUseKnowledge !== undefined
            ? { mustNotUseKnowledge: data.answerPlan.mustNotUseKnowledge }
            : {}),
          ...(data.answerPlan.mustNotUseLLMFreeText !== undefined
            ? { mustNotUseLLMFreeText: data.answerPlan.mustNotUseLLMFreeText }
            : {}),
        }
      : null,
    taskPlan: {
      shouldResumeActiveTask: data.taskPlan.shouldResumeActiveTask,
      shouldSuspendActiveTask: data.taskPlan.shouldSuspendActiveTask,
      shouldEndActiveTask: data.taskPlan.shouldEndActiveTask,
      shouldReleaseActiveHold: data.taskPlan.shouldReleaseActiveHold,
      ...(data.taskPlan.nextFlow !== undefined ? { nextFlow: data.taskPlan.nextFlow } : {}),
      ...(data.taskPlan.nextState !== undefined ? { nextState: data.taskPlan.nextState } : {}),
      ...(data.taskPlan.resumePromptKey !== undefined
        ? { resumePromptKey: data.taskPlan.resumePromptKey }
        : {}),
    },
    responseComposition: data.responseComposition,
    clarificationReason: data.clarificationReason ?? null,
  };
}

export function unknownSafeFallbackPlan(languageCode: string): ReceptionistDialogPlan {
  return {
    turnType: 'unknown_safe_fallback',
    userMove: 'unknown',
    capability: 'unknown',
    confidence: 0.3,
    extractedEntities: {},
    answerPlan: {
      sourceOfTruth: 'fixed_template',
      handler: 'UnknownHandler',
      mustNotUseKnowledge: false,
      mustNotUseLLMFreeText: true,
    },
    taskPlan: {
      shouldResumeActiveTask: false,
      shouldSuspendActiveTask: false,
      shouldEndActiveTask: false,
      shouldReleaseActiveHold: false,
    },
    responseComposition: 'clarify_then_wait',
    clarificationReason: `unknown_utterance_${languageCode}`,
  };
}
