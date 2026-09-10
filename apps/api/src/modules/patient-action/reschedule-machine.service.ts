import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type ConversationSessionRow, type Repositories } from '@vaidya/db';
import { ACTIVE_APPOINTMENT_STATUSES } from '@vaidya/db';
import {
  BOOKING_FLOW,
  RESCHEDULE_FLOW,
  attachActivePrompt,
  buildActivePromptSnapshot,
  type IntentClassifierResult,
  type MessageTemplateKey,
  type RescheduleCollected,
  isStateEntityNoRejection,
  isStateEntityYesConfirmation,
  parseRescheduleCollected,
} from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';
import { ActiveStateInterpretationService } from '../conversation/active-state-interpretation.service';
import {
  buildSideQuestionClassification,
  mapStateEntityToBookingFields,
} from '../conversation/state-entity-mapper';
import {
  filterSlotsByDateAndPreference,
  formatSlotList,
  formatTimeOptions,
  getAvailableTimePreferencesForDate,
  slotDisplayTime,
  slotMatchesTimeSelection,
} from '../booking/booking-field-extractor';
import type { ExtractedBookingFields } from '@vaidya/shared';
import { mapClassificationToBookingFields } from '@vaidya/shared';
import { TemplateRenderer } from '../conversation/template-renderer.service';
import { SlotHoldService } from '../slots/slot-hold.service';
import { SlotService } from '../slots/slot.service';
import {
  captureBookingInterrupt,
  parseBookingInterrupt,
  restoreBookingAfterFailedInterrupt,
} from '../structured-info/booking-resume.helper';
import { StructuredInfoHandler } from '../structured-info/structured-info-handler.service';

import { AppointmentLookupService } from './appointment-lookup.service';
import {
  formatAppointmentList,
  parseAppointmentSelection,
} from './lifecycle-field-extractor';
import { StaffNotificationService } from './staff-notification.service';

export type RescheduleMachineInput = {
  session: ConversationSessionRow;
  clinicName: string;
  messageText: string;
  classification: IntentClassifierResult;
};

export type RescheduleMachineResult = {
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
export class RescheduleMachineService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(AppointmentLookupService) private readonly appointmentLookup: AppointmentLookupService,
    @Inject(StaffNotificationService) private readonly staffNotification: StaffNotificationService,
    @Inject(SlotHoldService) private readonly slotHoldService: SlotHoldService,
    @Inject(SlotService) private readonly slotService: SlotService,
    @Inject(TemplateRenderer) private readonly templateRenderer: TemplateRenderer,
    @Inject(ActiveStateInterpretationService)
    private readonly activeStateService: ActiveStateInterpretationService,
    @Inject(StructuredInfoHandler)
    private readonly structuredInfoHandler: StructuredInfoHandler,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async handle(input: RescheduleMachineInput): Promise<RescheduleMachineResult> {
    const flowBefore = input.session.currentFlow;
    const stateBefore = input.session.currentState;
    const rawCollected = (input.session.collectedJson ?? {}) as Record<string, unknown>;
    let collected = parseRescheduleCollected(rawCollected);
    let bookingInterrupt = parseBookingInterrupt(rawCollected);
    const timezone = await this.getClinicTimezone(input.session.clinicId);

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
          offeredSlots: collected.proposed_slots?.map((slot) => ({
            slotId: slot.slot_id,
            startTime: slot.start_time,
            endTime: slot.end_time,
            displayTime: slot.display_time,
          })),
        })
      : null;

    if (
      flowBefore === RESCHEDULE_FLOW &&
      stateBefore !== 'IDLE' &&
      interpretation?.result.recognizedAs === 'side_question'
    ) {
      return this.handleActiveSideQuestion(
        input,
        flowBefore,
        stateBefore,
        collected,
        interpretation,
      );
    }

    if (
      flowBefore === RESCHEDULE_FLOW &&
      stateBefore !== 'IDLE' &&
      interpretation &&
      isStateEntityNoRejection(interpretation.result)
    ) {
      if (collected.hold_id) {
        try {
          await this.slotHoldService.releaseHold(input.session.clinicId, collected.hold_id);
        } catch {
          // Hold may already be released.
        }
      }
      await this.slotHoldService.releaseSessionHolds(input.session.clinicId, input.session.id);
      if (bookingInterrupt) {
        const restored = await restoreBookingAfterFailedInterrupt({
          templateRenderer: this.templateRenderer,
          languageCode: input.session.languageCode as 'ta_tanglish' | 'english',
          clinicName: input.clinicName,
          interrupt: bookingInterrupt,
          cancelTemplateKey: 'reschedule.not_changed',
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
        templateKey: 'reschedule.not_changed',
        intent: 'reschedule_appointment',
      });
    }

    if (flowBefore === BOOKING_FLOW) {
      await this.slotHoldService.releaseSessionHolds(input.session.clinicId, input.session.id);
      if (!bookingInterrupt) {
        bookingInterrupt = captureBookingInterrupt(flowBefore, stateBefore, rawCollected);
      }
    }

    if (this.shouldResetRescheduleScheduling(flowBefore, stateBefore)) {
      if (collected.hold_id) {
        try {
          await this.slotHoldService.releaseHold(input.session.clinicId, collected.hold_id);
        } catch {
          // Hold may already be released.
        }
      }
      collected = this.resetRescheduleSchedulingFields(collected);
    }

    if (collected.action_request_id) {
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: 'none',
        stateAfter: 'DONE',
        collectedJson: collected as Record<string, unknown>,
        templateKey: 'reschedule.request_submitted',
        intent: 'reschedule_appointment',
        sessionStatus: 'completed',
      });
    }

    const activeAppointment = await this.ensureAppointmentIsActive(
      input,
      flowBefore,
      stateBefore,
      collected,
    );
    if ('blocked' in activeAppointment) {
      return activeAppointment.blocked;
    }
    collected = activeAppointment.collected;

    if (
      stateBefore === 'CONFIRM_RESCHEDULE_REQUEST' &&
      interpretation &&
      isStateEntityYesConfirmation(interpretation.result) &&
      collected.selected_slot_id &&
      collected.preferred_date
    ) {
      return this.createRescheduleActionRequest(input, flowBefore, stateBefore, collected);
    }

    if (!collected.appointment_id) {
      const resolved = await this.resolveAppointment(input, flowBefore, stateBefore, collected);
      if ('blocked' in resolved) {
        return resolved.blocked;
      }
      collected = resolved.collected;
    }

    if (!collected.preferred_date) {
      const mapped =
        interpretation && stateBefore === 'ASK_NEW_DATE'
          ? mapStateEntityToBookingFields(interpretation.result)
          : mapClassificationToBookingFields(input.classification);
      let parsedDate = mapped.preferred_date;
      if (
        mapped.time_preference === 'morning' ||
        mapped.time_preference === 'afternoon' ||
        mapped.time_preference === 'evening'
      ) {
        collected = { ...collected, time_preference: mapped.time_preference };
      }
      if (!parsedDate) {
        return this.result({
          input,
          flowBefore,
          stateBefore,
          flowAfter: RESCHEDULE_FLOW,
          stateAfter: 'ASK_NEW_DATE',
          collectedJson: collected as Record<string, unknown>,
          templateKey: 'reschedule.ask_new_date',
          intent: 'reschedule_appointment',
        });
      }
      collected = { ...collected, preferred_date: parsedDate };
    }

    const preferredDate = collected.preferred_date;
    if (!preferredDate) {
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: RESCHEDULE_FLOW,
        stateAfter: 'ASK_NEW_DATE',
        collectedJson: collected as Record<string, unknown>,
        templateKey: 'reschedule.ask_new_date',
        intent: 'reschedule_appointment',
      });
    }

    const slots = await this.slotService.findAvailableSlots(
      input.session.clinicId,
      collected.doctor_id!,
      collected.clinic_service_id!,
    );
    const availablePreferences = getAvailableTimePreferencesForDate(slots, preferredDate);

    if (!collected.time_preference) {
      const mapped: ExtractedBookingFields =
        interpretation && stateBefore === 'ASK_NEW_TIME'
          ? mapStateEntityToBookingFields(interpretation.result)
          : mapClassificationToBookingFields(input.classification);
      let preference =
        mapped.time_preference === 'morning' ||
        mapped.time_preference === 'afternoon' ||
        mapped.time_preference === 'evening'
          ? mapped.time_preference
          : availablePreferences.length === 1
            ? availablePreferences[0]
            : undefined;
      if (mapped.selected_time && !mapped.time_preference) {
        collected = { ...collected, time_preference: 'evening' };
        preference = 'evening';
      }
      if (!preference) {
        return this.result({
          input,
          flowBefore,
          stateBefore,
          flowAfter: RESCHEDULE_FLOW,
          stateAfter: 'ASK_NEW_TIME',
          collectedJson: collected as Record<string, unknown>,
          templateKey: 'reschedule.ask_new_time',
          templateVariables: {
            time_options: formatTimeOptions(availablePreferences),
          },
          intent: 'reschedule_appointment',
        });
      }
      collected = { ...collected, time_preference: preference };
    }

    const filteredSlots = filterSlotsByDateAndPreference(
      slots,
      preferredDate,
      collected.time_preference,
    ).map((slot) => ({
      slot_id: slot.slot_id,
      start_time: slot.start_time,
      end_time: slot.end_time,
      display_time: slotDisplayTime(slot.start_time),
    }));

    if (!collected.selected_slot_id) {
      const slotMapped =
        interpretation?.result.recognizedAs === 'slot_selection' ||
        interpretation?.result.recognizedAs === 'time_answer'
          ? mapStateEntityToBookingFields(interpretation.result)
          : mapClassificationToBookingFields(input.classification);
      const matched = filteredSlots.find((slot) => {
        if (slotMapped.selected_slot_id) {
          return slot.slot_id === slotMapped.selected_slot_id;
        }
        if (slotMapped.selected_time) {
          return slotMatchesTimeSelection(
            slot.start_time,
            slotMapped.selected_time,
            collected.time_preference,
          );
        }
        return false;
      });
      if (!matched) {
        return this.result({
          input,
          flowBefore,
          stateBefore,
          flowAfter: RESCHEDULE_FLOW,
          stateAfter: 'PROPOSE_NEW_SLOTS',
          collectedJson: {
            ...collected,
            proposed_slots: filteredSlots,
          },
          templateKey: 'reschedule.propose_slots',
          templateVariables: {
            slot_list: formatSlotList(filteredSlots),
          },
          intent: 'reschedule_appointment',
        });
      }
      const hold = await this.slotHoldService.holdSlot({
        clinicId: input.session.clinicId,
        slotId: matched.slot_id,
        sessionId: input.session.id,
        ...(input.session.patientPhone ? { patientPhone: input.session.patientPhone } : {}),
      });
      collected = {
        ...collected,
        selected_slot_id: matched.slot_id,
        hold_id: hold.id,
        proposed_slots: filteredSlots,
      };
    }

    if (stateBefore !== 'CONFIRM_RESCHEDULE_REQUEST') {
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: RESCHEDULE_FLOW,
        stateAfter: 'CONFIRM_RESCHEDULE_REQUEST',
        collectedJson: collected as Record<string, unknown>,
        templateKey: 'reschedule.confirm',
        intent: 'reschedule_appointment',
      });
    }

    return this.createRescheduleActionRequest(input, flowBefore, stateBefore, collected);
  }

  private async resolveAppointment(
    input: RescheduleMachineInput,
    flowBefore: string,
    stateBefore: string,
    collected: RescheduleCollected,
  ): Promise<{ blocked: RescheduleMachineResult } | { collected: RescheduleCollected }> {
    let appointmentCandidates = collected.appointment_candidates;
    if (!appointmentCandidates || appointmentCandidates.length === 0) {
      appointmentCandidates = await this.appointmentLookup.listAppointmentCandidates(
        input.session.clinicId,
        input.session.patientPhone,
      );
      collected = { ...collected, appointment_candidates: appointmentCandidates };
    }

    if (appointmentCandidates.length === 0) {
      return {
        blocked: this.result({
          input,
          flowBefore,
          stateBefore,
          flowAfter: 'none',
          stateAfter: 'IDLE',
          collectedJson: {},
          templateKey: 'cancel.no_appointment_found',
          intent: 'reschedule_appointment',
        }),
      };
    }

    let appointmentId = collected.appointment_id;
    if (!appointmentId) {
      if (appointmentCandidates.length === 1) {
        appointmentId = appointmentCandidates[0]!.appointment_id;
      } else {
        appointmentId =
          parseAppointmentSelection(input.messageText, appointmentCandidates) ?? undefined;
        if (!appointmentId) {
          return {
            blocked: this.result({
              input,
              flowBefore,
              stateBefore,
              flowAfter: RESCHEDULE_FLOW,
              stateAfter: 'SELECT_APPOINTMENT_IF_MULTIPLE',
              collectedJson: collected as Record<string, unknown>,
              templateKey: 'cancel.select_appointment',
              templateVariables: {
                appointment_list: formatAppointmentList(appointmentCandidates),
              },
              intent: 'reschedule_appointment',
            }),
          };
        }
      }
    }

    const [appointment] = await this.repos.appointmentLifecycle.findAppointmentById(
      input.session.clinicId,
      appointmentId,
    );
    if (!appointment) {
      return {
        blocked: this.result({
          input,
          flowBefore,
          stateBefore,
          flowAfter: 'none',
          stateAfter: 'IDLE',
          collectedJson: {},
          templateKey: 'cancel.no_appointment_found',
          intent: 'reschedule_appointment',
        }),
      };
    }

    const doctors = await this.repos.clinical.listDoctors(input.session.clinicId);
    const doctor = doctors.find((row) => row.id === appointment.doctorId);

    return {
      collected: {
        ...collected,
        appointment_id: appointment.id,
        doctor_id: appointment.doctorId,
        doctor_name: doctor?.name,
        clinic_service_id: appointment.clinicServiceId,
      },
    };
  }

  private async createRescheduleActionRequest(
    input: RescheduleMachineInput,
    flowBefore: string,
    stateBefore: string,
    collected: RescheduleCollected,
  ): Promise<RescheduleMachineResult> {
    const appointmentId = collected.appointment_id;
    if (!appointmentId || !collected.selected_slot_id) {
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: 'none',
        stateAfter: 'IDLE',
        collectedJson: {},
        templateKey: 'reschedule.not_changed',
        intent: 'reschedule_appointment',
      });
    }

    const [appointment] = await this.repos.appointmentLifecycle.findAppointmentById(
      input.session.clinicId,
      appointmentId,
    );
    if (
      !appointment ||
      !ACTIVE_APPOINTMENT_STATUSES.includes(appointment.status as 'pending_confirmation' | 'confirmed')
    ) {
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: 'none',
        stateAfter: 'IDLE',
        collectedJson: {},
        templateKey: 'cancel.no_appointment_found',
        intent: 'reschedule_appointment',
      });
    }

    const existing = await this.repos.appointmentLifecycle.findPendingActionRequest({
      clinicId: input.session.clinicId,
      sessionId: input.session.id,
      appointmentId,
      requestType: 'reschedule',
    });
    if (existing[0]) {
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: 'none',
        stateAfter: 'DONE',
        collectedJson: {
          ...collected,
          action_request_id: existing[0].id,
        },
        templateKey: 'reschedule.request_submitted',
        intent: 'reschedule_appointment',
        sessionStatus: 'completed',
      });
    }

    const [actionRequest] = await this.repos.appointmentLifecycle.insertActionRequest({
      clinicId: input.session.clinicId,
      appointmentId,
      requestType: 'reschedule',
      requestedBy: 'patient_call',
      status: 'pending',
      requestedNewSlotId: collected.selected_slot_id,
      requestedNewDate: collected.preferred_date ?? null,
      requestedNewTimePreference: collected.time_preference ?? null,
      sourceSessionId: input.session.id,
    });

    if (actionRequest) {
      await this.staffNotification.notifyStaffActionRequest({
        clinicId: input.session.clinicId,
        eventType: 'staff.action_request',
        templateKey: 'reschedule.request_submitted',
        deduplicationKey: `reschedule:${input.session.id}:${appointmentId}`,
        payload: {
          action_request_id: actionRequest.id,
          appointment_id: appointmentId,
          request_type: 'reschedule',
          requested_new_slot_id: collected.selected_slot_id,
          session_id: input.session.id,
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
        ...collected,
        action_request_id: actionRequest?.id,
      },
      templateKey: 'reschedule.request_submitted',
      intent: 'reschedule_appointment',
      sessionStatus: 'completed',
    });
  }

  private async ensureAppointmentIsActive(
    input: RescheduleMachineInput,
    flowBefore: string,
    stateBefore: string,
    collected: RescheduleCollected,
  ): Promise<{ blocked: RescheduleMachineResult } | { collected: RescheduleCollected }> {
    const candidates = await this.appointmentLookup.listAppointmentCandidates(
      input.session.clinicId,
      input.session.patientPhone,
    );

    if (candidates.length === 0) {
      if (collected.hold_id) {
        try {
          await this.slotHoldService.releaseHold(input.session.clinicId, collected.hold_id);
        } catch {
          // Hold may already be released.
        }
      }
      await this.slotHoldService.releaseSessionHolds(input.session.clinicId, input.session.id);
      return {
        blocked: this.result({
          input,
          flowBefore,
          stateBefore,
          flowAfter: 'none',
          stateAfter: 'IDLE',
          collectedJson: {},
          templateKey: 'cancel.no_appointment_found',
          intent: 'reschedule_appointment',
        }),
      };
    }

    if (collected.appointment_id) {
      const stillActive = candidates.some(
        (candidate) => candidate.appointment_id === collected.appointment_id,
      );
      if (!stillActive) {
        if (collected.hold_id) {
          try {
            await this.slotHoldService.releaseHold(input.session.clinicId, collected.hold_id);
          } catch {
            // Hold may already be released.
          }
        }
        await this.slotHoldService.releaseSessionHolds(input.session.clinicId, input.session.id);
        return {
          blocked: this.result({
            input,
            flowBefore,
            stateBefore,
            flowAfter: 'none',
            stateAfter: 'IDLE',
            collectedJson: {},
            templateKey: 'cancel.no_appointment_found',
            intent: 'reschedule_appointment',
          }),
        };
      }
    }

    return {
      collected: {
        ...collected,
        appointment_candidates: candidates,
      },
    };
  }

  private shouldResetRescheduleScheduling(flowBefore: string, stateBefore: string): boolean {
    if (flowBefore !== RESCHEDULE_FLOW) {
      return true;
    }
    return stateBefore === 'IDLE' || stateBefore === 'DONE';
  }

  private resetRescheduleSchedulingFields(collected: RescheduleCollected): RescheduleCollected {
    return {
      appointment_candidates: collected.appointment_candidates,
      appointment_id: collected.appointment_id,
      doctor_id: collected.doctor_id,
      doctor_name: collected.doctor_name,
      clinic_service_id: collected.clinic_service_id,
      action_request_id: collected.action_request_id,
    };
  }

  private async getClinicTimezone(clinicId: string) {
    const [clinic] = await this.repos.clinics.getClinicLocation(clinicId);
    return clinic?.timezone ?? 'Asia/Kolkata';
  }

  private async handleActiveSideQuestion(
    input: RescheduleMachineInput,
    flowBefore: string,
    stateBefore: string,
    collected: RescheduleCollected,
    interpretation: NonNullable<
      Awaited<ReturnType<ActiveStateInterpretationService['interpret']>>
    >,
  ): Promise<RescheduleMachineResult> {
    const structuredResult = await this.structuredInfoHandler.handle({
      session: input.session,
      messageText: input.messageText,
      classification: buildSideQuestionClassification(
        interpretation.result,
        input.messageText,
        input.session.languageCode,
      ),
    });

    return {
      intent: structuredResult.intent,
      templateKey: structuredResult.templateKey,
      templateVariables: structuredResult.templateVariables,
      flowBefore: structuredResult.flowBefore,
      stateBefore: structuredResult.stateBefore,
      flowAfter: structuredResult.flowAfter,
      stateAfter: structuredResult.stateAfter,
      collectedJson: attachActivePrompt(
        structuredResult.collectedJson,
        buildActivePromptSnapshot(stateBefore, structuredResult.templateKey),
      ),
    };
  }

  private result(params: {
    input: RescheduleMachineInput;
    flowBefore: string;
    stateBefore: string;
    flowAfter: string;
    stateAfter: string;
    collectedJson: Record<string, unknown>;
    templateKey: MessageTemplateKey;
    templateVariables?: Record<string, string>;
    intent: string;
    sessionStatus?: 'active' | 'completed';
  }): RescheduleMachineResult {
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
