import { Inject, Injectable } from '@nestjs/common';

import type { ConversationSessionRow } from '@vaidya/db';
import {
  attachActiveTask,
  markTaskCompleted,
  parseActiveTask,
  resolveResumePromptTemplateKey,
  shouldOfferRepeatedPromptEscalation,
  type LanguageCode,
  type ReceptionistDialogPlan,
} from '@vaidya/shared';

import { appendBookingResumeText } from '../structured-info/booking-resume.helper';
import { TemplateRenderer } from './template-renderer.service';

@Injectable()
export class ReceptionistResponseComposer {
  constructor(@Inject(TemplateRenderer) private readonly templateRenderer: TemplateRenderer) {}

  async composeAcknowledgement(
    plan: ReceptionistDialogPlan,
    languageCode: LanguageCode,
    clinicName: string,
    messageText?: string,
  ): Promise<{ templateKey: string; templateVariables: Record<string, string>; messageText: string }> {
    const isOkay = messageText
      ? /^(okay|ok|seri|sari)\.?$/i.test(messageText.trim())
      : false;
    const templateKey = isOkay ? 'ack.okay_offer_help' : 'ack.thanks_offer_help';
    const rendered = await this.templateRenderer.render(templateKey, languageCode, {
      clinic_name: clinicName,
    });
    return {
      templateKey,
      templateVariables: { clinic_name: clinicName },
      messageText: rendered.message_text,
    };
  }

  async composeClarification(
    plan: ReceptionistDialogPlan,
    languageCode: LanguageCode,
    clinicName: string,
    resumePrompt?: string | null,
  ): Promise<{ templateKey: string; templateVariables: Record<string, string>; messageText: string }> {
    const templateKey = resumePrompt ? 'clarify.which_detail_resume' : 'clarify.which_detail';
    const rendered = await this.templateRenderer.render(templateKey, languageCode, {
      clinic_name: clinicName,
      ...(resumePrompt ? { resume_prompt: resumePrompt } : {}),
    });
    if (shouldOfferRepeatedPromptEscalation({}) && plan.clarificationReason === 'unrecognized_utterance') {
      const escalation = await this.templateRenderer.render('llm.callback_fallback', languageCode, {
        clinic_name: clinicName,
      });
      return {
        templateKey: 'llm.callback_fallback',
        templateVariables: { clinic_name: clinicName },
        messageText: escalation.message_text,
      };
    }
    return {
      templateKey,
      templateVariables: { clinic_name: clinicName },
      messageText: rendered.message_text,
    };
  }

  async composeAnswerWithResume(input: {
    answerText: string;
    session: ConversationSessionRow;
    clinicName: string;
    languageCode: LanguageCode;
    resumeTemplateKey: string | null;
    resumeState: string;
  }): Promise<string> {
    if (!input.resumeTemplateKey) {
      return input.answerText;
    }
    return appendBookingResumeText(
      this.templateRenderer,
      input.answerText,
      input.session,
      input.session.collectedJson as Record<string, unknown>,
      { clinicName: input.clinicName, resumeState: input.resumeState },
    );
  }

  resolveResumeTemplateKey(plan: ReceptionistDialogPlan): string | null {
    return plan.taskPlan.resumePromptKey ?? null;
  }

  finalizeCollectedAfterPlan(
    collected: Record<string, unknown>,
    plan: ReceptionistDialogPlan,
    renderedTemplateKey: string,
  ): Record<string, unknown> {
    let next = { ...collected };

    if (plan.turnType === 'complete_acknowledgement' || plan.taskPlan.shouldEndActiveTask) {
      next = markTaskCompleted(next, {
        flow: (parseActiveTask(collected)?.flow ?? 'booking') as string,
        finalTemplateKey: renderedTemplateKey,
      });
      delete next.awaiting_terminal_ack;
      return next;
    }

    if (plan.turnType === 'ask_clarification_and_keep_task' || plan.taskPlan.shouldResumeActiveTask) {
      const activeTask = parseActiveTask(collected);
      if (activeTask) {
        next = attachActiveTask(next, activeTask);
      }
    }

    return next;
  }
}
