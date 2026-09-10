import { Inject, Injectable } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import { createRepositories, formatDateInTimezone, type ConversationSessionRow, type Repositories } from '@vaidya/db';
import {
  ADAPTER_TOKENS,
  AppError,
  BOOKING_FLOW,
  type ActiveClinicServiceProfile,
  type BookingCollected,
  extractActivePreferredDate,
  type IntentClassifierResult,
  type MessageTemplateKey,
  type ServiceRouterAdapter,
  applyReasonForVisitUpdate,
  attachActivePrompt,
  buildActivePromptSnapshot,
  normalizeAppointmentRoutingSource,
  buildServiceRouterMemoryCacheKey,
  isStateEntityNoRejection,
  enrichExtractedForBookingState,
  hasBookingProgress as collectedHasBookingProgress,
  inferBookingState,
  lookupServiceRouterCache,
  lookupServiceRouterMemoryCache,
  parseBookingCollected,
  readAwaitingTerminalAck,
  resolveLlmRuntimeSettings,
  resolveTerminalAckOutcome,
  storeServiceRouterCacheEntry,
  storeServiceRouterMemoryCache,
  resumeBookingSession,
  type ServiceRouterRouteOutcome,
} from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { API_ENV } from '../../config/api-config.module';
import { DATABASE_CONNECTION } from '../database/database.module';
import { ActiveStateInterpretationService } from '../conversation/active-state-interpretation.service';
import { TemplateRenderer } from '../conversation/template-renderer.service';
import {
  buildSideQuestionClassification,
  mapStateEntityToBookingFields,
} from '../conversation/state-entity-mapper';
import { StructuredInfoHandler } from '../structured-info/structured-info-handler.service';
import { SlotHoldExpiryService } from '../slots/slot-hold-expiry.service';
import { SlotHoldService } from '../slots/slot-hold.service';
import { SlotService } from '../slots/slot.service';
import { appendBookingResumeText, parseBookingInterrupt } from '../structured-info/booking-resume.helper';

import { BookingAppointmentService } from './booking-appointment.service';
import {
  applyExtractedToCollected,
  filterSlotsByDateAndPreference,
  formatDateDisplay,
  formatSlotList,
  formatTimeOptions,
  getAvailableTimePreferencesForDate,
  mergeCollected,
  slotDisplayTime,
  slotMatchesTimeSelection,
} from './booking-field-extractor';
import type { ExtractedBookingFields } from '@vaidya/shared';
import {
  mapClassificationToBookingFields,
  mergeExtractedBookingFields,
} from '@vaidya/shared';
import { PatientVisitService } from './patient-visit.service';

export type BookingMachineInput = {
  session: ConversationSessionRow;
  clinicName: string;
  messageText: string;
  classification: IntentClassifierResult;
  llmRuntime?: import('@vaidya/shared').LlmRuntimeSettings;
  lastAssistantMessageText?: string | null;
  lastAssistantTemplateKey?: string | null;
  recentTurns?: import('@vaidya/shared').ReceptionistConversationTurn[];
};

export type BookingMachineResult = {
  intent: string;
  templateKey: MessageTemplateKey;
  templateVariables: Record<string, string>;
  flowBefore: string;
  stateBefore: string;
  flowAfter: string;
  stateAfter: string;
  collectedJson: Record<string, unknown>;
  sessionStatus?: 'active' | 'completed' | 'escalated';
  debug?: Record<string, unknown>;
};

@Injectable()
export class BookingMachine {
  private readonly repos: Repositories;
  private currentInterpretationDebug?: Record<string, unknown>;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(SlotService) private readonly slotService: SlotService,
    @Inject(SlotHoldService) private readonly slotHoldService: SlotHoldService,
    @Inject(SlotHoldExpiryService) private readonly slotHoldExpiryService: SlotHoldExpiryService,
    @Inject(BookingAppointmentService) private readonly appointmentService: BookingAppointmentService,
    @Inject(PatientVisitService) private readonly patientVisitService: PatientVisitService,
    @Inject(ADAPTER_TOKENS.ServiceRouterAdapter)
    private readonly serviceRouter: ServiceRouterAdapter,
    @Inject(ActiveStateInterpretationService)
    private readonly activeStateService: ActiveStateInterpretationService,
    @Inject(StructuredInfoHandler)
    private readonly structuredInfoHandler: StructuredInfoHandler,
    @Inject(TemplateRenderer) private readonly templateRenderer: TemplateRenderer,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async handle(input: BookingMachineInput): Promise<BookingMachineResult> {
    delete this.currentInterpretationDebug;
    input = {
      ...input,
      session: resumeBookingSession(input.session),
    };
    const flowBefore = input.session.currentFlow;
    const stateBefore = input.session.currentState;
    const rawCollected = (input.session.collectedJson ?? {}) as Record<string, unknown>;
    const bookingInterrupt = parseBookingInterrupt(rawCollected);
    let collected = parseBookingCollected(rawCollected);
    if (
      flowBefore === BOOKING_FLOW &&
      bookingInterrupt &&
      !collected.doctor_id &&
      !collected.reason_for_visit
    ) {
      collected = parseBookingCollected(bookingInterrupt.collected);
    }
    const terminalAck = readAwaitingTerminalAck(collected) ?? readAwaitingTerminalAck(rawCollected);
    const timezone = await this.getClinicTimezone(input.session.clinicId);
    const referenceDate = formatDateInTimezone(new Date(), timezone);

    const shouldInterpret = this.activeStateService.shouldInterpret(
      flowBefore,
      stateBefore,
      rawCollected,
    );
    const interpretation =
      terminalAck || shouldInterpret
        ? await this.activeStateService.interpret({
            clinicId: input.session.clinicId,
            sessionId: input.session.id,
            currentFlow: flowBefore,
            currentState: stateBefore,
            languageCode: input.session.languageCode,
            messageText: input.messageText,
            timezone,
            collected: rawCollected,
            channel: input.session.channel,
            ...(input.llmRuntime ? { llmRuntime: input.llmRuntime } : {}),
            ...(input.lastAssistantMessageText
              ? { lastAssistantMessageText: input.lastAssistantMessageText }
              : {}),
            ...(input.lastAssistantTemplateKey
              ? { lastAssistantTemplateKey: input.lastAssistantTemplateKey }
              : {}),
            ...(input.recentTurns?.length ? { recentTurns: input.recentTurns } : {}),
            offeredSlots: collected.proposed_slots?.map((slot) => ({
              slotId: slot.slot_id,
              startTime: slot.start_time,
              endTime: slot.end_time,
              displayTime: slot.display_time,
            })),
          })
        : null;

    if (terminalAck && interpretation) {
      const outcome = resolveTerminalAckOutcome(terminalAck, interpretation.result);
      if (outcome.kind === 'offer_help') {
        return this.result({
          input,
          flowBefore,
          stateBefore,
          flowAfter: 'none',
          stateAfter: 'IDLE',
          collectedJson: { awaiting_terminal_ack: 'offer_help' },
          templateKey: 'booking.offer_help',
          templateVariables: { clinic_name: input.clinicName },
          intent: 'acknowledgment',
          sessionStatus: 'active',
        });
      }
      if (outcome.kind === 'thank_you') {
        return this.result({
          input,
          flowBefore,
          stateBefore,
          flowAfter: 'none',
          stateAfter: 'IDLE',
          collectedJson: {},
          templateKey: 'booking.thank_you',
          templateVariables: { clinic_name: input.clinicName },
          intent: 'acknowledgment',
          sessionStatus: 'completed',
        });
      }
      if (outcome.kind === 'ask_what_help') {
        return this.result({
          input,
          flowBefore,
          stateBefore,
          flowAfter: 'none',
          stateAfter: 'IDLE',
          collectedJson: { awaiting_terminal_ack: 'awaiting_help_topic' },
          templateKey: 'booking.ask_what_help',
          templateVariables: { clinic_name: input.clinicName },
          intent: 'acknowledgment',
          sessionStatus: 'active',
        });
      }
      if (outcome.kind === 'greeting') {
        return this.result({
          input,
          flowBefore,
          stateBefore,
          flowAfter: 'none',
          stateAfter: 'IDLE',
          collectedJson: {},
          templateKey: 'booking.greeting',
          templateVariables: { clinic_name: input.clinicName },
          intent: 'book_appointment',
          sessionStatus: 'active',
        });
      }
    }

    let extracted: ExtractedBookingFields;
    let activeInterpretationDebug: Record<string, unknown> | undefined;

    if (shouldInterpret && interpretation) {
      activeInterpretationDebug = {
        ...interpretation.debug,
        generic_classifier_called: false,
      };
      this.currentInterpretationDebug = activeInterpretationDebug;

      if (interpretation.result.recognizedAs === 'side_question') {
        return this.handleActiveSideQuestion(
          input,
          flowBefore,
          stateBefore,
          collected,
          interpretation,
        );
      }

      if (interpretation.result.recognizedAs === 'scope_redirect') {
        return this.handleActiveScopeRedirect(
          input,
          flowBefore,
          stateBefore,
          collected,
          interpretation,
        );
      }

      extracted = mergeExtractedBookingFields(
        mapClassificationToBookingFields(input.classification),
        mapStateEntityToBookingFields(interpretation.result),
      );
      if (interpretation.result.entities.selectedSlotId && collected.proposed_slots) {
        const selected = collected.proposed_slots.find(
          (slot) => slot.slot_id === interpretation.result.entities.selectedSlotId,
        );
        if (selected) {
          extracted.selected_slot_id = selected.slot_id;
          extracted.selected_time = slotDisplayTime(selected.start_time);
        }
      }
    } else {
      extracted = mapClassificationToBookingFields(input.classification);
    }

    extracted = enrichExtractedForBookingState({
      stateBefore,
      collected,
      extracted,
      messageText: input.messageText,
      referenceDate,
    });

    if (
      shouldInterpret &&
      interpretation &&
      interpretation.result.needsClarification &&
      stateBefore === 'PROPOSE_SLOTS' &&
      !extracted.selected_slot_id
    ) {
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: BOOKING_FLOW,
        stateAfter: 'PROPOSE_SLOTS',
        collectedJson: collected,
        templateKey: 'booking.propose_slots',
        templateVariables: {
          clinic_name: input.clinicName,
          doctor_name: collected.doctor_name ?? 'Doctor',
          date_display: formatDateDisplay(collected.preferred_date ?? ''),
          slot_list: formatSlotList(collected.proposed_slots ?? []),
        },
        intent: 'book_appointment',
        ...(activeInterpretationDebug ? { interpretationDebug: activeInterpretationDebug } : {}),
      });
    }

    const hasBookingProgress = collectedHasBookingProgress(collected);

    if (
      flowBefore === BOOKING_FLOW &&
      interpretation &&
      isStateEntityNoRejection(interpretation.result)
    ) {
      if (!hasBookingProgress) {
        return this.result({
          input,
          flowBefore,
          stateBefore,
          flowAfter: 'none',
          stateAfter: 'IDLE',
          collectedJson: {},
          templateKey: 'booking.thank_you',
          templateVariables: { clinic_name: input.clinicName },
          intent: 'acknowledgment',
          sessionStatus: 'completed',
        });
      }

      await this.slotHoldService.releaseSessionHolds(input.session.clinicId, input.session.id);
      if (collected.hold_id) {
        try {
          await this.slotHoldService.releaseHold(input.session.clinicId, collected.hold_id);
        } catch {
          // Hold may already be released/expired.
        }
      }
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: 'none',
        stateAfter: 'IDLE',
        collectedJson: {},
        templateKey: 'booking.flow_cancelled',
        templateVariables: { clinic_name: input.clinicName },
        intent: 'cancel_booking',
        sessionStatus: 'active',
      });
    }

    if (flowBefore !== BOOKING_FLOW) {
      if (collectedHasBookingProgress(collected)) {
        return this.handle({
          ...input,
          session: {
            ...input.session,
            currentFlow: BOOKING_FLOW,
            currentState: inferBookingState(collected),
            collectedJson: collected,
          },
        });
      }
      collected = mergeCollected({}, extracted);
      return this.advanceFromStart(input, flowBefore, stateBefore, collected, extracted);
    }

    collected = mergeCollected(collected, extracted);
    await this.applyReturningPatientContext(input, collected, extracted);

    if (
      stateBefore === 'ASK_DATE' &&
      collected.reason_for_visit &&
      !collected.preferred_date
    ) {
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: BOOKING_FLOW,
        stateAfter: 'ASK_DATE',
        collectedJson: collected,
        templateKey: 'booking.ask_date',
        templateVariables: { clinic_name: input.clinicName },
        intent: 'book_appointment',
      });
    }

    const isAlternateRecovery =
      collected.awaiting_alternate_slot || stateBefore === 'ASK_ALTERNATE_TIME';

    if (isAlternateRecovery) {
      collected = applyExtractedToCollected(collected, extracted);
      if (extracted.reason_for_visit) {
        collected = applyReasonForVisitUpdate(collected, extracted.reason_for_visit);
      }
    } else if (extracted.preferred_date && !extracted.time_preference && !extracted.selected_time) {
      collected = await this.applyPreferredDateChange(input, collected, extracted);
    }

    if (collected.pending_patient_candidates?.length) {
      const identityResult = await this.resolvePatientIdentity(
        input,
        flowBefore,
        stateBefore,
        collected,
      );
      if (identityResult) {
        return identityResult;
      }
    }

    if (stateBefore === 'ASK_REASON') {
      if (extracted.reason_for_visit) {
        collected = applyReasonForVisitUpdate(collected, extracted.reason_for_visit);
      } else {
        return this.result({
          input,
          flowBefore,
          stateBefore,
          flowAfter: BOOKING_FLOW,
          stateAfter: 'ASK_REASON',
          collectedJson: collected,
          templateKey: 'booking.ask_reason',
          templateVariables: { clinic_name: input.clinicName },
          intent: 'book_appointment',
        });
      }
    }

    if (!collected.reason_for_visit && !collected.doctor_id) {
      if (extracted.reason_for_visit) {
        collected = applyReasonForVisitUpdate(collected, extracted.reason_for_visit);
      } else if (extracted.doctor_name_fragment) {
        return this.selectDoctorByName(input, flowBefore, stateBefore, collected, extracted.doctor_name_fragment);
      } else if (input.classification.entities.doctorName) {
        return this.selectDoctorByName(
          input,
          flowBefore,
          stateBefore,
          collected,
          input.classification.entities.doctorName.toLowerCase(),
        );
      } else if (collected.preferred_date) {
        return this.result({
          input,
          flowBefore,
          stateBefore,
          flowAfter: BOOKING_FLOW,
          stateAfter: 'ASK_REASON',
          collectedJson: collected,
          templateKey: 'booking.ask_reason',
          templateVariables: { clinic_name: input.clinicName },
          intent: 'book_appointment',
        });
      } else {
        if (extracted.patient_name ?? input.classification.entities.patientName) {
          collected.patient_name =
            extracted.patient_name ?? input.classification.entities.patientName ?? undefined;
        } else {
          return this.result({
            input,
            flowBefore,
            stateBefore,
            flowAfter: BOOKING_FLOW,
            stateAfter: 'ASK_PROBLEM_OR_DOCTOR',
            collectedJson: collected,
            templateKey: 'booking.ask_problem_or_doctor',
            templateVariables: { clinic_name: input.clinicName },
            intent: 'book_appointment',
          });
        }
      }
    }

    if (collected.doctor_id && !collected.reason_for_visit) {
      if (extracted.reason_for_visit) {
        collected = applyReasonForVisitUpdate(collected, extracted.reason_for_visit);
      } else {
        return this.result({
          input,
          flowBefore,
          stateBefore,
          flowAfter: BOOKING_FLOW,
          stateAfter: 'ASK_REASON',
          collectedJson: collected,
          templateKey: 'booking.ask_reason',
          templateVariables: { clinic_name: input.clinicName },
          intent: 'book_appointment',
        });
      }
    }

    if (collected.reason_for_visit && !collected.clinic_service_id) {
      const routed = await this.routeService(input, collected);
      if (routed.result.unsupportedReason === 'red_flag_emergency') {
        return this.redFlagEmergencyResult(input, flowBefore, stateBefore);
      }
      if (routed.result.needsClarification) {
        return this.serviceClarificationResult(
          input,
          flowBefore,
          stateBefore,
          collected,
          routed.result.clarificationQuestion,
        );
      }
      if (!routed.result.matched || !routed.result.clinicServiceId) {
        return this.unsupportedServiceResult(input, flowBefore, stateBefore);
      }
      collected.clinic_service_id = routed.result.clinicServiceId;
      collected.routing_source =
        routed.fromCache || collected.routing_source === 'service_router_cache'
          ? 'service_router_cache'
          : 'service_router';
    }

    if (!collected.doctor_id && collected.clinic_service_id) {
      const doctorResult = await this.selectDoctor(input, flowBefore, stateBefore, collected);
      if (doctorResult) {
        return doctorResult;
      }
    }

    const dateTimeResult = await this.resolveDateAndTimeStep(
      input,
      flowBefore,
      stateBefore,
      collected,
      extracted,
      timezone,
    );
    if (dateTimeResult) {
      return dateTimeResult;
    }

    if (!collected.hold_id) {
      const slotResult = await this.proposeOrHoldSlot(
        input,
        flowBefore,
        stateBefore,
        collected,
        extracted,
      );
      return slotResult;
    }

    if (collected.hold_id && extracted.selected_time) {
      const currentSlot = collected.proposed_slots?.find(
        (slot) => slot.slot_id === collected.selected_slot_id,
      );
      const sameSlot =
        currentSlot &&
        slotMatchesTimeSelection(
          currentSlot.start_time,
          extracted.selected_time,
          collected.time_preference,
        );
      if (!sameSlot) {
        delete collected.hold_id;
        delete collected.selected_slot_id;
        return this.proposeOrHoldSlot(input, flowBefore, stateBefore, collected, extracted);
      }
    }

    if (collected.hold_id) {
      if (
        !collected.patient_name &&
        stateBefore === 'ASK_PATIENT_NAME' &&
        extracted.selected_time
      ) {
        delete collected.hold_id;
        delete collected.selected_slot_id;
        return this.proposeOrHoldSlot(input, flowBefore, stateBefore, collected, extracted);
      }

      if (!collected.patient_name) {
        const patientName = extracted.patient_name ?? input.classification.entities.patientName;
        if (patientName) {
          collected.patient_name = patientName;
        } else {
          return this.result({
            input,
            flowBefore,
            stateBefore,
            flowAfter: BOOKING_FLOW,
            stateAfter: 'ASK_PATIENT_NAME',
            collectedJson: collected,
            templateKey: 'booking.ask_patient_name',
            templateVariables: { clinic_name: input.clinicName },
            intent: 'book_appointment',
          });
        }
      }

      if (!collected.appointment_id) {
        const inConfirmState =
          stateBefore === 'CONFIRM_DOCTOR' || stateBefore === 'CONFIRM_DETAILS';
        if (inConfirmState && extracted.confirmation === 'yes') {
          return this.tryCreateAppointment(input, flowBefore, stateBefore, collected);
        }
        if (inConfirmState && extracted.confirmation === 'no') {
          await this.slotHoldService.releaseSessionHolds(input.session.clinicId, input.session.id);
          if (collected.hold_id) {
            try {
              await this.slotHoldService.releaseHold(input.session.clinicId, collected.hold_id);
            } catch {
              // Hold may already be released/expired.
            }
          }
          return this.result({
            input,
            flowBefore,
            stateBefore,
            flowAfter: 'none',
            stateAfter: 'IDLE',
            collectedJson: {},
            templateKey: 'booking.flow_cancelled',
            templateVariables: { clinic_name: input.clinicName },
            intent: 'cancel_booking',
            sessionStatus: 'active',
          });
        }
        return this.promptDoctorConfirmation(input, flowBefore, stateBefore, collected);
      }
    }

    return this.result({
      input,
      flowBefore,
      stateBefore,
      flowAfter: BOOKING_FLOW,
      stateAfter: 'DONE',
      collectedJson: collected,
      templateKey: 'booking.created_pending',
      templateVariables: { clinic_name: input.clinicName },
      intent: 'book_appointment',
      sessionStatus: 'completed',
    });
  }

  private async applyReturningPatientContext(
    input: BookingMachineInput,
    collected: BookingCollected,
    extracted: ExtractedBookingFields,
  ): Promise<void> {
    if (!input.session.patientPhone || collected.patient_id) {
      return;
    }

    const returning = await this.patientVisitService.findReturningPatientMatch({
      clinicId: input.session.clinicId,
      patientPhone: input.session.patientPhone,
      reasonForVisit: collected.reason_for_visit ?? extracted.reason_for_visit ?? null,
      patientName: collected.patient_name ?? null,
      isFollowup: collected.is_followup ?? extracted.is_followup ?? false,
    });

    if (!returning || returning.needsPatientIdentity) {
      if (returning?.needsPatientIdentity) {
        collected.pending_patient_candidates = returning.candidatePatients;
      }
      return;
    }

    collected.patient_id = returning.patientId;
    if (!collected.patient_name) {
      collected.patient_name = returning.patientName;
    }

    if (!collected.doctor_id && returning.previousDoctorId && returning.previousClinicServiceId) {
      const [mapping] = await this.repos.clinical.isDoctorMappedToService(
        input.session.clinicId,
        returning.previousDoctorId,
        returning.previousClinicServiceId,
      );
      const doctors = await this.repos.clinical.listDoctors(input.session.clinicId);
      const previousDoctor = doctors.find((doctor) => doctor.id === returning.previousDoctorId);
      if (mapping && previousDoctor?.active) {
        collected.doctor_id = returning.previousDoctorId;
        collected.clinic_service_id = returning.previousClinicServiceId;
        collected.doctor_name = previousDoctor.name.replace(/^Dr\.?\s*/i, '').trim();
        collected.routing_source = 'returning_patient_followup';
      }
    }
  }

  private async advanceFromStart(
    input: BookingMachineInput,
    flowBefore: string,
    stateBefore: string,
    collected: BookingCollected,
    extracted: ExtractedBookingFields,
  ): Promise<BookingMachineResult> {
    const returning = await this.patientVisitService.findReturningPatientMatch({
      clinicId: input.session.clinicId,
      patientPhone: input.session.patientPhone,
      reasonForVisit: collected.reason_for_visit ?? extracted.reason_for_visit ?? null,
      patientName: collected.patient_name ?? null,
      isFollowup: collected.is_followup ?? extracted.is_followup ?? false,
    });

    if (returning?.needsPatientIdentity) {
      collected.pending_patient_candidates = returning.candidatePatients;
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: BOOKING_FLOW,
        stateAfter: 'ASK_PATIENT_IDENTITY',
        collectedJson: collected,
        templateKey: 'booking.ask_patient_name',
        templateVariables: {
          clinic_name: input.clinicName,
          patient_list: returning.candidatePatients.map((p) => p.patient_name).join(', '),
        },
        intent: 'book_appointment',
      });
    }

    if (returning?.patientId) {
      collected.patient_id = returning.patientId;
      if (!collected.patient_name) {
        collected.patient_name = returning.patientName;
      }
      if (returning.previousDoctorId && returning.previousClinicServiceId) {
        const [mapping] = await this.repos.clinical.isDoctorMappedToService(
          input.session.clinicId,
          returning.previousDoctorId,
          returning.previousClinicServiceId,
        );
        const doctors = await this.repos.clinical.listDoctors(input.session.clinicId);
        const previousDoctor = doctors.find((doctor) => doctor.id === returning.previousDoctorId);
        if (mapping && previousDoctor?.active) {
          collected.doctor_id = returning.previousDoctorId;
          collected.clinic_service_id = returning.previousClinicServiceId;
          collected.doctor_name = previousDoctor.name.replace(/^Dr\.?\s*/i, '').trim();
          collected.routing_source = 'returning_patient_followup';
        }
      }
    }

    if (extracted.doctor_name_fragment && !collected.doctor_id) {
      return this.selectDoctorByName(
        input,
        flowBefore,
        stateBefore,
        collected,
        extracted.doctor_name_fragment,
      );
    }

    return this.handle({
      ...input,
      session: {
        ...input.session,
        currentFlow: BOOKING_FLOW,
        currentState: inferBookingState(collected),
        collectedJson: collected,
      },
    });
  }

  private async resolvePatientIdentity(
    input: BookingMachineInput,
    flowBefore: string,
    stateBefore: string,
    collected: BookingCollected,
  ): Promise<BookingMachineResult | null> {
    const candidates = collected.pending_patient_candidates ?? [];
    const normalizedMessage = input.messageText.toLowerCase().trim();
    const match = candidates.find((candidate) =>
      candidate.patient_name.toLowerCase().includes(normalizedMessage),
    );
    if (!match) {
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: BOOKING_FLOW,
        stateAfter: 'ASK_PATIENT_IDENTITY',
        collectedJson: collected,
        templateKey: 'booking.ask_patient_name',
        templateVariables: {
          clinic_name: input.clinicName,
          patient_list: candidates.map((p) => p.patient_name).join(', '),
        },
        intent: 'book_appointment',
      });
    }

    collected.patient_id = match.patient_id;
    collected.patient_name = match.patient_name;
    delete collected.pending_patient_candidates;
    return null;
  }

  private async selectDoctorByName(
    input: BookingMachineInput,
    flowBefore: string,
    stateBefore: string,
    collected: BookingCollected,
    nameFragment: string,
  ): Promise<BookingMachineResult> {
    const doctors = await this.repos.clinical.findDoctorByNameFragment(
      input.session.clinicId,
      nameFragment,
    );
    if (doctors.length !== 1) {
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: BOOKING_FLOW,
        stateAfter: 'ASK_PROBLEM_OR_DOCTOR',
        collectedJson: collected,
        templateKey: 'booking.ask_problem_or_doctor',
        templateVariables: { clinic_name: input.clinicName },
        intent: 'book_appointment',
      });
    }

    const doctor = doctors[0]!;
    const doctorMappings = await this.repos.clinical.listActiveDoctorServicesForDoctor(
      input.session.clinicId,
      doctor.id,
    );
    if (doctorMappings.length === 0) {
      return this.unsupportedServiceResult(input, flowBefore, stateBefore);
    }

    const doctorMapping =
      collected.clinic_service_id !== undefined
        ? doctorMappings.find((mapping) => mapping.clinicServiceId === collected.clinic_service_id)
        : doctorMappings[0];
    if (collected.clinic_service_id && !doctorMapping) {
      return this.unsupportedServiceResult(input, flowBefore, stateBefore);
    }

    collected.doctor_id = doctor.id;
    collected.doctor_name = doctor.name.replace(/^Dr\.?\s*/i, '').trim();
    collected.routing_source = 'doctor_name';
    if (doctorMapping) {
      collected.clinic_service_id = doctorMapping.clinicServiceId;
    }

    return this.handle({
      ...input,
      session: {
        ...input.session,
        currentFlow: BOOKING_FLOW,
        currentState: 'SELECT_DOCTOR',
        collectedJson: collected,
      },
    });
  }

  private async routeService(
    input: BookingMachineInput,
    collected: BookingCollected,
  ): Promise<ServiceRouterRouteOutcome> {
    const reason = collected.reason_for_visit ?? '';
    const sessionCached = lookupServiceRouterCache(collected, reason);
    if (sessionCached) {
      return { result: sessionCached, fromCache: true, cacheLayer: 'session' };
    }

    const services = await this.repos.clinical.listServices(input.session.clinicId);
    const activeClinicServices: ActiveClinicServiceProfile[] = services
      .filter((service) => service.active)
      .map((service) => ({
        id: service.id,
        serviceKey: service.serviceKey,
        serviceName: service.serviceName,
        handlesJson: service.handlesJson,
        doesNotHandleJson: service.doesNotHandleJson,
        redFlagsJson: service.redFlagsJson,
        routingExamplesJson: service.routingExamplesJson,
      }));

    const memoryCacheTtlSec = this.env.LLM_SERVICE_ROUTER_MEMORY_CACHE_TTL_SEC ?? 0;
    const memoryCacheKey = buildServiceRouterMemoryCacheKey(
      input.session.clinicId,
      reason,
      activeClinicServices.map((service) => service.id),
    );
    if (memoryCacheTtlSec > 0) {
      const memoryCached = lookupServiceRouterMemoryCache(memoryCacheKey);
      if (memoryCached) {
        Object.assign(collected, storeServiceRouterCacheEntry(collected, reason, memoryCached));
        return { result: memoryCached, fromCache: true, cacheLayer: 'memory' };
      }
    }

    const result = await this.serviceRouter.route({
      clinicId: input.session.clinicId,
      reasonForVisit: reason,
      activeClinicServices,
      llmRuntime: resolveLlmRuntimeSettings(input.session.channel, this.env),
    });

    this.currentInterpretationDebug = {
      ...(this.currentInterpretationDebug ?? {}),
      service_router_called: true,
      service_router_matched_service_id: result.clinicServiceId ?? null,
    };

    Object.assign(collected, storeServiceRouterCacheEntry(collected, reason, result));
    if (memoryCacheTtlSec > 0) {
      storeServiceRouterMemoryCache(memoryCacheKey, result, memoryCacheTtlSec * 1000);
    }

    return { result, fromCache: false };
  }

  private async selectDoctor(
    input: BookingMachineInput,
    flowBefore: string,
    stateBefore: string,
    collected: BookingCollected,
  ): Promise<BookingMachineResult | null> {
    if (collected.doctor_id) {
      return null;
    }

    const mappings = await this.repos.clinical.listActiveDoctorServicesForClinicService(
      input.session.clinicId,
      collected.clinic_service_id!,
    );
    const activeMappings = mappings.filter((mapping) => mapping.doctorActive);
    if (activeMappings.length === 0) {
      return this.unsupportedServiceResult(input, flowBefore, stateBefore);
    }

    const selected = activeMappings[0]!;
    collected.doctor_id = selected.doctorId;
    collected.doctor_name = selected.doctorName.replace(/^Dr\.?\s*/i, '').trim();
    return null;
  }

  private async resolveDateAndTimeStep(
    input: BookingMachineInput,
    flowBefore: string,
    stateBefore: string,
    collected: BookingCollected,
    extracted: ExtractedBookingFields,
    timezone: string,
  ): Promise<BookingMachineResult | null> {
    if (!collected.preferred_date) {
      const referenceDate = formatDateInTimezone(new Date(), timezone);
      const parsedDate =
        extracted.preferred_date ??
        extractActivePreferredDate(input.messageText, referenceDate);
      if (parsedDate) {
        collected.preferred_date = parsedDate;
      } else {
        return this.result({
          input,
          flowBefore,
          stateBefore,
          flowAfter: BOOKING_FLOW,
          stateAfter: 'ASK_DATE',
          collectedJson: collected,
          templateKey: 'booking.ask_date',
          templateVariables: { clinic_name: input.clinicName },
          intent: 'book_appointment',
        });
      }
    }

    const slots = await this.slotService.findAvailableSlots(
      input.session.clinicId,
      collected.doctor_id!,
      collected.clinic_service_id!,
    );
    const availablePreferences = getAvailableTimePreferencesForDate(
      slots,
      collected.preferred_date,
    );

    if (availablePreferences.length === 0) {
      return this.noSlotsAskAlternate(input, flowBefore, stateBefore, collected);
    }

    const requestedTime = extracted.time_preference ?? undefined;

    if (requestedTime && !availablePreferences.includes(requestedTime)) {
      return this.noSlotsAskAlternate(input, flowBefore, stateBefore, {
        ...collected,
        preferred_date: collected.preferred_date,
        time_preference: requestedTime,
      });
    }

    if (requestedTime) {
      collected.time_preference = requestedTime;
    } else if (
      collected.time_preference &&
      !availablePreferences.includes(collected.time_preference) &&
      !extracted.selected_time
    ) {
      delete collected.time_preference;
    }

    if (!collected.time_preference && !extracted.selected_time) {
      if (availablePreferences.length === 1) {
        collected.time_preference = availablePreferences[0]!;
        return null;
      }

      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: BOOKING_FLOW,
        stateAfter: 'ASK_TIME',
        collectedJson: collected,
        templateKey: 'booking.ask_time',
        templateVariables: {
          clinic_name: input.clinicName,
          time_options: formatTimeOptions(availablePreferences),
        },
        intent: 'book_appointment',
      });
    }

    const filtered = filterSlotsByDateAndPreference(
      slots,
      collected.preferred_date,
      collected.time_preference,
    );
    if (filtered.length === 0 && !extracted.selected_time) {
      return this.noSlotsAskAlternate(input, flowBefore, stateBefore, collected);
    }

    return null;
  }

  private async proposeOrHoldSlot(
    input: BookingMachineInput,
    flowBefore: string,
    stateBefore: string,
    collected: BookingCollected,
    extracted: ExtractedBookingFields,
  ): Promise<BookingMachineResult> {
    const slots = await this.slotService.findAvailableSlots(
      input.session.clinicId,
      collected.doctor_id!,
      collected.clinic_service_id!,
    );

    const filtered = filterSlotsByDateAndPreference(
      slots,
      collected.preferred_date,
      collected.time_preference,
    ).map((slot) => ({
      slot_id: slot.slot_id,
      start_time: slot.start_time,
      end_time: slot.end_time,
      display_time: slotDisplayTime(slot.start_time),
      available_count: slot.available_count,
    }));

    if (extracted.selected_time) {
      const selected = filtered.find((slot) =>
        slotMatchesTimeSelection(slot.start_time, extracted.selected_time!, collected.time_preference),
      );
      if (!selected) {
        if (filtered.length === 0) {
          return this.noSlotsAskAlternate(input, flowBefore, stateBefore, collected);
        }

        return this.slotUnavailableResult(
          input,
          flowBefore,
          stateBefore,
          collected,
          filtered,
        );
      }

      try {
        const hold = await this.slotHoldService.holdSlot({
          clinicId: input.session.clinicId,
          slotId: selected.slot_id,
          sessionId: input.session.id,
          ...(input.session.patientPhone ? { patientPhone: input.session.patientPhone } : {}),
        });
        collected.selected_slot_id = selected.slot_id;
        collected.hold_id = hold.id;
        collected.proposed_slots = filtered;
        await this.applyReturningPatientContext(input, collected, extracted);
        return this.afterSlotHeld(input, flowBefore, stateBefore, collected);
      } catch (error) {
        if (error instanceof AppError && (error.code === 'SLOT_FULL' || error.code === 'SLOT_NOT_AVAILABLE')) {
          const refreshed = await this.slotService.findAvailableSlots(
            input.session.clinicId,
            collected.doctor_id!,
            collected.clinic_service_id!,
          );
          const alternatives = filterSlotsByDateAndPreference(
            refreshed,
            collected.preferred_date,
            collected.time_preference,
          ).map((slot) => ({
            slot_id: slot.slot_id,
            start_time: slot.start_time,
            end_time: slot.end_time,
            display_time: slotDisplayTime(slot.start_time),
          }));

          return this.slotUnavailableResult(
            input,
            flowBefore,
            stateBefore,
            { ...collected, proposed_slots: alternatives },
            alternatives,
          );
        }
        throw error;
      }
    }

    if (filtered.length === 0) {
      return this.noSlotsAskAlternate(input, flowBefore, stateBefore, collected);
    }

    collected.proposed_slots = filtered;
    return this.result({
      input,
      flowBefore,
      stateBefore,
      flowAfter: BOOKING_FLOW,
      stateAfter: 'PROPOSE_SLOTS',
      collectedJson: collected,
      templateKey: 'booking.propose_slots',
      templateVariables: {
        clinic_name: input.clinicName,
        doctor_name: collected.doctor_name ?? 'Doctor',
        date_display: formatDateDisplay(collected.preferred_date ?? ''),
        slot_list: formatSlotList(filtered),
      },
      intent: 'book_appointment',
    });
  }

  private async getClinicTimezone(clinicId: string) {
    const [clinic] = await this.repos.clinics.findClinicById(clinicId);
    return clinic?.timezone ?? 'Asia/Kolkata';
  }

  private unsupportedServiceResult(
    input: BookingMachineInput,
    flowBefore: string,
    stateBefore: string,
  ): BookingMachineResult {
    return this.result({
      input,
      flowBefore,
      stateBefore,
      flowAfter: 'none',
      stateAfter: 'IDLE',
      collectedJson: { awaiting_terminal_ack: 'unsupported_service' },
      templateKey: 'scope.unsupported_service',
      templateVariables: { clinic_name: input.clinicName },
      intent: 'unsupported_service',
      sessionStatus: 'active',
    });
  }

  private serviceClarificationResult(
    input: BookingMachineInput,
    flowBefore: string,
    stateBefore: string,
    collected: BookingCollected,
    clarificationQuestion?: string,
  ): BookingMachineResult {
    const question =
      clarificationQuestion?.trim() ||
      'Which type of consultation do you need?';
    return this.result({
      input,
      flowBefore,
      stateBefore,
      flowAfter: BOOKING_FLOW,
      stateAfter: 'ASK_SERVICE_CLARIFICATION',
      collectedJson: {
        ...collected,
        awaiting_service_clarification: true,
        service_clarification_question: question,
      },
      templateKey: 'booking.ask_service_clarification',
      templateVariables: {
        clinic_name: input.clinicName,
        clarification_question: question,
      },
      intent: 'book_appointment',
    });
  }

  private redFlagEmergencyResult(
    input: BookingMachineInput,
    flowBefore: string,
    stateBefore: string,
  ): BookingMachineResult {
    return this.result({
      input,
      flowBefore,
      stateBefore,
      flowAfter: 'none',
      stateAfter: 'IDLE',
      collectedJson: {},
      templateKey: 'safety.emergency',
      templateVariables: {},
      intent: 'emergency',
      sessionStatus: 'escalated',
    });
  }

  private afterSlotHeld(
    input: BookingMachineInput,
    flowBefore: string,
    stateBefore: string,
    collected: BookingCollected,
  ): BookingMachineResult {
    if (!collected.patient_name) {
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: BOOKING_FLOW,
        stateAfter: 'ASK_PATIENT_NAME',
        collectedJson: collected,
        templateKey: 'booking.ask_patient_name',
        templateVariables: { clinic_name: input.clinicName },
        intent: 'book_appointment',
      });
    }

    return this.promptDoctorConfirmation(input, flowBefore, stateBefore, collected);
  }

  private promptDoctorConfirmation(
    input: BookingMachineInput,
    flowBefore: string,
    stateBefore: string,
    collected: BookingCollected,
  ): BookingMachineResult {
    const selectedSlot = collected.proposed_slots?.find(
      (slot) => slot.slot_id === collected.selected_slot_id,
    );
    return this.result({
      input,
      flowBefore,
      stateBefore,
      flowAfter: BOOKING_FLOW,
      stateAfter: 'CONFIRM_DOCTOR',
      collectedJson: collected,
      templateKey: 'booking.confirm_doctor',
      templateVariables: {
        clinic_name: input.clinicName,
        doctor_name: collected.doctor_name ?? 'Doctor',
        date_display: formatDateDisplay(collected.preferred_date ?? ''),
        slot_time: selectedSlot?.display_time ?? '',
      },
      intent: 'book_appointment',
    });
  }

  private async tryCreateAppointment(
    input: BookingMachineInput,
    flowBefore: string,
    stateBefore: string,
    collected: BookingCollected,
  ): Promise<BookingMachineResult> {
    if (collected.appointment_id) {
      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: BOOKING_FLOW,
        stateAfter: 'DONE',
        collectedJson: collected,
        templateKey: 'booking.created_pending',
        templateVariables: { clinic_name: input.clinicName },
        intent: 'book_appointment',
        sessionStatus: 'completed',
      });
    }

    try {
      const appointment = await this.appointmentService.createFromConfirmedHold({
        clinicId: input.session.clinicId,
        sessionId: input.session.id,
        slotId: collected.selected_slot_id!,
        holdId: collected.hold_id!,
        patientName: collected.patient_name!,
        patientPhone: input.session.patientPhone,
        patientId: collected.patient_id ?? null,
        reasonForVisit: collected.reason_for_visit!,
        routingSource: normalizeAppointmentRoutingSource(collected.routing_source),
      });

      collected.appointment_id = appointment.id;
      const templateKey =
        appointment.status === 'confirmed' ? 'booking.created_confirmed' : 'booking.created_pending';

      return this.result({
        input,
        flowBefore,
        stateBefore,
        flowAfter: BOOKING_FLOW,
        stateAfter: 'DONE',
        collectedJson: {
          ...collected,
          awaiting_terminal_ack: 'booking_complete',
        },
        templateKey,
        templateVariables: { clinic_name: input.clinicName },
        intent: 'book_appointment',
        sessionStatus: 'active',
      });
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.code === 'SLOT_FULL' ||
          error.code === 'SLOT_NOT_AVAILABLE' ||
          error.code === 'SLOT_HOLD_EXPIRED')
      ) {
        const refreshed = await this.slotService.findAvailableSlots(
          input.session.clinicId,
          collected.doctor_id!,
          collected.clinic_service_id!,
        );
        const alternatives = filterSlotsByDateAndPreference(
          refreshed,
          collected.preferred_date,
          collected.time_preference,
        ).map((slot) => ({
          slot_id: slot.slot_id,
          start_time: slot.start_time,
          end_time: slot.end_time,
          display_time: slotDisplayTime(slot.start_time),
        }));

        const nextCollected = { ...collected };
        delete nextCollected.hold_id;
        delete nextCollected.selected_slot_id;
        return this.slotUnavailableResult(
          input,
          flowBefore,
          stateBefore,
          { ...nextCollected, proposed_slots: alternatives },
          alternatives,
        );
      }
      throw error;
    }
  }

  private slotUnavailableResult(
    input: BookingMachineInput,
    flowBefore: string,
    stateBefore: string,
    collected: BookingCollected,
    alternatives: Array<{ slot_id: string; start_time: string; end_time: string; display_time: string }>,
  ): BookingMachineResult {
    if (alternatives.length === 0) {
      return this.noSlotsAskAlternate(input, flowBefore, stateBefore, collected);
    }

    return this.result({
      input,
      flowBefore,
      stateBefore,
      flowAfter: BOOKING_FLOW,
      stateAfter: 'PROPOSE_SLOTS',
      collectedJson: { ...collected, proposed_slots: alternatives },
      templateKey: 'booking.slot_unavailable',
      templateVariables: {
        clinic_name: input.clinicName,
        doctor_name: collected.doctor_name ?? 'Doctor',
        date_display: formatDateDisplay(collected.preferred_date ?? ''),
        slot_list: formatSlotList(alternatives),
      },
      intent: 'book_appointment',
    });
  }

  private noSlotsAskAlternate(
    input: BookingMachineInput,
    flowBefore: string,
    stateBefore: string,
    collected: BookingCollected,
  ): BookingMachineResult {
    return this.result({
      input,
      flowBefore,
      stateBefore,
      flowAfter: BOOKING_FLOW,
      stateAfter: 'ASK_ALTERNATE_TIME',
      collectedJson: {
        ...collected,
        proposed_slots: [],
        awaiting_alternate_slot: true,
      },
      templateKey: 'booking.ask_alternate_time',
      templateVariables: { clinic_name: input.clinicName },
      intent: 'book_appointment',
    });
  }

  private async handleActiveScopeRedirect(
    input: BookingMachineInput,
    flowBefore: string,
    stateBefore: string,
    collected: BookingCollected,
    interpretation: Awaited<ReturnType<ActiveStateInterpretationService['interpret']>>,
  ): Promise<BookingMachineResult> {
    const redirect = await this.templateRenderer.render(
      'scope.out_of_scope_redirect',
      input.session.languageCode as 'ta_tanglish' | 'english',
      { clinic_name: input.clinicName },
    );
    const answerText = await appendBookingResumeText(
      this.templateRenderer,
      redirect.message_text,
      input.session,
      collected as Record<string, unknown>,
      { clinicName: input.clinicName, resumeState: stateBefore },
    );

    return {
      intent: 'out_of_scope',
      templateKey: 'knowledge.answer',
      templateVariables: { answer_text: answerText },
      flowBefore,
      stateBefore,
      flowAfter: BOOKING_FLOW,
      stateAfter: stateBefore,
      collectedJson: attachActivePrompt(
        collected as Record<string, unknown>,
        buildActivePromptSnapshot(stateBefore, 'scope.out_of_scope_redirect'),
      ),
      debug: {
        ...interpretation.debug,
        handler: 'a17_scope_redirect',
        scope_redirect: true,
        resumed_state: stateBefore,
      },
    };
  }

  private async handleActiveSideQuestion(
    input: BookingMachineInput,
    flowBefore: string,
    stateBefore: string,
    collected: BookingCollected,
    interpretation: Awaited<ReturnType<ActiveStateInterpretationService['interpret']>>,
  ): Promise<BookingMachineResult> {
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
      debug: {
        ...interpretation.debug,
        handler: 'a05b_side_question',
        side_question: true,
        resumed_state: stateBefore,
      },
    };
  }

  private async applyPreferredDateChange(
    input: BookingMachineInput,
    collected: BookingCollected,
    extracted: ExtractedBookingFields,
  ): Promise<BookingCollected> {
    if (
      extracted.preferred_date &&
      collected.preferred_date &&
      extracted.preferred_date !== collected.preferred_date
    ) {
      await this.releaseBookingSlotHold(input, collected);
    }

    return applyExtractedToCollected(collected, extracted);
  }

  private async releaseBookingSlotHold(
    input: BookingMachineInput,
    collected: BookingCollected,
  ): Promise<void> {
    if (!collected.hold_id && !collected.proposed_slots?.length) {
      return;
    }

    await this.slotHoldService.releaseSessionHolds(input.session.clinicId, input.session.id);
    if (collected.hold_id) {
      try {
        await this.slotHoldService.releaseHold(input.session.clinicId, collected.hold_id);
      } catch {
        // Hold may already be released/expired.
      }
    }
  }

  private result(params: {
    input: BookingMachineInput;
    flowBefore: string;
    stateBefore: string;
    flowAfter: string;
    stateAfter: string;
    collectedJson: BookingCollected | Record<string, unknown>;
    templateKey: MessageTemplateKey;
    templateVariables: Record<string, string>;
    intent: string;
    sessionStatus?: 'active' | 'completed' | 'escalated';
    interpretationDebug?: Record<string, unknown>;
  }): BookingMachineResult {
    const debug =
      this.env.DEBUG_API && this.env.NODE_ENV !== 'production'
        ? {
            handler: 'a02_booking_machine',
            state_after: params.stateAfter,
            collected: params.collectedJson,
            ...(this.currentInterpretationDebug ?? params.interpretationDebug ?? {}),
          }
        : this.currentInterpretationDebug ?? params.interpretationDebug;

    return {
      intent: params.intent,
      templateKey: params.templateKey,
      templateVariables: params.templateVariables,
      flowBefore: params.flowBefore,
      stateBefore: params.stateBefore,
      flowAfter: params.flowAfter,
      stateAfter: params.stateAfter,
      collectedJson:
        params.flowAfter === BOOKING_FLOW
          ? attachActivePrompt(
              params.collectedJson as Record<string, unknown>,
              buildActivePromptSnapshot(params.stateAfter, params.templateKey),
            )
          : (params.collectedJson as Record<string, unknown>),
      ...(params.sessionStatus ? { sessionStatus: params.sessionStatus } : {}),
      ...(debug ? { debug } : {}),
    };
  }

  async expireOldHolds(clinicId?: string) {
    return this.slotHoldExpiryService.expireSlotHolds(clinicId ? { clinicId } : {});
  }
}
