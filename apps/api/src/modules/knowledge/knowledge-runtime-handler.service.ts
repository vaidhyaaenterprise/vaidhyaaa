import { Inject, Injectable } from '@nestjs/common';

import { DatabaseService } from '@vaidya/db';
import type { ConversationSessionRow } from '@vaidya/db';
import { BOOKING_FLOW, staffConfirmTemplateKey, type IntentClassifierResult, type MessageTemplateKey } from '@vaidya/shared';

import { TemplateRenderer } from '../conversation/template-renderer.service';
import { appendBookingResumeText } from '../structured-info/booking-resume.helper';

import { KnowledgeSearchService } from './knowledge-search.service';

export type KnowledgeRuntimeHandlerInput = {
  session: ConversationSessionRow;
  messageText: string;
  classification: IntentClassifierResult;
  preserveBooking?: boolean;
};

export type KnowledgeRuntimeHandlerResult = {
  intent: string;
  templateKey: MessageTemplateKey;
  templateVariables: Record<string, string>;
  flowAfter: string;
  stateAfter: string;
  collectedJson: Record<string, unknown>;
};

@Injectable()
export class KnowledgeRuntimeHandler {
  constructor(
    @Inject(KnowledgeSearchService) private readonly knowledgeSearch: KnowledgeSearchService,
    @Inject(TemplateRenderer) private readonly templateRenderer: TemplateRenderer,
    @Inject(DatabaseService) private readonly dbService: DatabaseService,
  ) {}

  async handle(input: KnowledgeRuntimeHandlerInput): Promise<KnowledgeRuntimeHandlerResult> {
    const { session, messageText, classification, preserveBooking = false } = input;
    const stateBefore = session.currentState;
    const queryText = classification.entities.topic ?? messageText;
    const searchResult = await this.knowledgeSearch.searchApprovedKnowledge(
      session.clinicId,
      queryText,
    );

    if (!searchResult?.meetsThreshold) {
      if (searchResult) {
        await this.dbService.insertAuditLog({
          clinicId: session.clinicId,
          actorType: 'agent',
          eventType: 'knowledge_vector_search_no_answer',
          entityType: 'conversation_session',
          entityId: session.id,
          eventData: {
            knowledge_id: searchResult.id,
            score: searchResult.score,
            search_provider: searchResult.searchProvider,
            category: searchResult.category,
          },
          source: 'knowledge_runtime_handler',
        });
      }
      return this.renderNoAnswer(session, preserveBooking, stateBefore);
    }

    if (searchResult.searchProvider === 'text') {
      await this.dbService.insertAuditLog({
        clinicId: session.clinicId,
        actorType: 'agent',
        eventType: 'knowledge_search_fallback_to_text',
        entityType: 'conversation_session',
        entityId: session.id,
        eventData: {
          knowledge_id: searchResult.id,
          score: searchResult.score,
          search_provider: searchResult.searchProvider,
          category: searchResult.category,
        },
        source: 'knowledge_runtime_handler',
      });
    } else {
      await this.dbService.insertAuditLog({
        clinicId: session.clinicId,
        actorType: 'agent',
        eventType: 'knowledge_vector_search_used',
        entityType: 'conversation_session',
        entityId: session.id,
        eventData: {
          knowledge_id: searchResult.id,
          score: searchResult.score,
          search_provider: searchResult.searchProvider,
          category: searchResult.category,
          embedding_model: searchResult.embeddingModel ?? null,
        },
        source: 'knowledge_runtime_handler',
      });
    }

    await this.dbService.insertAuditLog({
      clinicId: session.clinicId,
      actorType: 'agent',
      eventType: 'knowledge_answer_used',
      entityType: 'clinic_knowledge_base',
      entityId: searchResult.id,
      eventData: {
        session_id: session.id,
        score: searchResult.score,
        search_provider: searchResult.searchProvider,
        category: searchResult.category,
      },
      source: 'knowledge_runtime_handler',
    });

    let answerText = searchResult.answer;
    if (preserveBooking) {
      answerText = await appendBookingResumeText(
        this.templateRenderer,
        answerText,
        session,
        session.collectedJson as Record<string, unknown>,
      );
    }

    return {
      intent: classification.intent,
      templateKey: 'knowledge.answer',
      templateVariables: { answer_text: answerText },
      flowAfter: preserveBooking ? session.currentFlow : 'none',
      stateAfter: preserveBooking ? stateBefore : 'IDLE',
      collectedJson: preserveBooking
        ? (session.collectedJson as Record<string, unknown>)
        : {},
    };
  }

  private async renderNoAnswer(
    session: ConversationSessionRow,
    preserveBooking: boolean,
    stateBefore: string,
  ): Promise<KnowledgeRuntimeHandlerResult> {
    const staffKey = staffConfirmTemplateKey(session.currentFlow, !preserveBooking);
    const rendered = await this.templateRenderer.render(
      staffKey,
      session.languageCode as 'ta_tanglish' | 'english',
      {},
    );

    let answerText = rendered.message_text;
    if (preserveBooking) {
      answerText = await appendBookingResumeText(
        this.templateRenderer,
        answerText,
        session,
        session.collectedJson as Record<string, unknown>,
      );
    }

    const flowAfter = preserveBooking ? session.currentFlow : 'none';

    return {
      intent: 'ask_previsit_instruction',
      templateKey: 'knowledge.answer',
      templateVariables: { answer_text: answerText },
      flowAfter,
      stateAfter: preserveBooking ? stateBefore : 'IDLE',
      collectedJson: preserveBooking
        ? (session.collectedJson as Record<string, unknown>)
        : {},
    };
  }
}
