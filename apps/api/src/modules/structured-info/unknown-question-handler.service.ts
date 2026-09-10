import { Inject, Injectable } from '@nestjs/common';

import type { ConversationSessionRow } from '@vaidya/db';
import {
  BOOKING_FLOW,
  isClinicIdentityQuestion,
  messageReferencesClinicName,
  shouldTryKnowledgeBeforeClarify,
  type IntentClassifierResult,
  type LanguageCode,
  type MessageTemplateKey,
} from '@vaidya/shared';

import { KnowledgeSearchService } from '../knowledge/knowledge-search.service';
import { TemplateRenderer } from '../conversation/template-renderer.service';
import { appendBookingResumeText } from './booking-resume.helper';

export type UnknownQuestionHandlerResult = {
  intent: string;
  templateKey: MessageTemplateKey;
  templateVariables: Record<string, string>;
  flowBefore: string;
  stateBefore: string;
  flowAfter: string;
  stateAfter: string;
  languageCode: LanguageCode;
  collectedJson: Record<string, unknown>;
  debug?: Record<string, unknown>;
};

@Injectable()
export class UnknownQuestionHandler {
  constructor(
    @Inject(KnowledgeSearchService) private readonly knowledgeSearch: KnowledgeSearchService,
    @Inject(TemplateRenderer) private readonly templateRenderer: TemplateRenderer,
  ) {}

  async tryClinicIdentityAnswer(input: {
    session: ConversationSessionRow;
    clinicName: string;
    messageText: string;
    languageCode: LanguageCode;
    flowBefore: string;
    stateBefore: string;
  }): Promise<UnknownQuestionHandlerResult | null> {
    if (!isClinicIdentityQuestion(input.messageText)) {
      return null;
    }

    const preserveBooking = input.flowBefore === BOOKING_FLOW;
    const matchesClinic =
      messageReferencesClinicName(input.messageText, input.clinicName) ||
      /\b(ithu|idhu|indha|this is|is this|is it)\b/i.test(input.messageText);

    let answerText = matchesClinic
      ? `Aama, idhu ${input.clinicName}.`
      : `Idhu ${input.clinicName} dhaan. Vera clinic-a nenaichingala?`;

    if (preserveBooking) {
      answerText = await appendBookingResumeText(
        this.templateRenderer,
        answerText,
        input.session,
        input.session.collectedJson as Record<string, unknown>,
      );
    }

    return {
      intent: 'ask_clinic_identity',
      templateKey: 'knowledge.answer',
      templateVariables: { answer_text: answerText },
      flowBefore: input.flowBefore,
      stateBefore: input.stateBefore,
      flowAfter: preserveBooking ? BOOKING_FLOW : 'none',
      stateAfter: preserveBooking ? input.stateBefore : 'IDLE',
      languageCode: input.languageCode,
      collectedJson: preserveBooking
        ? ((input.session.collectedJson as Record<string, unknown>) ?? {})
        : {},
      debug: {
        handler: 'a04_unknown_question',
        source: 'clinic_identity',
        search_provider: 'structured_db',
      },
    };
  }

  async tryKnowledgeFallback(input: {
    session: ConversationSessionRow;
    messageText: string;
    classification: IntentClassifierResult;
    languageCode: LanguageCode;
    flowBefore: string;
    stateBefore: string;
  }): Promise<UnknownQuestionHandlerResult | null> {
    if (!shouldTryKnowledgeBeforeClarify(input.classification.intent, input.messageText)) {
      return null;
    }

    const preserveBooking = input.flowBefore === BOOKING_FLOW;
    const searchResult = await this.knowledgeSearch.searchApprovedKnowledge(
      input.session.clinicId,
      input.messageText,
    );

    if (!searchResult?.meetsThreshold) {
      return null;
    }

    let answerText = searchResult.answer;
    if (preserveBooking) {
      answerText = await appendBookingResumeText(
        this.templateRenderer,
        answerText,
        input.session,
        input.session.collectedJson as Record<string, unknown>,
      );
    }

    return {
      intent: 'ask_previsit_instruction',
      templateKey: 'knowledge.answer',
      templateVariables: { answer_text: answerText },
      flowBefore: input.flowBefore,
      stateBefore: input.stateBefore,
      flowAfter: preserveBooking ? BOOKING_FLOW : 'none',
      stateAfter: preserveBooking ? input.stateBefore : 'IDLE',
      languageCode: input.languageCode,
      collectedJson: preserveBooking
        ? ((input.session.collectedJson as Record<string, unknown>) ?? {})
        : {},
      debug: {
        handler: 'a04_unknown_question',
        source: 'knowledge_base',
        search_provider: searchResult.searchProvider,
        knowledge_id: searchResult.id,
        score: searchResult.score,
      },
    };
  }
}
