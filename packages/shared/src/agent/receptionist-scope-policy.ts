import type { MessageTemplateKey } from '../templates/index';

import { BOOKING_FLOW } from '../booking/states';
import { CANCEL_FLOW, HANDOFF_FLOW, RESCHEDULE_FLOW } from '../lifecycle/flows';

export type ConversationPolicyOutcome =
  | 'answer_and_resume'
  | 'refuse_and_resume'
  | 'fallback_staff_confirm_and_resume'
  | 'redirect_scope_and_resume'
  | 'end_flow'
  | 'switch_to_handoff'
  | 'emergency_override';

export type ConversationPolicyDecision = {
  outcome: ConversationPolicyOutcome;
  templateKey: MessageTemplateKey;
  resumeFlow: boolean;
};

const ACTIVE_FLOWS = new Set<string>([BOOKING_FLOW, CANCEL_FLOW, RESCHEDULE_FLOW, HANDOFF_FLOW]);

export function isActiveReceptionistFlow(flow: string): boolean {
  return ACTIVE_FLOWS.has(flow);
}

export function resolveGlobalIntentPolicy(input: {
  intent: string;
  flowBefore: string;
  safety: { isEmergency: boolean; isMedicalAdviceRequest: boolean };
}): ConversationPolicyDecision | null {
  if (input.safety.isEmergency) {
    return {
      outcome: 'emergency_override',
      templateKey: isActiveReceptionistFlow(input.flowBefore)
        ? 'safety.emergency_active_flow'
        : 'safety.emergency',
      resumeFlow: false,
    };
  }

  if (input.safety.isMedicalAdviceRequest) {
    return {
      outcome: isActiveReceptionistFlow(input.flowBefore) ? 'refuse_and_resume' : 'end_flow',
      templateKey: isActiveReceptionistFlow(input.flowBefore)
        ? 'safety.medical_advice_refusal_resume'
        : 'safety.medical_advice_refusal',
      resumeFlow: isActiveReceptionistFlow(input.flowBefore),
    };
  }

  if (input.intent === 'out_of_scope') {
    return {
      outcome: isActiveReceptionistFlow(input.flowBefore)
        ? 'redirect_scope_and_resume'
        : 'end_flow',
      templateKey: 'scope.out_of_scope_redirect',
      resumeFlow: isActiveReceptionistFlow(input.flowBefore),
    };
  }

  if (input.intent === 'unsupported_service') {
    return {
      outcome: 'end_flow',
      templateKey: 'scope.unsupported_service',
      resumeFlow: false,
    };
  }

  if (input.intent === 'ask_human_agent') {
    return {
      outcome: 'switch_to_handoff',
      templateKey: isActiveReceptionistFlow(input.flowBefore)
        ? 'handoff.started_from_active_flow'
        : 'handoff.ask_reason',
      resumeFlow: false,
    };
  }

  return null;
}

export function resolveActiveStatePolicy(input: {
  recognizedAs: string;
  flowBefore: string;
}): ConversationPolicyDecision | null {
  if (input.recognizedAs === 'scope_redirect') {
    return {
      outcome: 'redirect_scope_and_resume',
      templateKey: 'scope.out_of_scope_redirect',
      resumeFlow: isActiveReceptionistFlow(input.flowBefore),
    };
  }

  if (input.recognizedAs === 'side_question') {
    return {
      outcome: 'answer_and_resume',
      templateKey: 'scope.resume_booking_prompt',
      resumeFlow: isActiveReceptionistFlow(input.flowBefore),
    };
  }

  return null;
}

export function staffConfirmTemplateKey(
  flowBefore: string,
  offerCallback = false,
): MessageTemplateKey {
  if (offerCallback && !isActiveReceptionistFlow(flowBefore)) {
    return 'scope.staff_confirm_offer_callback';
  }
  return 'scope.staff_confirm_and_resume';
}

export function detectActiveScopeRedirect(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    /\bweather\b/.test(normalized) ||
    /\bcricket\b/.test(normalized) ||
    /\bhoroscope\b/.test(normalized) ||
    /\bgold rate\b/.test(normalized) ||
    /\btrain timing\b/.test(normalized) ||
    /\btraffic\b/.test(normalized) ||
    /\bbus route\b/.test(normalized) ||
    /\bmovie recommendation\b/.test(normalized) ||
    /\bmovie ticket\b/.test(normalized) ||
    /\bpolitics\b/.test(normalized) ||
    /\bjoke\b/.test(normalized)
  );
}
