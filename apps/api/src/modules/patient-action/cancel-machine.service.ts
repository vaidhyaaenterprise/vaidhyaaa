import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type ConversationSessionRow, type Repositories } from '@vaidya/db';
import { ACTIVE_APPOINTMENT_STATUSES } from '@vaidya/db';
import {
  BOOKING_FLOW,
  CANCEL_FLOW,
  type CancelCollected,
  type IntentClassifierResult,
  isStateEntityNoRejection,
  isStateEntityYesConfirmation,
  type MessageTemplateKey,
  parseCancelCollected,
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

import { AppointmentLookupService } from './appointment-lookup.service';
import { formatAppointmentList, parseAppointmentSelection } from './lifecycle-field-extractor';
import { StaffNotificationService } from './staff-notification.service';

export type CancelMachineInput = {
  session: ConversationSessionRow;
  clinicName: string;
  messageText: string;
  classification: IntentClassifierResult;
};

export type CancelMachineResult = {
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
export class CancelMachineService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(AppointmentLookupService) private readonly appointmentLookup: AppointmentLookupService,
    @Inject(StaffNotificationService) private readonly staffNotification: StaffNotificationService,
    @Inject(SlotHoldService) private readonly slotHoldService: SlotHoldService,
    @Inject(TemplateRenderer) private readonly templateRenderer: TemplateRenderer,
    @Inject(ActiveStateInterpretationService)
    private readonly activeStateService: ActiveStateInterpretationService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async handle(input: CancelMachineInput): Promise<CancelMachineResult> {
    const flowBefore = input.session.currentFlow;
    const stateBefore = input.session.currentState;
    const rawCollected = (input.session.collectedJson ?? {}) as Record<string, unknown>;
    let collected = parseCancelCollected(rawCollected);
    let bookingInterrupt = parseBookingInterrupt(rawCollected);
    const timezone = 'Asia/Kolkata';

    const interpretation = this.activeStateService.shouldInterpret(
      flowBefore,
      stateBefore,
      rawCollected,
    )
      ? await this.activeStateService.interpret({
          clinicId: input.session.clinicId,
          sessionId: input.session.id,
          currentFlow: flowBefore,
          currentState: stateBefore,
          languageCode: input.session.languageCode,
          messageText: input.messageText,
          timezone,
          collected: collected as Record<string, unknown>,
          channel: input.session.channel,
        })
      : null;

    if (
      flowBefore === CANCEL_FLOW &&
      stateBefore !== 'IDLE' &&
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
          cancelTemplateKey: 'cancel.not_cancelled',
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
        templateKey: 'cancel.not_cancelled',
        intent: 'cancel_appointment',
      });
    }

    if (flowBefore === BOOKING_FLOW) {
      await this.slotHoldService.releaseSessionHolds(input.session.clinicId, input.session.id);
      if (!bookingInterrupt) {
        bookingInterrupt = captureBookingInterrupt(flowBefore, stateBefore, rawCollected);
      }
    }

    if (collected.cancelled_appointment_id) {
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: 'none',
        stateAfter: 'DONE',
        collectedJson: collected as Record<string, unknown>,
        templateKey: 'cancel.completed',
        intent: 'cancel_appointment',
      });
    }

    if (stateBefore === 'CONFIRM_CANCEL_REQUEST' && interpretation) {
      if (isStateEntityYesConfirmation(interpretation.result)) {
        return this.executeCancel(input, flowBefore, stateBefore, collected);
      }
      if (isStateEntityNoRejection(interpretation.result)) {
        await this.slotHoldService.releaseSessionHolds(input.session.clinicId, input.session.id);
        if (bookingInterrupt) {
          const restored = await restoreBookingAfterFailedInterrupt({
            templateRenderer: this.templateRenderer,
            languageCode: input.session.languageCode as 'ta_tanglish' | 'english',
            clinicName: input.clinicName,
            interrupt: bookingInterrupt,
            cancelTemplateKey: 'cancel.not_cancelled',
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
          templateKey: 'cancel.not_cancelled',
          intent: 'cancel_appointment',
        });
      }

      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: CANCEL_FLOW,
        stateAfter: 'CONFIRM_CANCEL_REQUEST',
        collectedJson: this.withInterrupt(collected, bookingInterrupt),
        templateKey: 'cancel.confirm',
        intent: 'cancel_appointment',
      });
    }

    if (stateBefore === 'SELECT_APPOINTMENT_IF_MULTIPLE') {
      const appointmentId = parseAppointmentSelection(
        input.messageText,
        collected.appointment_candidates ?? [],
      );
      if (!appointmentId) {
        return this.result({
          input,
          flowBefore,
          stateBefore,
          flowAfter: CANCEL_FLOW,
          stateAfter: 'SELECT_APPOINTMENT_IF_MULTIPLE',
          collectedJson: this.withInterrupt(collected, bookingInterrupt),
          templateKey: 'cancel.select_appointment',
          templateVariables: {
            appointment_list: formatAppointmentList(collected.appointment_candidates ?? []),
          },
          intent: 'cancel_appointment',
        });
      }
      collected = { ...collected, appointment_id: appointmentId };
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: CANCEL_FLOW,
        stateAfter: 'CONFIRM_CANCEL_REQUEST',
        collectedJson: this.withInterrupt(collected, bookingInterrupt),
        templateKey: 'cancel.confirm',
        intent: 'cancel_appointment',
      });
    }

    return this.startOrContinue(input, flowBefore, stateBefore, collected, bookingInterrupt);
  }

  private async startOrContinue(
    input: CancelMachineInput,
    flowBefore: string,
    stateBefore: string,
    collected: CancelCollected,
    bookingInterrupt: ReturnType<typeof parseBookingInterrupt>,
  ): Promise<CancelMachineResult> {
    let appointmentCandidates = collected.appointment_candidates;
    if (!appointmentCandidates || appointmentCandidates.length === 0) {
      appointmentCandidates = await this.appointmentLookup.listAppointmentCandidates(
        input.session.clinicId,
        input.session.patientPhone,
      );
      collected = { ...collected, appointment_candidates: appointmentCandidates };
    }

    if (appointmentCandidates.length === 0) {
      if (bookingInterrupt) {
        const restored = await restoreBookingAfterFailedInterrupt({
          templateRenderer: this.templateRenderer,
          languageCode: input.session.languageCode as 'ta_tanglish' | 'english',
          clinicName: input.clinicName,
          interrupt: bookingInterrupt,
          cancelTemplateKey: 'cancel.no_appointment_found',
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
          sessionStatus: 'active',
        };
      }

      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: 'none',
        stateAfter: 'IDLE',
        collectedJson: {},
        templateKey: 'cancel.no_appointment_found',
        intent: 'cancel_appointment',
        sessionStatus: 'active',
      });
    }

    if (appointmentCandidates.length === 1) {
      collected = {
        ...collected,
        appointment_id: appointmentCandidates[0]!.appointment_id,
      };
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: CANCEL_FLOW,
        stateAfter: 'CONFIRM_CANCEL_REQUEST',
        collectedJson: this.withInterrupt(collected, bookingInterrupt),
        templateKey: 'cancel.confirm',
        intent: 'cancel_appointment',
      });
    }

    const selected = collected.appointment_id
      ? collected.appointment_id
      : parseAppointmentSelection(input.messageText, appointmentCandidates);
    if (selected) {
      collected = { ...collected, appointment_id: selected };
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: CANCEL_FLOW,
        stateAfter: 'CONFIRM_CANCEL_REQUEST',
        collectedJson: this.withInterrupt(collected, bookingInterrupt),
        templateKey: 'cancel.confirm',
        intent: 'cancel_appointment',
      });
    }

    return this.result({
      input,
      flowBefore,
      stateBefore,
      flowAfter: CANCEL_FLOW,
      stateAfter: 'SELECT_APPOINTMENT_IF_MULTIPLE',
      collectedJson: this.withInterrupt(collected, bookingInterrupt),
      templateKey: 'cancel.select_appointment',
      templateVariables: {
        appointment_list: formatAppointmentList(appointmentCandidates),
      },
      intent: 'cancel_appointment',
    });
  }

  private async executeCancel(
    input: CancelMachineInput,
    flowBefore: string,
    stateBefore: string,
    collected: CancelCollected,
  ): Promise<CancelMachineResult> {
    const appointmentId = collected.appointment_id;
    if (!appointmentId) {
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: 'none',
        stateAfter: 'IDLE',
        collectedJson: {},
        templateKey: 'cancel.no_appointment_found',
        intent: 'cancel_appointment',
      });
    }

    const [appointment] = await this.repos.appointmentLifecycle.findAppointmentById(
      input.session.clinicId,
      appointmentId,
    );
    if (!appointment) {
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: 'none',
        stateAfter: 'IDLE',
        collectedJson: {},
        templateKey: 'cancel.no_appointment_found',
        intent: 'cancel_appointment',
      });
    }

    if (appointment.status === 'cancelled') {
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: 'none',
        stateAfter: 'DONE',
        collectedJson: {
          ...collected,
          cancelled_appointment_id: appointmentId,
        },
        templateKey: 'cancel.completed',
        intent: 'cancel_appointment',
      });
    }

    if (!ACTIVE_APPOINTMENT_STATUSES.includes(appointment.status as 'pending_confirmation' | 'confirmed')) {
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: 'none',
        stateAfter: 'IDLE',
        collectedJson: {},
        templateKey: 'cancel.no_appointment_found',
        intent: 'cancel_appointment',
      });
    }

    await this.slotHoldService.cancelAppointment(input.session.clinicId, appointmentId);

    await this.repos.appointmentLifecycle.rejectPendingActionRequestsForAppointment(
      input.session.clinicId,
      appointmentId,
    );

    await this.staffNotification.notifyStaffActionRequest({
      clinicId: input.session.clinicId,
      eventType: 'appointment.cancelled',
      templateKey: 'cancel.completed',
      deduplicationKey: `cancel:${input.session.id}:${appointmentId}`,
      payload: {
        appointment_id: appointmentId,
        session_id: input.session.id,
        cancelled_by: 'patient_call',
        patient_phone: input.session.patientPhone,
      },
    });

    return this.result({
      input,
      flowBefore,
      stateBefore,
      flowAfter: 'none',
      stateAfter: 'DONE',
      collectedJson: {
        ...collected,
        cancelled_appointment_id: appointmentId,
      },
      templateKey: 'cancel.completed',
      intent: 'cancel_appointment',
      sessionStatus: 'active',
    });
  }

  private withInterrupt(
    collected: CancelCollected,
    bookingInterrupt: ReturnType<typeof parseBookingInterrupt>,
  ): Record<string, unknown> {
    return attachBookingInterrupt(collected as Record<string, unknown>, bookingInterrupt);
  }

  private result(params: {
    input: CancelMachineInput;
    flowBefore: string;
    stateBefore: string;
    flowAfter: string;
    stateAfter: string;
    collectedJson: Record<string, unknown>;
    templateKey: MessageTemplateKey;
    templateVariables?: Record<string, string>;
    intent: string;
    sessionStatus?: 'active' | 'completed';
  }): CancelMachineResult {
    return {
      intent: params.intent,
      templateKey: params.templateKey,
      templateVariables: {
        clinic_name: params.input.clinicName,
        ...(params.templateVariables ?? {}),
      },
      flowBefore: params.flowBefore,
      stateBefore: params.stateBefore,
      flowAfter: params.flowAfter,
      stateAfter: params.stateAfter,
      collectedJson: params.collectedJson,
      ...(params.sessionStatus ? { sessionStatus: params.sessionStatus } : {}),
    };
  }
}
