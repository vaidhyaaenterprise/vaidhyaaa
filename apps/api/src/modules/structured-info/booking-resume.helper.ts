import {
  BOOKING_FLOW,
  BOOKING_INTERRUPT_KEY,
  BOOKING_RESUME_TEMPLATE_BY_STATE,
  parseActivePrompt,
  parseBookingCollected,
  resolveResumeBookingState,
  resolveResumeTemplateKeyForFlow,
  type LanguageCode,
  type MessageTemplateKey,
} from '@vaidya/shared';
import type { ConversationSessionRow } from '@vaidya/db';

import {
  formatDateDisplay,
  formatSlotList,
  formatTimeOptions,
  getAvailableTimePreferencesForDate,
} from '../booking/booking-field-extractor';
import { TemplateRenderer } from '../conversation/template-renderer.service';

export { BOOKING_INTERRUPT_KEY } from '@vaidya/shared';

export type BookingInterruptSnapshot = {
  state: string;
  collected: Record<string, unknown>;
};

const BOOKING_RESUME_TEMPLATES = BOOKING_RESUME_TEMPLATE_BY_STATE;

export function captureBookingInterrupt(
  flowBefore: string,
  stateBefore: string,
  collectedJson: Record<string, unknown>,
): BookingInterruptSnapshot | null {
  if (flowBefore !== BOOKING_FLOW) {
    return null;
  }

  const { [BOOKING_INTERRUPT_KEY]: _, ...bookingCollected } = collectedJson;
  return {
    state: stateBefore,
    collected: parseBookingCollected(bookingCollected) as Record<string, unknown>,
  };
}

export function parseBookingInterrupt(
  collectedJson: Record<string, unknown>,
): BookingInterruptSnapshot | null {
  const raw = collectedJson[BOOKING_INTERRUPT_KEY];
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const snapshot = raw as BookingInterruptSnapshot;
  if (typeof snapshot.state !== 'string' || !snapshot.collected || typeof snapshot.collected !== 'object') {
    return null;
  }

  return snapshot;
}

export function attachBookingInterrupt(
  collectedJson: Record<string, unknown>,
  interrupt: BookingInterruptSnapshot | null,
): Record<string, unknown> {
  if (!interrupt) {
    return collectedJson;
  }

  return {
    ...collectedJson,
    [BOOKING_INTERRUPT_KEY]: interrupt,
  };
}

export function buildBookingResumeVariables(
  collectedJson: Record<string, unknown>,
  state: string,
  clinicName: string,
): Record<string, string> {
  const collected = parseBookingCollected(collectedJson);
  const proposedSlots = collected.proposed_slots ?? [];
  const timePreferences =
    collected.preferred_date && proposedSlots.length > 0
      ? getAvailableTimePreferencesForDate(
          proposedSlots.map((slot) => ({
            start_time: slot.start_time,
            available_count: 1,
          })),
          collected.preferred_date,
        )
      : collected.time_preference
        ? [collected.time_preference]
        : [];

  return {
    clinic_name: clinicName,
    doctor_name: collected.doctor_name ?? 'Doctor',
    date_display: formatDateDisplay(collected.preferred_date ?? ''),
    slot_list: proposedSlots.length > 0 ? formatSlotList(proposedSlots) : '',
    slot_time: '',
    time_options: formatTimeOptions(timePreferences),
  };
}

export async function appendBookingResumeText(
  templateRenderer: TemplateRenderer,
  answerText: string,
  session: ConversationSessionRow,
  collectedJson: Record<string, unknown>,
  options?: {
    resumeState?: string;
    clinicName?: string;
  },
): Promise<string> {
  const resumeState = resolveResumeBookingState(
    collectedJson,
    options?.resumeState ?? session.currentState,
  );
  const resumeKey =
    resolveResumeTemplateKeyForFlow(session.currentFlow, resumeState) ??
    BOOKING_RESUME_TEMPLATES[resumeState] ??
    parseActivePrompt(collectedJson)?.template_key;
  if (!resumeKey || typeof resumeKey !== 'string') {
    return answerText;
  }

  const resumeVars = buildBookingResumeVariables(
    collectedJson,
    resumeState,
    options?.clinicName ?? '',
  );

  const resume = await templateRenderer.render(
    resumeKey as MessageTemplateKey,
    session.languageCode as LanguageCode,
    resumeVars,
  );
  return `${answerText}\n\n${resume.message_text}`;
}

export async function restoreBookingAfterFailedInterrupt(input: {
  templateRenderer: TemplateRenderer;
  languageCode: LanguageCode;
  clinicName: string;
  interrupt: BookingInterruptSnapshot;
  cancelTemplateKey: MessageTemplateKey;
}): Promise<{
  templateKey: MessageTemplateKey;
  templateVariables: Record<string, string>;
  flowAfter: string;
  stateAfter: string;
  collectedJson: Record<string, unknown>;
  intent: string;
}> {
  const cancelled = await input.templateRenderer.render(
    input.cancelTemplateKey,
    input.languageCode,
    { clinic_name: input.clinicName },
  );

  const resumeKey = BOOKING_RESUME_TEMPLATES[input.interrupt.state];
  let answerText = cancelled.message_text;
  if (resumeKey) {
    const resume = await input.templateRenderer.render(
      resumeKey,
      input.languageCode,
      buildBookingResumeVariables(
        input.interrupt.collected,
        input.interrupt.state,
        input.clinicName,
      ),
    );
    answerText = `${cancelled.message_text}\n\n${resume.message_text}`;
  }

  return {
    templateKey: 'knowledge.answer',
    templateVariables: { answer_text: answerText },
    flowAfter: BOOKING_FLOW,
    stateAfter: input.interrupt.state,
    collectedJson: { ...input.interrupt.collected },
    intent: 'book_appointment',
  };
}
