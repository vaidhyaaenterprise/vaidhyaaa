import { expectedFieldsForState } from './active-state-context';
import { parseActiveTask } from './receptionist-task-context';
import type { ReceptionistDialogInput } from './receptionist-dialog-types';

const COLLECTED_KEYS_FOR_DIALOG = [
  'reason_for_visit',
  'doctor_id',
  'doctor_name',
  'preferred_date',
  'time_preference',
  'clinic_service_id',
  'patient_name',
  'hold_id',
  'proposed_slots',
] as const;

export function buildReceptionistDialogUserPayload(
  input: ReceptionistDialogInput,
): Record<string, unknown> {
  const collected: Record<string, unknown> = {};
  for (const key of COLLECTED_KEYS_FOR_DIALOG) {
    const value = input.collected[key];
    if (value !== undefined && value !== null && value !== '') {
      collected[key] = value;
    }
  }

  const activeTask =
    input.activeTask ??
    (() => {
      const parsed = parseActiveTask(input.collected);
      if (!parsed) {
        return null;
      }
      return {
        flow: parsed.flow,
        state: parsed.state,
        promptKey: parsed.promptKey,
        expectedFields:
          parsed.expectedFields?.length > 0
            ? parsed.expectedFields
            : expectedFieldsForState(parsed.flow, parsed.state),
      };
    })();

  const proposedSlots = input.collected.proposed_slots;
  const offeredSlots = Array.isArray(proposedSlots)
    ? proposedSlots.map((slot) => {
        if (!slot || typeof slot !== 'object') {
          return null;
        }
        const record = slot as Record<string, unknown>;
        return {
          id: record.slot_id ?? record.slotId ?? null,
          time: record.display_time ?? record.displayTime ?? record.start_time ?? null,
        };
      }).filter(Boolean)
    : [];

  const recentTurns = (input.recentTurns ?? []).map((turn) => ({
    role: turn.role,
    text: turn.text,
    ...(turn.templateKey ? { templateKey: turn.templateKey } : {}),
  }));

  return {
    messageText: input.messageText,
    languageCode: input.languageCode,
    currentFlow: input.currentFlow,
    currentState: input.currentState,
    lastAssistantMessageText: input.lastAssistantMessageText ?? null,
    lastAssistantTemplateKey: input.lastAssistantTemplateKey ?? null,
    ...(recentTurns.length > 0 ? { recentTurns } : {}),
    ...(activeTask ? { activeTask } : {}),
    ...(input.suspendedTask ? { suspendedTask: input.suspendedTask } : {}),
    ...(input.lastCompletedTask ? { lastCompletedTask: input.lastCompletedTask } : {}),
    ...(Object.keys(collected).length > 0 ? { collected } : {}),
    ...(offeredSlots.length > 0 ? { offeredSlots } : {}),
    clinicName: input.clinicContextSummary.clinicName,
  };
}
