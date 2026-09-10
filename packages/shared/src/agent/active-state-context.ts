import { BOOKING_FLOW } from '../booking/states';
import { CANCEL_FLOW, HANDOFF_FLOW, RESCHEDULE_FLOW } from '../lifecycle/flows';

import { parseActivePrompt } from './conversation-policy';

export const TERMINAL_ACK_FLOW = 'terminal_ack';

const ACTIVE_FLOWS = new Set([
  BOOKING_FLOW,
  CANCEL_FLOW,
  RESCHEDULE_FLOW,
  HANDOFF_FLOW,
  TERMINAL_ACK_FLOW,
  'fee_clarification',
  'faq_clarification',
]);

const TERMINAL_STATES = new Set(['IDLE', 'DONE']);

const INTERPRETER_STATES = new Set([
  'BOOKING_STARTED',
  'SELECT_DOCTOR',
  'ASK_PROBLEM_OR_DOCTOR',
  'ASK_REASON',
  'ASK_DATE',
  'ASK_TIME',
  'PROPOSE_SLOTS',
  'ASK_ALTERNATE_TIME',
  'ASK_PATIENT_NAME',
  'ASK_PATIENT_IDENTITY',
  'CONFIRM_DOCTOR',
  'CONFIRM_DETAILS',
  'SELECT_APPOINTMENT_IF_MULTIPLE',
  'CONFIRM_CANCEL_REQUEST',
  'ASK_NEW_DATE',
  'ASK_NEW_TIME',
  'PROPOSE_NEW_SLOTS',
  'CONFIRM_RESCHEDULE_REQUEST',
  'ASK_REASON_OPTIONAL',
  'ASK_NAME_IF_NEEDED',
  'ASK_PHONE_IF_NEEDED',
  'booking_complete',
  'offer_help',
  'unsupported_service',
]);

export function resolveInterpreterContext(input: {
  currentFlow: string;
  currentState: string;
  collected?: Record<string, unknown>;
}): { flow: string; state: string } {
  const activePrompt = parseActivePrompt(input.collected ?? {});
  if (
    activePrompt &&
    (input.currentFlow === 'none' || input.currentFlow === BOOKING_FLOW) &&
    (input.currentState === 'IDLE' || input.currentState === activePrompt.state)
  ) {
    return {
      flow: activePrompt.flow ?? BOOKING_FLOW,
      state: activePrompt.state,
    };
  }

  const awaitingTerminalAck = input.collected?.awaiting_terminal_ack;
  if (typeof awaitingTerminalAck === 'string' && awaitingTerminalAck.length > 0) {
    return {
      flow: TERMINAL_ACK_FLOW,
      state: awaitingTerminalAck,
    };
  }

  return {
    flow: input.currentFlow,
    state: input.currentState,
  };
}

export function isActiveStateInterpreterContext(
  flow: string,
  state: string,
  collected?: Record<string, unknown>,
): boolean {
  const resolved = resolveInterpreterContext({
    currentFlow: flow,
    currentState: state,
    ...(collected ? { collected } : {}),
  });
  const activePrompt = parseActivePrompt(collected ?? {});
  const promptAwareIdle =
    activePrompt !== null &&
    flow === 'none' &&
    state === 'IDLE' &&
    INTERPRETER_STATES.has(activePrompt.state);

  return (
    promptAwareIdle ||
    (ACTIVE_FLOWS.has(resolved.flow) &&
      !TERMINAL_STATES.has(resolved.state) &&
      INTERPRETER_STATES.has(resolved.state))
  );
}

const BOOKING_STATE_FIELDS: Record<string, string[]> = {
  BOOKING_STARTED: ['reason', 'doctor', 'date'],
  SELECT_DOCTOR: ['doctor', 'reason'],
  ASK_PROBLEM_OR_DOCTOR: ['reason', 'doctor', 'date'],
  ASK_REASON: ['reason'],
  ASK_DATE: ['date', 'timePreference'],
  ASK_TIME: ['timePreference', 'exactTime'],
  PROPOSE_SLOTS: ['slot_selection'],
  ASK_ALTERNATE_TIME: ['date', 'timePreference', 'exactTime'],
  ASK_PATIENT_NAME: ['patient_name'],
  ASK_PATIENT_IDENTITY: ['patient_identity_selection'],
  CONFIRM_DOCTOR: ['yes_confirmation', 'no_rejection'],
  CONFIRM_DETAILS: ['yes_confirmation', 'no_rejection'],
};

const CANCEL_STATE_FIELDS: Record<string, string[]> = {
  SELECT_APPOINTMENT_IF_MULTIPLE: ['appointment_selection'],
  CONFIRM_CANCEL_REQUEST: ['yes_confirmation', 'no_rejection'],
};

const RESCHEDULE_STATE_FIELDS: Record<string, string[]> = {
  ASK_NEW_DATE: ['date', 'timePreference'],
  ASK_NEW_TIME: ['timePreference', 'exactTime'],
  PROPOSE_NEW_SLOTS: ['slot_selection'],
  CONFIRM_RESCHEDULE_REQUEST: ['yes_confirmation', 'no_rejection'],
};

const HANDOFF_STATE_FIELDS: Record<string, string[]> = {
  ASK_REASON_OPTIONAL: ['reason'],
  ASK_NAME_IF_NEEDED: ['patient_name'],
  ASK_PHONE_IF_NEEDED: ['phone'],
};

const TERMINAL_ACK_STATE_FIELDS: Record<string, string[]> = {
  booking_complete: ['yes_confirmation'],
  greeting_ack: ['yes_confirmation'],
  offer_help: ['yes_confirmation', 'no_rejection'],
  unsupported_service: ['yes_confirmation', 'no_rejection'],
};

export function expectedFieldsForState(flow: string, state: string): string[] {
  if (flow === TERMINAL_ACK_FLOW) {
    return TERMINAL_ACK_STATE_FIELDS[state] ?? ['yes_confirmation', 'no_rejection'];
  }
  if (flow === BOOKING_FLOW) {
    return BOOKING_STATE_FIELDS[state] ?? ['date', 'timePreference', 'exactTime'];
  }
  if (flow === CANCEL_FLOW) {
    return CANCEL_STATE_FIELDS[state] ?? ['yes_confirmation', 'no_rejection'];
  }
  if (flow === RESCHEDULE_FLOW) {
    return RESCHEDULE_STATE_FIELDS[state] ?? ['date', 'timePreference', 'exactTime'];
  }
  if (flow === HANDOFF_FLOW) {
    return HANDOFF_STATE_FIELDS[state] ?? ['reason', 'patient_name', 'phone'];
  }
  return [];
}
