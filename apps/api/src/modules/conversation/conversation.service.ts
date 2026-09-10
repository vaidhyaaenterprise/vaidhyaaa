import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import {
  createRepositories,
  type ConversationMessageRow,
  type ConversationSessionRow,
  type Repositories,
} from '@vaidya/db';
import {
  ADAPTER_TOKENS,
  AppError,
  buildAgentTrace,
  LOW_INTENT_CONFIDENCE,
  LOW_STATE_ENTITY_CONFIDENCE,
  type CreateConversationSessionInput,
  type LockService,
  type SendConversationMessageInput,
} from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { sessionLockKey } from '../../common/locks/in-memory-lock.service';
import { API_ENV } from '../../config/api-config.module';
import { DATABASE_CONNECTION } from '../database/database.module';

import { ConversationOrchestrator } from './conversation-orchestrator.service';
import { AgentNluFailureAuditService } from './agent-nlu-failure-audit.service';
import { LanguageManager } from './language-manager.service';
import { TemplateRenderer } from './template-renderer.service';

const SESSION_LOCK_TTL_MS = 30_000;

export interface ConversationMessageResponse {
  id: string;
  clinic_id: string;
  session_id: string;
  sender: string;
  message_text: string;
  intent: string | null;
  reply_template_key: string | null;
  flow_before: string | null;
  state_before: string | null;
  flow_after: string | null;
  state_after: string | null;
  debug_json?: Record<string, unknown> | null;
  created_at: string;
}

export interface ConversationSessionResponse {
  id: string;
  clinic_id: string;
  channel: string;
  patient_phone: string | null;
  patient_id: string | null;
  language_code: string;
  language_source: string | null;
  current_flow: string;
  current_state: string;
  collected_json: Record<string, unknown>;
  status: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class ConversationService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(ConversationOrchestrator) private readonly orchestrator: ConversationOrchestrator,
    @Inject(AgentNluFailureAuditService) private readonly nluFailureAudit: AgentNluFailureAuditService,
    @Inject(LanguageManager) private readonly languageManager: LanguageManager,
    @Inject(TemplateRenderer) private readonly templateRenderer: TemplateRenderer,
    @Inject(ADAPTER_TOKENS.LockService) private readonly lockService: LockService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async createSession(input: CreateConversationSessionInput): Promise<ConversationSessionResponse> {
    const [clinic] = await this.repos.clinics.findClinicById(input.clinic_id);
    if (!clinic) {
      throw new AppError('CLINIC_NOT_FOUND', 'Clinic not found.');
    }

    const { languageCode, languageSource } = await this.languageManager.resolveInitialLanguage(
      input.clinic_id,
      input.language_code,
    );

    const [session] = await this.repos.conversationSessions.create({
      clinicId: input.clinic_id,
      channel: input.channel,
      patientPhone: input.patient_phone ?? null,
      languageCode,
      languageSource,
      currentFlow: 'none',
      currentState: 'IDLE',
      collectedJson: {},
      status: 'active',
    });

    if (!session) {
      throw new AppError('INTERNAL_ERROR', 'Failed to create conversation session.');
    }

    return this.toSessionResponse(session);
  }

  async getSession(sessionId: string): Promise<{
    session: ConversationSessionResponse;
    messages: ConversationMessageResponse[];
  }> {
    const session = await this.requireSession(sessionId);
    const messages = await this.repos.conversationMessages.listBySession(
      session.clinicId,
      session.id,
    );

    return {
      session: this.toSessionResponse(session),
      messages: messages.map((message) => this.toMessageResponse(message)),
    };
  }

  async sendMessage(
    sessionId: string,
    input: SendConversationMessageInput,
  ): Promise<{
    session: ConversationSessionResponse;
    patient_message: ConversationMessageResponse;
    assistant_message: ConversationMessageResponse;
  }> {
    const session = await this.requireSession(sessionId);
    const lockKey = sessionLockKey(sessionId);
    const acquired = await this.lockService.acquire(lockKey, SESSION_LOCK_TTL_MS);

    if (!acquired) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'Conversation session is locked.', {
        reason: 'session_lock',
        session_id: sessionId,
      });
    }

    try {
      if (input.idempotency_key) {
        const cached = await this.lookupIdempotentResponse(
          session.clinicId,
          input.idempotency_key,
          input,
        );
        if (cached) {
          return cached;
        }
      }

      const result = await this.processMessage(session, input);

      if (input.idempotency_key) {
        await this.repos.messageIdempotency.create({
          clinicId: session.clinicId,
          sessionId: session.id,
          idempotencyKey: input.idempotency_key,
          requestHash: this.hashRequest(input),
          responseJson: result,
        });
      }

      return result;
    } finally {
      await this.lockService.release(lockKey);
    }
  }

  private async processMessage(
    session: ConversationSessionRow,
    input: SendConversationMessageInput,
  ): Promise<{
    session: ConversationSessionResponse;
    patient_message: ConversationMessageResponse;
    assistant_message: ConversationMessageResponse;
  }> {
    const [clinic] = await this.repos.clinics.findClinicById(session.clinicId);
    if (!clinic) {
      throw new AppError('CLINIC_NOT_FOUND', 'Clinic not found.');
    }

    const priorMessages = await this.repos.conversationMessages.listBySession(
      session.clinicId,
      session.id,
    );
    const lastAssistant = [...priorMessages].reverse().find((message) => message.sender === 'assistant');
    const recentTurns = priorMessages.slice(-8).map((message) => ({
      role: message.sender === 'patient' ? ('patient' as const) : ('assistant' as const),
      text: message.messageText,
      templateKey: message.replyTemplateKey ?? null,
    }));

    const orchestration = await this.orchestrator.handlePatientMessage({
      session,
      clinicName: clinic.name,
      messageText: input.message_text,
      lastAssistantMessageText: lastAssistant?.messageText ?? null,
      lastAssistantTemplateKey: lastAssistant?.replyTemplateKey ?? null,
      recentTurns,
    });

    const [patientMessage] = await this.repos.conversationMessages.create({
      clinicId: session.clinicId,
      sessionId: session.id,
      sender: 'patient',
      messageText: input.message_text,
      flowBefore: session.currentFlow,
      stateBefore: session.currentState,
      flowAfter: orchestration.flowAfter,
      stateAfter: orchestration.stateAfter,
    });

    if (!patientMessage) {
      throw new AppError('INTERNAL_ERROR', 'Failed to store patient message.');
    }

    await this.recordNluFailuresIfNeeded({
      session,
      messageId: patientMessage.id,
      messageText: input.message_text,
      orchestration,
    });

    const rendered = orchestration.messageText
      ? {
          message_text: orchestration.messageText,
          template_key: orchestration.templateKey,
        }
      : await this.templateRenderer.render(
          orchestration.templateKey,
          orchestration.languageCode,
          orchestration.templateVariables,
        );

    const [updatedSession] = await this.repos.conversationSessions.update(
      session.clinicId,
      session.id,
      {
        languageCode: orchestration.languageCode,
        languageSource: orchestration.languageSource ?? session.languageSource,
        currentFlow: orchestration.flowAfter,
        currentState: orchestration.stateAfter,
        collectedJson: orchestration.collectedJson,
        ...(orchestration.sessionStatus ? { status: orchestration.sessionStatus } : {}),
      },
    );

    const activeSession = updatedSession ?? session;

    const debugPayload =
      this.env.DEBUG_API && this.env.NODE_ENV !== 'production'
        ? {
            ...(orchestration.debug ?? {}),
            trace: buildAgentTrace({
              messageId: patientMessage.id,
              sessionId: session.id,
              clinicId: session.clinicId,
              flowBefore: session.currentFlow,
              stateBefore: session.currentState,
              flowAfter: orchestration.flowAfter,
              stateAfter: orchestration.stateAfter,
              intent: orchestration.intent,
              templateKey: orchestration.templateKey,
              debug: orchestration.debug ?? {},
            }),
          }
        : orchestration.debug ?? null;

    const [assistantMessage] = await this.repos.conversationMessages.create({
      clinicId: session.clinicId,
      sessionId: session.id,
      sender: 'assistant',
      messageText: rendered.message_text,
      intent: orchestration.intent,
      replyTemplateKey: orchestration.templateKey,
      flowBefore: orchestration.flowBefore,
      stateBefore: orchestration.stateBefore,
      flowAfter: orchestration.flowAfter,
      stateAfter: orchestration.stateAfter,
      debugJson: debugPayload,
    });

    if (!assistantMessage) {
      throw new AppError('INTERNAL_ERROR', 'Failed to store assistant message.');
    }

    return {
      session: this.toSessionResponse(activeSession),
      patient_message: this.toMessageResponse(patientMessage),
      assistant_message: this.toMessageResponse(assistantMessage),
    };
  }

  private async lookupIdempotentResponse(
    clinicId: string,
    idempotencyKey: string,
    input: SendConversationMessageInput,
  ) {
    const [existing] = await this.repos.messageIdempotency.findByKey(clinicId, idempotencyKey);
    if (!existing) {
      return null;
    }

    const requestHash = this.hashRequest(input);
    if (existing.requestHash && existing.requestHash !== requestHash) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different payload.', {
        idempotency_key: idempotencyKey,
      });
    }

    const cached = existing.responseJson as {
      session: ConversationSessionResponse;
      patient_message: ConversationMessageResponse;
      assistant_message: ConversationMessageResponse;
    } | null;

    if (!cached) {
      return null;
    }

    return cached;
  }

  private async requireSession(sessionId: string): Promise<ConversationSessionRow> {
    const [session] = await this.repos.conversationSessions.findBySessionId(sessionId);
    if (!session) {
      throw new AppError('NOT_FOUND', 'Conversation session not found.');
    }
    return session;
  }

  private hashRequest(input: SendConversationMessageInput): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  private toSessionResponse(session: ConversationSessionRow): ConversationSessionResponse {
    return {
      id: session.id,
      clinic_id: session.clinicId,
      channel: session.channel,
      patient_phone: session.patientPhone,
      patient_id: session.patientId,
      language_code: session.languageCode,
      language_source: session.languageSource,
      current_flow: session.currentFlow,
      current_state: session.currentState,
      collected_json: (session.collectedJson as Record<string, unknown>) ?? {},
      status: session.status,
      expires_at: session.expiresAt?.toISOString() ?? null,
      created_at: session.createdAt.toISOString(),
      updated_at: session.updatedAt.toISOString(),
    };
  }

  private toMessageResponse(message: ConversationMessageRow): ConversationMessageResponse {
    const response: ConversationMessageResponse = {
      id: message.id,
      clinic_id: message.clinicId,
      session_id: message.sessionId,
      sender: message.sender,
      message_text: message.messageText,
      intent: message.intent,
      reply_template_key: message.replyTemplateKey,
      flow_before: message.flowBefore,
      state_before: message.stateBefore,
      flow_after: message.flowAfter,
      state_after: message.stateAfter,
      created_at: message.createdAt.toISOString(),
    };

    if (this.env.DEBUG_API && this.env.NODE_ENV !== 'production') {
      response.debug_json = (message.debugJson as Record<string, unknown> | null) ?? null;
    }

    return response;
  }

  private async recordNluFailuresIfNeeded(input: {
    session: ConversationSessionRow;
    messageId: string;
    messageText: string;
    orchestration: Awaited<ReturnType<ConversationOrchestrator['handlePatientMessage']>>;
  }): Promise<void> {
    const debug = input.orchestration.debug ?? {};
    const classification =
      debug.classification && typeof debug.classification === 'object'
        ? (debug.classification as { intent?: string; confidence?: number; needsClarification?: boolean })
        : null;

    if (
      input.orchestration.templateKey === 'unknown.clarify' ||
      input.orchestration.intent === 'unknown'
    ) {
      await this.nluFailureAudit.recordFailure({
        clinicId: input.session.clinicId,
        sessionId: input.session.id,
        messageId: input.messageId,
        messageText: input.messageText,
        flow: input.session.currentFlow,
        state: input.session.currentState,
        failureType: 'classifier',
        reason: 'unknown_intent',
        intent: input.orchestration.intent,
        confidence: classification?.confidence ?? null,
      });
    }

    if (
      classification &&
      typeof classification.confidence === 'number' &&
      classification.confidence <= LOW_INTENT_CONFIDENCE
    ) {
      await this.nluFailureAudit.recordFailure({
        clinicId: input.session.clinicId,
        sessionId: input.session.id,
        messageId: input.messageId,
        messageText: input.messageText,
        flow: input.session.currentFlow,
        state: input.session.currentState,
        failureType: 'classifier',
        reason: 'low_confidence',
        intent: classification.intent ?? input.orchestration.intent,
        confidence: classification.confidence,
      });
      return;
    }

    if (
      input.orchestration.templateKey === 'unknown.clarify' ||
      input.orchestration.intent === 'unknown'
    ) {
      return;
    }

    const recognizedAs =
      typeof debug.recognized_as === 'string'
        ? debug.recognized_as
        : typeof debug.recognizedAs === 'string'
          ? debug.recognizedAs
          : null;
    if (recognizedAs === 'unknown') {
      const interpreterConfidence =
        typeof debug.confidence === 'number'
          ? debug.confidence
          : classification?.confidence ?? null;
      const reason =
        interpreterConfidence !== null &&
        interpreterConfidence <= LOW_STATE_ENTITY_CONFIDENCE
          ? 'low_confidence_state_extraction'
          : 'unrecognized_active_state';

      await this.nluFailureAudit.recordFailure({
        clinicId: input.session.clinicId,
        sessionId: input.session.id,
        messageId: input.messageId,
        messageText: input.messageText,
        flow: input.session.currentFlow,
        state: input.session.currentState,
        failureType: 'interpreter',
        reason,
        recognizedAs,
        confidence: interpreterConfidence,
        predictedEntitiesJson: this.readPredictedEntities(debug),
      });
    }
  }

  private readPredictedEntities(debug: Record<string, unknown>): Record<string, unknown> {
    const entities = debug.entities;
    if (entities && typeof entities === 'object') {
      return entities as Record<string, unknown>;
    }
    const extracted = debug.extracted;
    if (extracted && typeof extracted === 'object') {
      return extracted as Record<string, unknown>;
    }
    return {};
  }
}
