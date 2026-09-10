import type { MessageTemplateKey } from '../templates/index';

import { BOOKING_FLOW } from '../booking/states';

export const ACTIVE_PROMPT_KEY = 'active_prompt' as const;
export const BOOKING_INTERRUPT_KEY = 'booking_interrupt' as const;

export type ActivePromptSnapshot = {
  flow?: string;
  state: string;
  template_key: MessageTemplateKey | string;
  expected_fields?: string[];
};

export type BookingInterruptSnapshot = {
  state: string;
  collected: Record<string, unknown>;
};

export const BOOKING_RESUME_TEMPLATE_BY_STATE: Record<string, MessageTemplateKey> = {
  ASK_PROBLEM_OR_DOCTOR: 'booking.ask_problem_or_doctor',
  ASK_REASON: 'booking.ask_reason',
  ASK_DATE: 'booking.ask_date',
  ASK_TIME: 'booking.ask_time',
  PROPOSE_SLOTS: 'booking.propose_slots',
  ASK_ALTERNATE_TIME: 'booking.ask_alternate_time',
  ASK_PATIENT_NAME: 'booking.ask_patient_name',
  ASK_PHONE_IF_NEEDED: 'booking.ask_phone',
  ASK_PATIENT_IDENTITY: 'booking.ask_patient_name',
  CONFIRM_DETAILS: 'booking.confirm_details',
  CONFIRM_DOCTOR: 'booking.confirm_doctor',
  ASK_SERVICE_CLARIFICATION: 'booking.ask_service_clarification',
};

export type ActiveFlowInterruptKind = 'handoff' | 'cancel' | 'emergency' | 'side_question';

export function buildActivePromptSnapshot(
  state: string,
  templateKey: MessageTemplateKey | string,
  options?: { flow?: string; expectedFields?: string[] },
): ActivePromptSnapshot {
  return {
    flow: options?.flow ?? BOOKING_FLOW,
    state,
    template_key: templateKey,
    ...(options?.expectedFields ? { expected_fields: options.expectedFields } : {}),
  };
}

export function parseActivePrompt(collectedJson: Record<string, unknown>): ActivePromptSnapshot | null {
  const raw = collectedJson[ACTIVE_PROMPT_KEY];
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const snapshot = raw as ActivePromptSnapshot;
  if (typeof snapshot.state !== 'string' || typeof snapshot.template_key !== 'string') {
    return null;
  }

  return snapshot;
}

export function attachActivePrompt(
  collectedJson: Record<string, unknown>,
  snapshot: ActivePromptSnapshot | null,
): Record<string, unknown> {
  if (!snapshot) {
    return collectedJson;
  }

  return {
    ...collectedJson,
    [ACTIVE_PROMPT_KEY]: snapshot,
  };
}

export function resolveResumeBookingState(
  collectedJson: Record<string, unknown>,
  sessionState: string,
): string {
  return parseActivePrompt(collectedJson)?.state ?? sessionState;
}

export function resolveResumeTemplateKey(state: string): MessageTemplateKey | null {
  return BOOKING_RESUME_TEMPLATE_BY_STATE[state] ?? null;
}

export function shouldReleaseSlotHoldOnInterrupt(kind: ActiveFlowInterruptKind): boolean {
  return kind === 'handoff' || kind === 'cancel' || kind === 'emergency';
}

export function preservesCollectedFieldsDuringSideQuestion(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: string[],
): boolean {
  return keys.every((key) => {
    if (before[key] === undefined) {
      return true;
    }
    return JSON.stringify(before[key]) === JSON.stringify(after[key]);
  });
}

export const RESCHEDULE_RESUME_TEMPLATE_BY_STATE: Record<string, MessageTemplateKey> = {
  ASK_NEW_DATE: 'reschedule.ask_new_date',
  ASK_NEW_TIME: 'reschedule.ask_new_time',
  PROPOSE_NEW_SLOTS: 'reschedule.propose_slots',
  CONFIRM_RESCHEDULE_REQUEST: 'reschedule.confirm',
};

export function resolveResumeTemplateKeyForFlow(
  flow: string,
  state: string,
): MessageTemplateKey | null {
  if (flow === 'booking') {
    return BOOKING_RESUME_TEMPLATE_BY_STATE[state] ?? null;
  }
  if (flow === 'reschedule') {
    return RESCHEDULE_RESUME_TEMPLATE_BY_STATE[state] ?? null;
  }
  return null;
}

export function normalizeAppointmentRoutingSource(source: string | undefined | null): string | null {
  if (!source) {
    return null;
  }
  if (source === 'service_router_cache') {
    return 'service_router';
  }
  return source;
}
