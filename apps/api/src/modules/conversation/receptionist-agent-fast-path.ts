import {
  isActiveAffirmative,
  isActiveDeclining,
  hasBookingProgress,
  parseBookingCollected,
  selectOfferedSlot,
} from '@vaidya/shared';

import {
  assistantAskedForConfirmation,
  isAffirmativePatientReply,
  isAmbiguousShortReply,
} from './receptionist-agent-confirmation';

export type AgentFastPathKind =
  | 'greeting'
  | 'thanks'
  | 'confirmation_yes'
  | 'confirmation_no'
  | 'slot_pick';

export type AgentFastPathMatch =
  | { kind: 'greeting' | 'thanks'; replyText: string }
  | { kind: 'confirmation_yes' }
  | { kind: 'confirmation_no'; replyText: string }
  | { kind: 'slot_pick'; slotId: string; displayTime: string };

const PURE_GREETING_PATTERN =
  /^(hi+|hello+|hey+|vanakkam|good morning|good evening|namaste)\b/i;
const PURE_THANKS_PATTERN =
  /^(thanks|thank you|thankyou|nandri|done|super|great)\.?$/i;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isPureGreeting(messageText: string): boolean {
  const normalized = normalize(messageText);
  if (normalized.length > 60) {
    return false;
  }
  if (/\b(pain|fever|appointment|book|slot|doctor|fee|consultation|venum|paakanum)\b/i.test(normalized)) {
    return false;
  }
  return PURE_GREETING_PATTERN.test(normalized);
}

function isPureThanks(messageText: string): boolean {
  const normalized = normalize(messageText);
  if (normalized.length > 40) {
    return false;
  }
  return PURE_THANKS_PATTERN.test(normalized) || /\b(thanks|thank you|nandri)\b/i.test(normalized);
}

function mapProposedSlots(collected: Record<string, unknown>) {
  const proposed = collected.proposed_slots;
  if (!Array.isArray(proposed)) {
    return [];
  }
  return proposed
    .map((slot) => {
      if (!slot || typeof slot !== 'object') {
        return null;
      }
      const record = slot as Record<string, unknown>;
      const slotId = typeof record.slot_id === 'string' ? record.slot_id : null;
      const displayTime =
        typeof record.display_time === 'string' ? record.display_time : null;
      const startTime = typeof record.start_time === 'string' ? record.start_time : displayTime;
      const endTime = typeof record.end_time === 'string' ? record.end_time : displayTime;
      if (!slotId || !displayTime || !startTime || !endTime) {
        return null;
      }
      return { slotId, displayTime, startTime, endTime };
    })
    .filter(
      (
        slot,
      ): slot is {
        slotId: string;
        displayTime: string;
        startTime: string;
        endTime: string;
      } => Boolean(slot),
    );
}

function resolveSelectedSlotDisplayTime(collected: Record<string, unknown>): string | null {
  const parsed = parseBookingCollected(collected);
  if (!parsed.selected_slot_id || !Array.isArray(parsed.proposed_slots)) {
    return null;
  }
  const slot = parsed.proposed_slots.find((entry) => entry.slot_id === parsed.selected_slot_id);
  return slot?.display_time ?? null;
}

export function evaluateAgentFastPath(input: {
  messageText: string;
  lastAssistantMessageText: string | null;
  collected: Record<string, unknown>;
  languageCode?: string;
}): AgentFastPathMatch | null {
  const text = input.messageText.trim();
  if (!text) {
    return null;
  }

  const hasBookingContext =
    hasBookingProgress(parseBookingCollected(input.collected)) ||
    /\b(appointment|book|slot|pain|fever|doctor|venum|paakanum)\b/i.test(text);

  const useTanglish = input.languageCode !== 'english';
  if (isPureGreeting(text) && !hasBookingContext) {
    return {
      kind: 'greeting',
      replyText: useTanglish
        ? 'Vanakkam. Enna help venum?'
        : 'Vanakkam! How can I help you today?',
    };
  }

  if (isPureThanks(text)) {
    return {
      kind: 'thanks',
      replyText: useTanglish
        ? 'Ungalukku nandri. Take care!'
        : 'You are welcome. Take care!',
    };
  }

  const lastAssistant = input.lastAssistantMessageText;
  const parsedCollected = parseBookingCollected(input.collected);
  if (parsedCollected.selected_slot_id && assistantAskedForConfirmation(lastAssistant)) {
    if (isAffirmativePatientReply(text) || isActiveAffirmative(text)) {
      return { kind: 'confirmation_yes' };
    }
    const displayTime = resolveSelectedSlotDisplayTime(input.collected);
    if (displayTime) {
      const offeredSlots = mapProposedSlots(input.collected);
      if (offeredSlots.length > 0) {
        const selection = selectOfferedSlot(text, offeredSlots);
        if (selection.slotId === parsedCollected.selected_slot_id && !selection.needsClarification) {
          return {
            kind: 'slot_pick',
            slotId: parsedCollected.selected_slot_id,
            displayTime,
          };
        }
      } else if (/\b\d{1,2}(:\d{2})?\b/.test(text)) {
        return {
          kind: 'slot_pick',
          slotId: parsedCollected.selected_slot_id,
          displayTime,
        };
      }
    }
  }

  if (assistantAskedForConfirmation(lastAssistant)) {
    if (isAmbiguousShortReply(text)) {
      return null;
    }
    if (isAffirmativePatientReply(text) || isActiveAffirmative(text)) {
      return { kind: 'confirmation_yes' };
    }
    if (isActiveDeclining(text) || /^(no|vendam|venam|venda)\.?$/i.test(normalize(text))) {
      return {
        kind: 'confirmation_no',
        replyText: 'No problem. Tell me if you want a different slot or need anything else.',
      };
    }
  }

  const offeredSlots = mapProposedSlots(input.collected);
  if (offeredSlots.length > 0 && !parsedCollected.selected_slot_id) {
    const selection = selectOfferedSlot(text, offeredSlots);
    if (selection.slotId && !selection.needsClarification) {
      const picked = offeredSlots.find((slot) => slot.slotId === selection.slotId);
      if (picked) {
        return {
          kind: 'slot_pick',
          slotId: picked.slotId,
          displayTime: picked.displayTime,
        };
      }
    }
  }

  return null;
}
