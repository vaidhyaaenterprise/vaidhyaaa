import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type ConversationSessionRow, type Repositories } from '@vaidya/db';
import { AppError, type LanguageCode } from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';
import { StaffNotificationService } from '../patient-action/staff-notification.service';

import type { OrchestratorResult } from './conversation-orchestrator.service';

export const LLM_FAILURE_COUNT_KEY = 'llm_failure_count';

@Injectable()
export class LlmFailureHandlerService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(StaffNotificationService) private readonly staffNotification: StaffNotificationService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  isLlmFailure(error: unknown): boolean {
    if (!(error instanceof AppError) || error.code !== 'INTERNAL_ERROR') {
      return false;
    }
    const message = error.message.toLowerCase();
    return message.includes('sarvam') || message.includes('llm');
  }

  readFailureCount(collectedJson: Record<string, unknown>): number {
    const value = collectedJson[LLM_FAILURE_COUNT_KEY];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  clearFailureCount(collectedJson: Record<string, unknown>): Record<string, unknown> {
    if (!(LLM_FAILURE_COUNT_KEY in collectedJson)) {
      return collectedJson;
    }
    const next = { ...collectedJson };
    delete next[LLM_FAILURE_COUNT_KEY];
    return next;
  }

  async handleFailure(input: {
    session: ConversationSessionRow;
    clinicName: string;
    languageCode: LanguageCode;
    flowBefore: string;
    stateBefore: string;
    collectedJson: Record<string, unknown>;
    error: AppError;
  }): Promise<OrchestratorResult> {
    const nextCount = this.readFailureCount(input.collectedJson) + 1;
    const base = {
      flowBefore: input.flowBefore,
      stateBefore: input.stateBefore,
      flowAfter: input.flowBefore,
      stateAfter: input.stateBefore,
      languageCode: input.languageCode,
    };

    if (nextCount >= 2) {
      await this.createSystemCallback(input.session, input.error.message);
      return {
        ...base,
        intent: 'ask_human_agent',
        templateKey: 'llm.callback_fallback',
        templateVariables: { clinic_name: input.clinicName },
        flowAfter: 'none',
        stateAfter: 'IDLE',
        collectedJson: { [LLM_FAILURE_COUNT_KEY]: nextCount },
        sessionStatus: 'completed',
      };
    }

    return {
      ...base,
      intent: 'unknown',
      templateKey: 'llm.retry_request',
      templateVariables: { clinic_name: input.clinicName },
      collectedJson: {
        ...input.collectedJson,
        [LLM_FAILURE_COUNT_KEY]: nextCount,
      },
      sessionStatus: 'active',
    };
  }

  private async createSystemCallback(
    session: ConversationSessionRow,
    failureReason: string,
  ): Promise<void> {
    const phone = session.patientPhone;
    if (!phone) {
      return;
    }

    const [callback] = await this.repos.appointmentLifecycle.insertCallbackRequest({
      clinicId: session.clinicId,
      patientName: null,
      patientPhone: phone,
      reason: `System LLM failure: ${failureReason}`,
      status: 'pending',
      sourceSessionId: session.id,
    });

    if (callback) {
      await this.staffNotification.notifyStaffActionRequest({
        clinicId: session.clinicId,
        eventType: 'staff.callback_request',
        templateKey: 'llm.callback_fallback',
        deduplicationKey: `llm_failure:${session.id}:${callback.id}`,
        payload: {
          callback_request_id: callback.id,
          session_id: session.id,
          failure_reason: failureReason,
          patient_phone: phone,
        },
      });
    }
  }
}
