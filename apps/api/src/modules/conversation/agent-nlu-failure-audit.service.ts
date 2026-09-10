import { Inject, Injectable } from '@nestjs/common';

import {
  createRepositories,
  DatabaseService,
  type DatabaseConnection,
  type Repositories,
} from '@vaidya/db';
import { sanitizeAuditMessagePreview } from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../database/database.module';

export type AgentNluFailureAuditInput = {
  clinicId: string;
  sessionId: string;
  messageId: string;
  messageText: string;
  flow: string;
  state: string;
  failureType: 'classifier' | 'router' | 'interpreter';
  reason:
    | 'unknown_intent'
    | 'low_confidence'
    | 'unrecognized_active_state'
    | 'low_confidence_state_extraction';
  intent?: string | null;
  confidence?: number | null;
  recognizedAs?: string | null;
  predictedEntitiesJson?: Record<string, unknown>;
};

@Injectable()
export class AgentNluFailureAuditService {
  private readonly db: DatabaseService;
  private readonly repos: Repositories;

  constructor(@Inject(DATABASE_CONNECTION) connection: DatabaseConnection) {
    this.db = new DatabaseService(connection.db);
    this.repos = createRepositories(connection.db);
  }

  async recordFailure(input: AgentNluFailureAuditInput): Promise<void> {
    const eventType =
      input.failureType === 'classifier'
        ? 'agent_nlu_classifier_failure'
        : input.failureType === 'router'
          ? 'agent_nlu_router_failure'
          : 'agent_nlu_interpreter_failure';

    const messagePreview = sanitizeAuditMessagePreview(input.messageText);
    const predictedEntities = {
      ...(input.predictedEntitiesJson ?? {}),
      ...(input.recognizedAs ? { recognized_as: input.recognizedAs } : {}),
    };

    await this.db.insertAuditLog({
      clinicId: input.clinicId,
      actorType: 'agent',
      eventType,
      entityType: 'conversation_message',
      entityId: input.messageId,
      source: 'conversation_orchestrator',
      eventData: {
        session_id: input.sessionId,
        flow: input.flow,
        state: input.state,
        reason: input.reason,
        intent: input.intent ?? null,
        confidence: input.confidence ?? null,
        recognized_as: input.recognizedAs ?? null,
        message_preview: messagePreview,
      },
    });

    await this.repos.nluReview.upsertReviewItem({
      clinicId: input.clinicId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      messageTextRedacted: messagePreview,
      currentFlow: input.flow,
      currentState: input.state,
      failureType: input.failureType,
      captureReason: input.reason,
      predictedIntent: input.intent ?? input.recognizedAs ?? null,
      predictedConfidence: input.confidence ?? null,
      predictedEntitiesJson: predictedEntities,
    });
  }
}
