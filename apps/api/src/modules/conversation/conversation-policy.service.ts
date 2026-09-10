import { Inject, Injectable } from '@nestjs/common';

import type { ConversationSessionRow } from '@vaidya/db';
import {
  isActiveReceptionistFlow,
  resolveGlobalIntentPolicy,
  staffConfirmTemplateKey,
  type ConversationPolicyDecision,
  type LanguageCode,
  type MessageTemplateKey,
} from '@vaidya/shared';

import { TemplateRenderer } from './template-renderer.service';
import { appendBookingResumeText } from '../structured-info/booking-resume.helper';

@Injectable()
export class ConversationPolicyService {
  constructor(@Inject(TemplateRenderer) private readonly templateRenderer: TemplateRenderer) {}

  resolveGlobalIntentPolicy(input: {
    intent: string;
    flowBefore: string;
    safety: { isEmergency: boolean; isMedicalAdviceRequest: boolean };
  }): ConversationPolicyDecision | null {
    return resolveGlobalIntentPolicy(input);
  }

  async renderWithOptionalResume(input: {
    session: ConversationSessionRow;
    clinicName: string;
    templateKey: MessageTemplateKey;
    templateVariables?: Record<string, string>;
    resumeFlow?: boolean;
    resumeState?: string;
    collectedJson?: Record<string, unknown>;
  }): Promise<string> {
    const rendered = await this.templateRenderer.render(
      input.templateKey,
      input.session.languageCode as LanguageCode,
      input.templateVariables ?? { clinic_name: input.clinicName },
    );

    if (
      input.resumeFlow &&
      isActiveReceptionistFlow(input.session.currentFlow) &&
      input.collectedJson
    ) {
      return appendBookingResumeText(
        this.templateRenderer,
        rendered.message_text,
        input.session,
        input.collectedJson,
        {
          resumeState: input.resumeState ?? input.session.currentState,
          clinicName: input.clinicName,
        },
      );
    }

    return rendered.message_text;
  }

  staffConfirmTemplateKey(flowBefore: string, offerCallback = false): MessageTemplateKey {
    return staffConfirmTemplateKey(flowBefore, offerCallback);
  }
}
