import type { MessageTemplateKey } from '../templates/index';

import { BOOKING_FLOW } from '../booking/states';
import { expectedFieldsForState } from './active-state-context';
import {
  ACTIVE_PROMPT_KEY,
  buildActivePromptSnapshot,
  parseActivePrompt,
  type ActivePromptSnapshot,
} from './conversation-policy';
import type {
  ReceptionistCompletedTaskSnapshot,
  ReceptionistTaskSnapshot,
} from './receptionist-dialog-types';

export const ACTIVE_TASK_KEY = 'active_task' as const;
export const SUSPENDED_TASK_KEY = 'suspended_task' as const;
export const LAST_COMPLETED_TASK_KEY = 'last_completed_task' as const;
export const PENDING_CLARIFICATION_KEY = 'pending_clarification' as const;
export const REPEATED_PROMPT_COUNT_KEY = 'repeated_prompt_count' as const;

const FINAL_TEMPLATE_KEYS = new Set<string>([
  'booking.created_pending',
  'booking.created_confirmed',
  'handoff.created',
  'cancel.completed',
  'cancel.not_cancelled',
  'reschedule.completed',
  'reschedule.not_changed',
  'unknown.clarify',
]);

const TEMPLATE_TO_TASK_STATE: Record<string, { flow: string; state: string }> = {
  'booking.greeting': { flow: BOOKING_FLOW, state: 'ASK_PROBLEM_OR_DOCTOR' },
  'booking.ask_problem_or_doctor': { flow: BOOKING_FLOW, state: 'ASK_PROBLEM_OR_DOCTOR' },
  'booking.ask_reason': { flow: BOOKING_FLOW, state: 'ASK_REASON' },
  'booking.ask_date': { flow: BOOKING_FLOW, state: 'ASK_DATE' },
  'booking.ask_time': { flow: BOOKING_FLOW, state: 'ASK_TIME' },
  'booking.propose_slots': { flow: BOOKING_FLOW, state: 'PROPOSE_SLOTS' },
  'booking.ask_alternate_time': { flow: BOOKING_FLOW, state: 'ASK_ALTERNATE_TIME' },
  'booking.ask_patient_name': { flow: BOOKING_FLOW, state: 'ASK_PATIENT_NAME' },
  'booking.confirm_details': { flow: BOOKING_FLOW, state: 'CONFIRM_DETAILS' },
  'booking.confirm_doctor': { flow: BOOKING_FLOW, state: 'CONFIRM_DOCTOR' },
  'cancel.confirm': { flow: 'cancel', state: 'CONFIRM_CANCEL_REQUEST' },
  'reschedule.ask_new_date': { flow: 'reschedule', state: 'ASK_NEW_DATE' },
  'reschedule.ask_new_time': { flow: 'reschedule', state: 'ASK_NEW_TIME' },
  'reschedule.propose_slots': { flow: 'reschedule', state: 'PROPOSE_NEW_SLOTS' },
  'reschedule.confirm': { flow: 'reschedule', state: 'CONFIRM_RESCHEDULE_REQUEST' },
  'handoff.ask_reason': { flow: 'handoff', state: 'ASK_REASON_OPTIONAL' },
};

const RESUME_TEMPLATE_BY_STATE: Record<string, MessageTemplateKey> = {
  ASK_PROBLEM_OR_DOCTOR: 'booking.resume.problem_or_doctor',
  ASK_REASON: 'booking.ask_reason',
  ASK_DATE: 'booking.resume.date',
  ASK_TIME: 'booking.resume.time',
  PROPOSE_SLOTS: 'booking.resume.slot_selection',
  ASK_ALTERNATE_TIME: 'booking.ask_alternate_time',
  ASK_PATIENT_NAME: 'booking.resume.name',
  CONFIRM_DETAILS: 'booking.resume.confirm',
  CONFIRM_DOCTOR: 'booking.confirm_doctor',
};

export function parseActiveTask(collected: Record<string, unknown>): ReceptionistTaskSnapshot | null {
  const raw = collected[ACTIVE_TASK_KEY];
  if (!raw || typeof raw !== 'object') {
    return activeTaskFromLegacyPrompt(collected);
  }
  const task = raw as ReceptionistTaskSnapshot;
  if (typeof task.flow !== 'string' || typeof task.state !== 'string' || typeof task.promptKey !== 'string') {
    return activeTaskFromLegacyPrompt(collected);
  }
  return task;
}

function activeTaskFromLegacyPrompt(collected: Record<string, unknown>): ReceptionistTaskSnapshot | null {
  const prompt = parseActivePrompt(collected);
  if (!prompt) {
    return null;
  }
  return taskSnapshotFromPrompt(prompt);
}

export function taskSnapshotFromPrompt(prompt: ActivePromptSnapshot): ReceptionistTaskSnapshot {
  return {
    flow: prompt.flow ?? BOOKING_FLOW,
    state: prompt.state,
    promptKey: prompt.template_key,
    expectedFields: prompt.expected_fields ?? expectedFieldsForState(prompt.flow ?? BOOKING_FLOW, prompt.state),
  };
}

export function parseSuspendedTask(collected: Record<string, unknown>): ReceptionistTaskSnapshot | null {
  const raw = collected[SUSPENDED_TASK_KEY];
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const task = raw as ReceptionistTaskSnapshot;
  if (typeof task.flow !== 'string' || typeof task.state !== 'string') {
    return null;
  }
  return task;
}

export function parseLastCompletedTask(
  collected: Record<string, unknown>,
): ReceptionistCompletedTaskSnapshot | null {
  const raw = collected[LAST_COMPLETED_TASK_KEY];
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const task = raw as ReceptionistCompletedTaskSnapshot;
  if (typeof task.flow !== 'string' || typeof task.finalTemplateKey !== 'string') {
    return null;
  }
  return task;
}

export function attachActiveTask(
  collected: Record<string, unknown>,
  task: ReceptionistTaskSnapshot | null,
): Record<string, unknown> {
  if (!task) {
    const next = { ...collected };
    delete next[ACTIVE_TASK_KEY];
    return next;
  }
  return {
    ...collected,
    [ACTIVE_TASK_KEY]: task,
    [ACTIVE_PROMPT_KEY]: buildActivePromptSnapshot(task.state, task.promptKey, {
      flow: task.flow,
      expectedFields: task.expectedFields,
    }),
  };
}

export function markTaskCompleted(
  collected: Record<string, unknown>,
  input: {
    flow: string;
    finalTemplateKey: string;
    summary?: Record<string, unknown>;
  },
): Record<string, unknown> {
  const next = { ...collected };
  delete next[ACTIVE_TASK_KEY];
  delete next[SUSPENDED_TASK_KEY];
  delete next[PENDING_CLARIFICATION_KEY];
  next[REPEATED_PROMPT_COUNT_KEY] = 0;
  next[LAST_COMPLETED_TASK_KEY] = {
    flow: input.flow,
    finalTemplateKey: input.finalTemplateKey,
    completedAt: new Date().toISOString(),
    ...(input.summary ? { summary: input.summary } : {}),
  };
  return next;
}

/** Templates that answer a turn but must not overwrite the in-progress booking/cancel task prompt. */
export function shouldPreserveActiveTaskOnTemplate(templateKey: string): boolean {
  if (templateKey.startsWith('clarify.')) {
    return true;
  }
  if (templateKey.startsWith('ack.')) {
    return true;
  }
  if (templateKey === 'unknown.help_options' || templateKey === 'llm.callback_fallback') {
    return true;
  }
  if (templateKey === 'knowledge.answer') {
    return true;
  }
  if (templateKey.startsWith('safety.') || templateKey.startsWith('scope.')) {
    return true;
  }
  return false;
}

export function buildActiveTaskForTemplate(
  templateKey: string,
  flow: string,
  state: string,
): ReceptionistTaskSnapshot | null {
  if (shouldPreserveActiveTaskOnTemplate(templateKey)) {
    return null;
  }
  const mapped = TEMPLATE_TO_TASK_STATE[templateKey];
  if (mapped) {
    return {
      flow: mapped.flow,
      state: mapped.state,
      promptKey: templateKey,
      expectedFields: expectedFieldsForState(mapped.flow, mapped.state),
    };
  }
  if (flow !== 'none' && state !== 'IDLE' && state !== 'DONE') {
    return {
      flow,
      state,
      promptKey: templateKey,
      expectedFields: expectedFieldsForState(flow, state),
    };
  }
  return null;
}

export function isFinalAssistantTemplate(templateKey: string | null | undefined): boolean {
  return typeof templateKey === 'string' && FINAL_TEMPLATE_KEYS.has(templateKey);
}

export function resolveResumePromptTemplateKey(
  task: ReceptionistTaskSnapshot | null | undefined,
): MessageTemplateKey | null {
  if (!task) {
    return null;
  }
  return RESUME_TEMPLATE_BY_STATE[task.state] ?? null;
}

export function readRepeatedPromptCount(collected: Record<string, unknown>): number {
  const value = collected[REPEATED_PROMPT_COUNT_KEY];
  return typeof value === 'number' && value >= 0 ? value : 0;
}

export function incrementRepeatedPromptCount(collected: Record<string, unknown>): Record<string, unknown> {
  return {
    ...collected,
    [REPEATED_PROMPT_COUNT_KEY]: readRepeatedPromptCount(collected) + 1,
  };
}

export function shouldOfferRepeatedPromptEscalation(collected: Record<string, unknown>): boolean {
  return readRepeatedPromptCount(collected) >= 2;
}
