import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type ConversationSessionRow, type Repositories } from '@vaidya/db';
import {
  BOOKING_FLOW,
  HANDOFF_FLOW,
  RESCHEDULE_FLOW,
  CANCEL_FLOW,
  type HandoffCollected,
  type IntentClassifierResult,
  isStateEntityNoRejection,
  type MessageTemplateKey,
  parseHandoffCollected,
} from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';
import { ActiveStateInterpretationService } from '../conversation/active-state-interpretation.service';
import { TemplateRenderer } from '../conversation/template-renderer.service';
import { SlotHoldService } from '../slots/slot-hold.service';
import {
  attachBookingInterrupt,
  captureBookingInterrupt,
  parseBookingInterrupt,
  restoreBookingAfterFailedInterrupt,
} from '../structured-info/booking-resume.helper';

import { StaffNotificationService } from './staff-notification.service';

export type HandoffMachineInput = {
  session: ConversationSessionRow;
  clinicName: string;
  messageText: string;
  classification: IntentClassifierResult;
};

export type HandoffMachineResult = {
  intent: string;
  templateKey: MessageTemplateKey;
  templateVariables: Record<string, string>;
  flowBefore: string;
  stateBefore: string;
  flowAfter: string;
  stateAfter: string;
  collectedJson: Record<string, unknown>;
  sessionStatus?: 'active' | 'completed';
};

@Injectable()
export class HandoffMachineService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(StaffNotificationService) private readonly staffNotification: StaffNotificationService,
    @Inject(SlotHoldService) private readonly slotHoldService: SlotHoldService,
    @Inject(TemplateRenderer) private readonly templateRenderer: TemplateRenderer,
    @Inject(ActiveStateInterpretationService)
    private readonly activeStateService: ActiveStateInterpretationService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async handle(input: HandoffMachineInput): Promise<HandoffMachineResult> {
    const flowBefore = input.session.currentFlow;
    const stateBefore = input.session.currentState;
    const rawCollected = (input.session.collectedJson ?? {}) as Record<string, unknown>;
    let collected = parseHandoffCollected(rawCollected);
    let bookingInterrupt = parseBookingInterrupt(rawCollected);

    if (flowBefore === BOOKING_FLOW) {
      await this.slotHoldService.releaseSessionHolds(input.session.clinicId, input.session.id);
      if (!bookingInterrupt) {
        bookingInterrupt = captureBookingInterrupt(flowBefore, stateBefore, rawCollected);
      }
    }

    const shouldInterpret = this.activeStateService.shouldInterpret(
      flowBefore,
      stateBefore,
      rawCollected,
    );
    const interpretation = shouldInterpret
      ? await this.activeStateService.interpret({
          clinicId: input.session.clinicId,
          sessionId: input.session.id,
          currentFlow: flowBefore,
          currentState: stateBefore,
          languageCode: input.session.languageCode,
          messageText: input.messageText,
          timezone: 'Asia/Kolkata',
          collected: collected as Record<string, unknown>,
          channel: input.session.channel,
        })
      : null;

    if (
      (flowBefore === HANDOFF_FLOW || stateBefore !== 'IDLE') &&
      interpretation &&
      isStateEntityNoRejection(interpretation.result)
    ) {
      await this.slotHoldService.releaseSessionHolds(input.session.clinicId, input.session.id);
      if (bookingInterrupt) {
        const restored = await restoreBookingAfterFailedInterrupt({
          templateRenderer: this.templateRenderer,
          languageCode: input.session.languageCode as 'ta_tanglish' | 'english',
          clinicName: input.clinicName,
          interrupt: bookingInterrupt,
          cancelTemplateKey: 'handoff.cancelled',
        });
        return {
          intent: restored.intent,
          templateKey: restored.templateKey,
          templateVariables: restored.templateVariables,
          flowBefore,
          stateBefore,
          flowAfter: restored.flowAfter,
          stateAfter: restored.stateAfter,
          collectedJson: restored.collectedJson,
        };
      }

      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: 'none',
        stateAfter: 'IDLE',
        collectedJson: {},
        templateKey: 'handoff.cancelled',
        intent: 'ask_human_agent',
      });
    }

    if (collected.callback_request_id) {
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: 'none',
        stateAfter: 'DONE',
        collectedJson: this.toCollectedJson(collected, bookingInterrupt),
        templateKey: 'handoff.created',
        intent: 'ask_human_agent',
        sessionStatus: 'completed',
      });
    }

    if (!collected.reason) {
      const reason =
        interpretation?.result.recognizedAs === 'handoff_reason'
          ? interpretation.result.entities.sideQuestionTopic ?? input.messageText.trim()
          : stateBefore === 'ASK_REASON' || stateBefore === 'ASK_REASON_OPTIONAL'
            ? interpretation?.result.entities.sideQuestionTopic ?? null
            : null;
      if (!reason) {
        const startedFromActiveFlow =
          flowBefore === BOOKING_FLOW ||
          flowBefore === RESCHEDULE_FLOW ||
          flowBefore === CANCEL_FLOW;
        return this.result({
          input,
          flowBefore,
          stateBefore,
          flowAfter: HANDOFF_FLOW,
          stateAfter: 'ASK_REASON_OPTIONAL',
          collectedJson: this.toCollectedJson(collected, bookingInterrupt),
          templateKey: startedFromActiveFlow
            ? 'handoff.started_from_active_flow'
            : 'handoff.ask_reason',
          intent: 'ask_human_agent',
        });
      }
      collected = { ...collected, reason };
    }

    if (!collected.patient_name) {
      const name =
        interpretation?.result.entities.patientName ?? input.classification.entities.patientName;
      if (!name) {
        return this.result({
          input,
          flowBefore,
          stateBefore,
          flowAfter: HANDOFF_FLOW,
          stateAfter: 'ASK_NAME_IF_NEEDED',
          collectedJson: this.toCollectedJson(collected, bookingInterrupt),
          templateKey: 'handoff.ask_name',
          intent: 'ask_human_agent',
        });
      }
      collected = { ...collected, patient_name: name };
    }

    const phone =
      collected.patient_phone ??
      input.session.patientPhone ??
      (stateBefore === 'ASK_PHONE_IF_NEEDED'
        ? interpretation?.result.entities.sideQuestionTopic
        : null);
    if (!phone) {
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: HANDOFF_FLOW,
        stateAfter: 'ASK_PHONE_IF_NEEDED',
        collectedJson: this.toCollectedJson(collected, bookingInterrupt),
        templateKey: 'handoff.ask_phone',
        intent: 'ask_human_agent',
      });
    }
    collected = { ...collected, patient_phone: phone };

    const [callback] = await this.repos.appointmentLifecycle.insertCallbackRequest({
      clinicId: input.session.clinicId,
      patientName: collected.patient_name ?? null,
      patientPhone: phone,
      reason: collected.reason ?? null,
      status: 'pending',
      sourceSessionId: input.session.id,
    });

    if (callback) {
      await this.staffNotification.notifyStaffActionRequest({
        clinicId: input.session.clinicId,
        eventType: 'staff.callback_request',
        templateKey: 'handoff.created',
        deduplicationKey: `callback:${input.session.id}:${callback.id}`,
        payload: {
          callback_request_id: callback.id,
          session_id: input.session.id,
          reason: collected.reason,
          patient_name: collected.patient_name,
          patient_phone: phone,
        },
      });
    }

    return this.result({
      input,
      flowBefore,
      stateBefore,
      flowAfter: 'none',
      stateAfter: 'DONE',
      collectedJson: {
        ...this.toCollectedJson(collected, bookingInterrupt),
        callback_request_id: callback?.id,
      },
      templateKey: 'handoff.created',
      intent: 'ask_human_agent',
      sessionStatus: 'completed',
    });
  }

  private toCollectedJson(
    collected: HandoffCollected,
    bookingInterrupt: ReturnType<typeof parseBookingInterrupt>,
  ): Record<string, unknown> {
    return attachBookingInterrupt(collected as Record<string, unknown>, bookingInterrupt);
  }

  private result(params: {
    input: HandoffMachineInput;
    flowBefore: string;
    stateBefore: string;
    flowAfter: string;
    stateAfter: string;
    collectedJson: Record<string, unknown>;
    templateKey: MessageTemplateKey;
    intent: string;
    sessionStatus?: 'active' | 'completed';
  }): HandoffMachineResult {
    return {
      intent: params.intent,
      templateKey: params.templateKey,
      templateVariables: { clinic_name: params.input.clinicName },
      flowBefore: params.flowBefore,
      stateBefore: params.stateBefore,
      flowAfter: params.flowAfter,
      stateAfter: params.stateAfter,
      collectedJson: params.collectedJson,
      ...(params.sessionStatus ? { sessionStatus: params.sessionStatus } : {}),
    };
  }
}
