import { vi } from 'vitest';

import type { LlmChatMessage, LlmChatRequest } from '@vaidya/shared';

import type { ReceptionistAgentLlmPort } from '../../src/modules/conversation/receptionist-agent.types';

type ScenarioOptions = {
  fridayDate: string;
};

function parseTurnPayload(messages: LlmChatMessage[]): Record<string, unknown> | null {
  const userMessages = messages.filter((message) => message.role === 'user');
  const latest = userMessages[userMessages.length - 1];
  if (!latest?.content || typeof latest.content !== 'string') {
    return null;
  }
  try {
    return JSON.parse(latest.content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function assistantToolRounds(messages: LlmChatMessage[]): number {
  return messages.filter(
    (message) => message.role === 'assistant' && (message.tool_calls?.length ?? 0) > 0,
  ).length;
}

function extractToolResult(messages: LlmChatMessage[], toolName: string): Record<string, unknown> | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'tool' || message.name !== toolName) {
      continue;
    }
    if (typeof message.content !== 'string') {
      continue;
    }
    try {
      return JSON.parse(message.content) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function collectedFromPayload(payload: Record<string, unknown> | null): Record<string, unknown> {
  const collected = payload?.collected;
  return collected && typeof collected === 'object' && !Array.isArray(collected)
    ? (collected as Record<string, unknown>)
    : {};
}

function toolCall(
  id: string,
  name: string,
  args: Record<string, unknown>,
): NonNullable<import('@vaidya/shared').LlmChatResponse['toolCalls']>[number] {
  return {
    id,
    type: 'function' as const,
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

function isTimingQuestion(text: string): boolean {
  return (
    /what time do you open/i.test(text) ||
    /when r u open/i.test(text) ||
    /clinic timing enna/i.test(text) ||
    /till what time doctor available/i.test(text) ||
    /morning open aa\?/i.test(text) ||
    /\b(open|timing|hours|close)\b/i.test(text)
  );
}

function isMedicalAdvice(text: string): boolean {
  return /paracetamol|should i take|dosage|fever.*tablet|medicine for/i.test(text);
}

function isOffTopic(text: string): boolean {
  return /cricket score/i.test(text);
}

function isKnowledgeQuestion(text: string): boolean {
  return /fast before the mri|mri.*fast|fasting.*mri/i.test(text);
}

function isFeeQuestion(text: string): boolean {
  return /how much|consultation fee|fees evlo|fee\b/i.test(text);
}

function isVague(text: string): boolean {
  return /^(hmm|um+|ok(ay)?|so|yeah|seri|sari)([\s.,!]+(ok|so|yeah))?[\s.,!]*$/i.test(text.trim()) ||
    /^hmm\s+ok\s+so[\s.,!]*$/i.test(text.trim());
}

function isBookingStart(text: string): boolean {
  return /book.*knee pain|knee pain checkup/i.test(text);
}

function isRichBookingDetails(text: string): boolean {
  return /\bpriya\b/i.test(text) && /\b98\d{8}\b/.test(text.replace(/\D/g, '')) && /friday/i.test(text);
}

function extractPhone(text: string): string | null {
  const digits = text.replace(/\D/g, '');
  const match = digits.match(/98\d{8}/);
  return match?.[0] ?? null;
}

function firstSlotLabel(slots: Array<Record<string, unknown>>): string {
  const time = String(slots[0]?.time ?? '10:00');
  return time;
}

export function createScenarioAgentLlmMock(options: ScenarioOptions): ReceptionistAgentLlmPort['chat'] {
  const patientTurns = new Set<string>();

  return vi.fn<ReceptionistAgentLlmPort['chat']>(async (request: LlmChatRequest) => {
    const payload = parseTurnPayload(request.messages);
    const patientMessage = String(payload?.patient_message ?? '');
    const collected = collectedFromPayload(payload);
    const toolRounds = assistantToolRounds(request.messages);

    if (patientMessage && !patientTurns.has(patientMessage)) {
      patientTurns.add(patientMessage);
    }

    if (isMedicalAdvice(patientMessage)) {
      return {
        model: 'scenario-agent',
        content:
          'I cannot give medical advice on medicines. I can book you with a doctor for fever — shall I check available slots?',
        finishReason: 'stop',
      };
    }

    if (isOffTopic(patientMessage)) {
      return {
        model: 'scenario-agent',
        content:
          'I can help with appointments and clinic info here — would you like to book a visit or ask about timings?',
        finishReason: 'stop',
      };
    }

    if (isKnowledgeQuestion(patientMessage)) {
      if (toolRounds === 0) {
        return {
          model: 'scenario-agent',
          content: '',
          toolCalls: [
            toolCall('call_kb_mri', 'search_knowledge_base', {
              query: 'MRI fasting preparation',
            }),
          ],
          finishReason: 'tool_calls',
        };
      }
      const kb = extractToolResult(request.messages, 'search_knowledge_base');
      const answer = kb?.found
        ? String(kb.answer)
        : 'MRI brain scans usually do not need fasting. Abdomen MRI may need 4-6 hours fasting.';
      return {
        model: 'scenario-agent',
        content: `Good question — ${answer.replace(/\.$/, '')}. Anything else I can help with?`,
        finishReason: 'stop',
      };
    }

    if (isTimingQuestion(patientMessage)) {
      if (toolRounds === 0) {
        return {
          model: 'scenario-agent',
          content: '',
          toolCalls: [toolCall('call_timing', 'get_clinic_info', { topic: 'timing' })],
          finishReason: 'tool_calls',
        };
      }
      const timing = extractToolResult(request.messages, 'get_clinic_info');
      const hours = String(timing?.hoursSummary ?? timing?.hours ?? '09:00-13:00, 17:00-21:00');
      return {
        model: 'scenario-agent',
        content: `We are open ${hours}. Would you like to book an appointment?`,
        finishReason: 'stop',
      };
    }

    if (isFeeQuestion(patientMessage) && (collected.proposed_slots as unknown[] | undefined)?.length) {
      if (toolRounds === 0) {
        return {
          model: 'scenario-agent',
          content: '',
          toolCalls: [
            toolCall('call_fee_mid_booking', 'get_clinic_info', {
              topic: 'fee',
              doctorName: String(collected.doctor_name ?? 'Kumar'),
            }),
          ],
          finishReason: 'tool_calls',
        };
      }
      const fee = extractToolResult(request.messages, 'get_clinic_info');
      const amount = String(fee?.consultationFee ?? '₹1000');
      const slots = (collected.proposed_slots as Array<Record<string, unknown>>) ?? [];
      const slotTime = firstSlotLabel(slots);
      return {
        model: 'scenario-agent',
        content: `Consultation is ${amount}. Want me to book the ${slotTime} slot for you?`,
        finishReason: 'stop',
      };
    }

    if (isVague(patientMessage)) {
      const clarifyCount = Number(collected.agent_clarify_count ?? 0);
      if (clarifyCount >= 2) {
        return {
          model: 'scenario-agent',
          content: '',
          toolCalls: [
            toolCall('call_callback', 'request_human_callback', {
              reason: 'patient_input_unclear',
            }),
          ],
          finishReason: 'tool_calls',
        };
      }
      if (clarifyCount === 0) {
        return {
          model: 'scenario-agent',
          content: 'Sure — are you looking to book an appointment or check clinic timings?',
          finishReason: 'stop',
        };
      }
      return {
        model: 'scenario-agent',
        content: 'No worries — would you like help booking a visit, or should I connect you with staff?',
        finishReason: 'stop',
      };
    }

    if (isBookingStart(patientMessage)) {
      if (toolRounds === 0) {
        return {
          model: 'scenario-agent',
          content: '',
          toolCalls: [
            toolCall('call_reason', 'update_booking_state', {
              fields: { reason_for_visit: 'knee pain checkup' },
            }),
          ],
          finishReason: 'tool_calls',
        };
      }
      return {
        model: 'scenario-agent',
        content:
          'Sure, knee pain checkup. Which day works, and may I have your name and mobile number?',
        finishReason: 'stop',
      };
    }

    if (isRichBookingDetails(patientMessage)) {
      const phone = extractPhone(patientMessage);
      if (toolRounds === 0) {
        return {
          model: 'scenario-agent',
          content: '',
          toolCalls: [
            toolCall('call_update_rich', 'update_booking_state', {
              fields: {
                reason_for_visit: 'knee pain checkup',
                patient_name: 'Priya',
                patient_phone: phone ? `+91${phone}` : null,
                preferred_date: options.fridayDate,
                time_preference: 'morning',
              },
            }),
            toolCall('call_slots_friday', 'check_slot_availability', {
              reasonForVisit: 'knee pain checkup',
              date: options.fridayDate,
              timePreference: 'morning',
            }),
          ],
          finishReason: 'tool_calls',
        };
      }
      const slotsResult = extractToolResult(request.messages, 'check_slot_availability');
      const slots = (slotsResult?.slots as Array<Record<string, unknown>>) ?? [];
      const slotList =
        slots.length > 0
          ? slots
              .slice(0, 2)
              .map((slot) => slot.time)
              .join(' and ')
          : 'morning times';
      return {
        model: 'scenario-agent',
        content: `Thanks Priya! Friday morning I have ${slotList} open — which slot should I book?`,
        finishReason: 'stop',
      };
    }

    return {
      model: 'scenario-agent',
      content: 'How can I help you with your visit today?',
      finishReason: 'stop',
    };
  });
}
