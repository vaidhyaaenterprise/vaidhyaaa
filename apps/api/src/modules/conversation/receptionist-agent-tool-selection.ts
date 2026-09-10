import { type ApiEnv } from '@vaidya/config';
import {
  type BookingCollected,
  hasBookingProgress,
  inferBookingState,
  type LlmToolDefinition,
} from '@vaidya/shared';

import { RECEPTIONIST_AGENT_TOOLS } from './receptionist-agent-tools';

export type ReceptionistAgentToolSelectionInput = {
  collected: Record<string, unknown>;
};

const ALWAYS_AVAILABLE = new Set([
  'get_clinic_info',
  'search_knowledge_base',
  'get_appointment_status',
  'cancel_appointment',
  'reschedule_appointment',
  'request_human_callback',
]);

/**
 * Returns tools filtered by the current booking state.
 * Prevents the LLM from calling booking tools at the wrong stage.
 */
export function getReceptionistAgentToolsForRequest(
  _provider: ApiEnv['RECEPTIONIST_AGENT_PROVIDER'],
  input: ReceptionistAgentToolSelectionInput = { collected: {} },
): LlmToolDefinition[] {
  const collected = input.collected as BookingCollected;
  const inBooking = hasBookingProgress(collected);
  const state = inBooking ? inferBookingState(collected) : null;

  return RECEPTIONIST_AGENT_TOOLS.filter((tool) => {
    const name = tool.function.name;
    if (ALWAYS_AVAILABLE.has(name)) {
      return true;
    }
    if (name === 'update_booking_state') {
      return inBooking;
    }
    if (name === 'check_slot_availability') {
      return inBooking && Boolean(collected.preferred_date);
    }
    if (name === 'create_appointment_request') {
      return state === 'CONFIRM_DOCTOR';
    }
    return false;
  });
}

/** @deprecated Use getReceptionistAgentToolsForRequest */
export const selectReceptionistAgentTools = getReceptionistAgentToolsForRequest;
