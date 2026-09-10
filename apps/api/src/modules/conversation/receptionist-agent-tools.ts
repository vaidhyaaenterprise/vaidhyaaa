import { Inject, Injectable } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import {
  createRepositories,
  dayOfWeekMon1,
  formatDateInTimezone,
  formatTimeInTimezone,
  ACTIVE_APPOINTMENT_STATUSES,
  type Repositories,
} from '@vaidya/db';
import {
  ADAPTER_TOKENS,
  applyReasonForVisitUpdate,
  extractActivePreferredDate,
  normalizeAppointmentRoutingSource,
  parseBookingCollected,
  type LlmToolDefinition,
  type ServiceRouterAdapter,
  type TimePreference,
} from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { API_ENV } from '../../config/api-config.module';
import { DATABASE_CONNECTION } from '../database/database.module';
import { BookingAppointmentService } from '../booking/booking-appointment.service';
import {
  filterSlotsByDateAndPreference,
  getAvailableTimePreferencesForDate,
  mergeCollected,
  slotDisplayTime,
} from '../booking/booking-field-extractor';
import { KnowledgeSearchService } from '../knowledge/knowledge-search.service';
import { AppointmentLookupService } from '../patient-action/appointment-lookup.service';
import { StaffNotificationService } from '../patient-action/staff-notification.service';
import {
  formatClinicHoursText,
  formatDayHoursText,
  formatFeeAmount,
  resolveTodayDayOfWeek,
} from '../structured-info/structured-info-field-extractor';
import { isPatientActionConfirmed } from './receptionist-agent-confirmation';
import { SlotHoldService } from '../slots/slot-hold.service';
import { SlotService } from '../slots/slot.service';

export const RECEPTIONIST_AGENT_TOOL_NAMES = [
  'get_clinic_info',
  'search_knowledge_base',
  'check_slot_availability',
  'create_appointment_request',
  'cancel_appointment',
  'reschedule_appointment',
  'request_human_callback',
  'update_booking_state',
  'get_appointment_status',
] as const;

export type ReceptionistAgentToolName = (typeof RECEPTIONIST_AGENT_TOOL_NAMES)[number];

export type ReceptionistAgentToolContext = {
  clinicId: string;
  sessionId: string;
  collected: Record<string, unknown>;
  patientPhone?: string | null;
  patientMessageText?: string | null;
  lastAssistantMessageText?: string | null;
};

const CLINIC_INFO_TOPICS = [
  'fee',
  'timing',
  'location',
  'parking',
  'insurance',
  'documents',
  'doctor_availability',
] as const;

type ClinicInfoTopic = (typeof CLINIC_INFO_TOPICS)[number];

export const RECEPTIONIST_AGENT_TOOLS: LlmToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_clinic_info',
      description:
        'Fetch structured clinic facts (fee, timing, location, parking, insurance, documents, doctor availability). Returns JSON facts only.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', enum: [...CLINIC_INFO_TOPICS] },
          doctorName: { type: ['string', 'null'], description: 'Doctor name when topic is fee or doctor_availability.' },
          day: { type: ['string', 'null'], description: 'Day hint for timing or doctor_availability (today, tomorrow, Monday, YYYY-MM-DD).' },
        },
        required: ['topic'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge_base',
      description: 'Search approved clinic knowledge. Returns raw answer text for you to phrase naturally.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_slot_availability',
      description: 'List real available appointment slots for a date. Call before offering times.',
      parameters: {
        type: 'object',
        properties: {
          doctorName: { type: ['string', 'null'] },
          reasonForVisit: { type: ['string', 'null'] },
          date: { type: ['string', 'null'], description: 'YYYY-MM-DD or relative day phrase.' },
          timePreference: {
            type: ['string', 'null'],
            enum: ['morning', 'afternoon', 'evening', null],
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_appointment_request',
      description:
        'Create a booking once patient name, phone, reason, doctor, date, and slotId are known. Only call after the patient explicitly confirmed.',
      parameters: {
        type: 'object',
        properties: {
          patientName: { type: 'string' },
          phone: { type: 'string' },
          doctorName: { type: ['string', 'null'] },
          reasonForVisit: { type: 'string' },
          date: { type: 'string' },
          slotId: { type: 'string' },
          confirmedByPatient: {
            type: 'boolean',
            description: 'Must be true only after the patient affirmed a prior confirmation prompt.',
          },
        },
        required: ['patientName', 'phone', 'reasonForVisit', 'date', 'slotId', 'confirmedByPatient'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_appointment',
      description: 'Cancel an existing appointment for the patient after explicit confirmation.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: ['string', 'null'] },
          appointmentRef: { type: ['string', 'null'], description: 'Appointment id or list index label.' },
          confirmedByPatient: { type: 'boolean' },
        },
        required: ['confirmedByPatient'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reschedule_appointment',
      description: 'Submit a reschedule request after explicit patient confirmation.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: ['string', 'null'] },
          appointmentRef: { type: ['string', 'null'] },
          newDate: { type: ['string', 'null'] },
          newSlotId: { type: ['string', 'null'] },
          confirmedByPatient: { type: 'boolean' },
        },
        required: ['confirmedByPatient'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_human_callback',
      description: 'Escalate to clinic staff for a human callback.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: ['string', 'null'] },
          name: { type: ['string', 'null'] },
          phone: { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_booking_state',
      description: 'Persist partial booking fields collected from the patient across turns.',
      parameters: {
        type: 'object',
        properties: {
          fields: {
            type: 'object',
            description:
              'Partial booking fields: reason_for_visit, doctor_name, doctor_id, preferred_date, time_preference, patient_name, patient_phone, clinic_service_id, selected_slot_id.',
            additionalProperties: true,
          },
        },
        required: ['fields'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_appointment_status',
      description: 'Check the status of a booked appointment (pending, confirmed, cancelled) using patient phone.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: ['string', 'null'], description: 'Patient phone number to look up appointment.' },
        },
        additionalProperties: false,
      },
    },
  },
];

const BOOKING_STATE_FIELDS = new Set([
  'reason_for_visit',
  'doctor_name',
  'doctor_id',
  'preferred_date',
  'time_preference',
  'patient_name',
  'patient_phone',
  'clinic_service_id',
  'selected_slot_id',
  'routing_source',
  'agent_clarify_count',
  'last_clarify_reply',
]);

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseTimePreference(value: unknown): TimePreference | null {
  if (value === 'morning' || value === 'afternoon' || value === 'evening') {
    return value;
  }
  return null;
}

@Injectable()
export class ReceptionistAgentToolsService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(SlotService) private readonly slotService: SlotService,
    @Inject(SlotHoldService) private readonly slotHoldService: SlotHoldService,
    @Inject(BookingAppointmentService) private readonly bookingAppointmentService: BookingAppointmentService,
    @Inject(KnowledgeSearchService) private readonly knowledgeSearchService: KnowledgeSearchService,
    @Inject(AppointmentLookupService) private readonly appointmentLookup: AppointmentLookupService,
    @Inject(StaffNotificationService) private readonly staffNotification: StaffNotificationService,
    @Inject(ADAPTER_TOKENS.ServiceRouterAdapter)
    private readonly serviceRouter: ServiceRouterAdapter,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async tryAutoMapDoctor(
    ctx: ReceptionistAgentToolContext,
    collected: ReturnType<typeof parseBookingCollected>,
  ): Promise<{ doctorId: string; doctorName: string; clinicServiceId: string } | null> {
    if (collected.doctor_id || collected.doctor_name) {
      return null;
    }
    if (!collected.reason_for_visit) {
      return null;
    }
    const result = await this.resolveDoctorAndService(ctx, collected, null, collected.reason_for_visit);
    if ('error' in result) {
      return null;
    }
    return result;
  }

  async execute(
    toolName: ReceptionistAgentToolName,
    args: Record<string, unknown>,
    ctx: ReceptionistAgentToolContext,
  ): Promise<Record<string, unknown>> {
    switch (toolName) {
      case 'get_clinic_info':
        return this.getClinicInfo(args, ctx);
      case 'search_knowledge_base':
        return this.searchKnowledgeBase(args, ctx);
      case 'check_slot_availability':
        return this.checkSlotAvailability(args, ctx);
      case 'create_appointment_request':
        return this.createAppointmentRequest(args, ctx);
      case 'cancel_appointment':
        return this.cancelAppointment(args, ctx);
      case 'reschedule_appointment':
        return this.rescheduleAppointment(args, ctx);
      case 'request_human_callback':
        return this.requestHumanCallback(args, ctx);
      case 'update_booking_state':
        return this.updateBookingState(args, ctx);
      case 'get_appointment_status':
        return this.getAppointmentStatus(args, ctx);
      default:
        return { error: 'unknown_tool', toolName };
    }
  }

  private async getClinicInfo(
    args: Record<string, unknown>,
    ctx: ReceptionistAgentToolContext,
  ): Promise<Record<string, unknown>> {
    const topic = readString(args.topic) as ClinicInfoTopic | null;
    if (!topic || !CLINIC_INFO_TOPICS.includes(topic)) {
      return { error: 'invalid_topic', allowed: CLINIC_INFO_TOPICS };
    }

    const doctorName = readString(args.doctorName);
    const day = readString(args.day);
    const [clinic] = await this.repos.clinics.getClinicLocation(ctx.clinicId);
    const timezone = clinic?.timezone ?? 'Asia/Kolkata';

    if (topic === 'location') {
      const addressParts = [clinic?.addressLine1, clinic?.addressLine2, clinic?.city, clinic?.state].filter(
        (part): part is string => Boolean(part),
      );
      return {
        topic,
        found: addressParts.length > 0,
        address: addressParts.join(', ') || null,
        city: clinic?.city ?? null,
        state: clinic?.state ?? null,
      };
    }

    if (topic === 'timing') {
      const hours = await this.repos.slots.listClinicHours(ctx.clinicId);
      if (!day) {
        return { topic, found: hours.length > 0, hoursSummary: formatClinicHoursText(hours), timezone };
      }
      const referenceDate = formatDateInTimezone(new Date(), timezone);
      const resolvedDate =
        extractActivePreferredDate(day, referenceDate) ??
        (/^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null);
      const dayOfWeek = resolvedDate
        ? dayOfWeekMon1(resolvedDate, timezone)
        : day.toLowerCase() === 'today'
          ? resolveTodayDayOfWeek(timezone)
          : null;
      if (!dayOfWeek) {
        return { topic, found: false, error: 'day_not_understood', day };
      }
      const dayHours = hours.filter((row) => row.dayOfWeek === dayOfWeek);
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      return {
        topic,
        found: dayHours.length > 0,
        day: dayNames[dayOfWeek - 1] ?? day,
        hours: dayHours.length > 0 ? formatDayHoursText(dayHours) : 'closed',
        timezone,
      };
    }

    if (topic === 'fee') {
      if (!doctorName) {
        return { topic, found: false, error: 'doctor_name_required' };
      }
      const doctors = await this.repos.clinical.findDoctorByNameFragment(ctx.clinicId, doctorName);
      if (doctors.length === 0) {
        return { topic, found: false, doctorName };
      }
      const doctor = doctors[0]!;
      const [feeInfo] = await this.repos.clinical.getDoctorFeeInfo(ctx.clinicId, doctor.id);
      if (!feeInfo) {
        return { topic, found: false, doctorName: doctor.name };
      }
      return {
        topic,
        found: true,
        doctorName: doctor.name,
        consultationFee: formatFeeAmount(feeInfo.consultationFeeAmount),
        followupFee: formatFeeAmount(feeInfo.followupFeeAmount),
        currency: 'INR',
      };
    }

    if (topic === 'doctor_availability') {
      if (!doctorName) {
        return { topic, found: false, error: 'doctor_name_required' };
      }
      const doctors = await this.repos.clinical.findDoctorByNameFragment(ctx.clinicId, doctorName);
      if (doctors.length === 0) {
        return { topic, found: false, doctorName };
      }
      const doctor = doctors[0]!;
      const mappings = await this.repos.clinical.listActiveDoctorServicesForDoctor(ctx.clinicId, doctor.id);
      if (mappings.length === 0) {
        return { topic, found: false, doctorName: doctor.name, error: 'no_active_services' };
      }
      const mapping = mappings[0]!;
      const referenceDate = formatDateInTimezone(new Date(), timezone);
      const targetDate =
        (day ? extractActivePreferredDate(day, referenceDate) : null) ??
        referenceDate;
      const slots = await this.slotService.findAvailableSlots(
        ctx.clinicId,
        doctor.id,
        mapping.clinicServiceId,
      );
      const dateSlots = slots.filter((slot) => slot.start_time.split(' ')[0] === targetDate);
      return {
        topic,
        found: dateSlots.length > 0,
        doctorName: doctor.name,
        date: targetDate,
        slots: dateSlots.map((slot) => ({
          slotId: slot.slot_id,
          time: slotDisplayTime(slot.start_time),
        })),
      };
    }

    const knowledgeQuery =
      topic === 'parking'
        ? 'parking'
        : topic === 'insurance'
          ? 'insurance accepted'
          : topic === 'documents'
            ? 'documents required for visit'
            : topic;
    const knowledge = await this.knowledgeSearchService.searchApprovedKnowledge(
      ctx.clinicId,
      knowledgeQuery,
      topic,
    );
    return {
      topic,
      found: Boolean(knowledge?.meetsThreshold),
      answer: knowledge?.answer ?? null,
      score: knowledge?.score ?? null,
      category: knowledge?.category ?? null,
    };
  }

  private async searchKnowledgeBase(
    args: Record<string, unknown>,
    ctx: ReceptionistAgentToolContext,
  ): Promise<Record<string, unknown>> {
    const query = readString(args.query);
    if (!query) {
      return { found: false, error: 'query_required' };
    }
    const result = await this.knowledgeSearchService.searchApprovedKnowledge(ctx.clinicId, query);
    if (!result?.meetsThreshold) {
      return { found: false, score: result?.score ?? null };
    }
    return {
      found: true,
      answer: result.answer,
      score: result.score,
      category: result.category,
    };
  }

  private async checkSlotAvailability(
    args: Record<string, unknown>,
    ctx: ReceptionistAgentToolContext,
  ): Promise<Record<string, unknown>> {
    const collected = parseBookingCollected(ctx.collected);
    const [clinic] = await this.repos.clinics.getClinicLocation(ctx.clinicId);
    const timezone = clinic?.timezone ?? 'Asia/Kolkata';
    const referenceDate = formatDateInTimezone(new Date(), timezone);

    const doctorName = readString(args.doctorName) ?? collected.doctor_name ?? null;
    const reasonForVisit = readString(args.reasonForVisit) ?? collected.reason_for_visit ?? null;
    const dateInput = readString(args.date) ?? collected.preferred_date ?? null;
    const timePreference = parseTimePreference(args.timePreference) ?? collected.time_preference ?? null;

    let preferredDate = dateInput
      ? extractActivePreferredDate(dateInput, referenceDate) ??
        (/^\d{4}-\d{2}-\d{2}$/.test(dateInput) ? dateInput : null)
      : null;

    if (!preferredDate) {
      return { slots: [], error: 'date_required' };
    }

    const refYear = referenceDate.slice(0, 4);
    const dateYear = preferredDate.slice(0, 4);
    if (dateYear !== refYear) {
      preferredDate = refYear + preferredDate.slice(4);
    }

    let resolvedDoctorId: string | null = collected.doctor_id ?? null;
    let resolvedDoctorName: string | null = collected.doctor_name ?? null;
    let clinicServiceId = collected.clinic_service_id ?? null;

    if (doctorName) {
      const target = await this.resolveDoctorAndService(ctx, collected, doctorName, reasonForVisit);
      if ('error' in target) {
        return { slots: [], ...target };
      }
      resolvedDoctorId = target.doctorId;
      resolvedDoctorName = target.doctorName;
      clinicServiceId = target.clinicServiceId;
    }

    if (!clinicServiceId && reasonForVisit) {
      const services = await this.repos.clinical.listServices(ctx.clinicId);
      const activeClinicServices = services
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
      const routed = await this.serviceRouter.route({
        clinicId: ctx.clinicId,
        reasonForVisit,
        activeClinicServices,
      });
      if (routed.matched && routed.clinicServiceId) {
        clinicServiceId = routed.clinicServiceId;
      }
    }

    if (!clinicServiceId) {
      return { slots: [], error: 'service_not_found' };
    }

    const mappings = await this.repos.clinical.listActiveDoctorServicesForClinicService(
      ctx.clinicId,
      clinicServiceId,
    );

    let candidates: Array<{ doctorId: string; doctorName: string }> = [];
    if (resolvedDoctorId) {
      const match = mappings.find((m) => m.doctorId === resolvedDoctorId);
      if (match) {
        candidates = [{ doctorId: match.doctorId, doctorName: match.doctorName }];
      }
    } else {
      candidates = mappings.map((m) => ({ doctorId: m.doctorId, doctorName: m.doctorName }));
    }

    if (candidates.length === 0) {
      return { slots: [], error: 'doctor_required' };
    }

    let bestSlots: Array<{ slot_id: string; start_time: string; available_count?: number }> = [];
    let bestDoctorId = candidates[0]!.doctorId;
    let bestDoctorName = candidates[0]!.doctorName;

    const referenceTime = preferredDate === referenceDate
      ? formatTimeInTimezone(new Date(), timezone)
      : undefined;

    for (const candidate of candidates) {
      const slots = await this.slotService.findAvailableSlots(
        ctx.clinicId,
        candidate.doctorId,
        clinicServiceId,
      );
      const filtered = filterSlotsByDateAndPreference(slots, preferredDate, timePreference ?? undefined, referenceDate, referenceTime);
      if (filtered.length > 0) {
        bestSlots = filtered;
        bestDoctorId = candidate.doctorId;
        bestDoctorName = candidate.doctorName;
        break;
      }
      if (bestSlots.length === 0) {
        const anyDate = filterSlotsByDateAndPreference(slots, preferredDate, undefined, referenceDate, referenceTime);
        if (anyDate.length > 0) {
          bestSlots = anyDate;
          bestDoctorId = candidate.doctorId;
          bestDoctorName = candidate.doctorName;
        }
      }
    }

    return {
      slots: bestSlots.map((slot) => ({
        slotId: slot.slot_id,
        doctorName: bestDoctorName,
        dateDisplay: preferredDate,
        time: slotDisplayTime(slot.start_time),
      })),
      doctorId: bestDoctorId,
      doctorName: bestDoctorName,
      clinicServiceId,
      preferredDate,
      timePreference,
      ...(bestSlots.length === 0
        ? {
            error: 'no_slots_for_preference',
            availableTimePreferences: getAvailableTimePreferencesForDate(
              await this.slotService.findAvailableSlots(ctx.clinicId, bestDoctorId, clinicServiceId),
              preferredDate,
            ),
          }
        : {}),
    };
  }

  private async createAppointmentRequest(
    args: Record<string, unknown>,
    ctx: ReceptionistAgentToolContext,
  ): Promise<Record<string, unknown>> {
    if (
      !isPatientActionConfirmed({
        confirmedByPatient: args.confirmedByPatient,
        lastAssistantMessageText: ctx.lastAssistantMessageText ?? null,
        patientMessageText: ctx.patientMessageText ?? null,
      })
    ) {
      return { error: 'need_explicit_confirmation_first' };
    }

    const collected = parseBookingCollected(ctx.collected);
    const patientName = readString(args.patientName) ?? collected.patient_name ?? null;
    const phone = readString(args.phone) ?? ctx.patientPhone ?? null;
    const doctorName = readString(args.doctorName) ?? collected.doctor_name ?? null;
    const reasonForVisit = readString(args.reasonForVisit) ?? collected.reason_for_visit ?? null;
    const date = readString(args.date) ?? collected.preferred_date ?? null;
    const slotId = readString(args.slotId) ?? collected.selected_slot_id ?? null;

    const missing: string[] = [];
    if (!patientName) missing.push('patientName');
    if (!phone) missing.push('phone');
    if (!doctorName) missing.push('doctorName');
    if (!reasonForVisit) missing.push('reasonForVisit');
    if (!date) missing.push('date');
    if (!slotId) missing.push('slotId');
    if (missing.length > 0) {
      return { error: 'missing_fields', missing };
    }

    const target = await this.resolveDoctorAndService(ctx, collected, doctorName, reasonForVisit);
    if ('error' in target) {
      return { error: target.error };
    }

    const slot = await this.slotService.getSlotAvailability(ctx.clinicId, slotId!);
    if (!slot || slot.doctor_id !== target.doctorId) {
      return { error: 'invalid_slot', slotId };
    }

    const hold = await this.slotHoldService.holdSlot({
      clinicId: ctx.clinicId,
      slotId: slotId!,
      sessionId: ctx.sessionId,
      patientPhone: phone!,
    });

    try {
      const appointment = await this.bookingAppointmentService.createFromConfirmedHold({
        clinicId: ctx.clinicId,
        sessionId: ctx.sessionId,
        slotId: slotId!,
        holdId: hold.id,
        patientName: patientName!,
        patientPhone: phone,
        reasonForVisit: reasonForVisit!,
        routingSource: normalizeAppointmentRoutingSource(collected.routing_source),
        patientId: collected.patient_id ?? null,
      });

      return {
        status: appointment.status === 'confirmed' ? 'confirmed' : 'pending',
        appointmentId: appointment.id,
        holdId: hold.id,
        doctorName: target.doctorName,
        date,
        slotId,
      };
    } catch (error) {
      await this.slotHoldService.releaseHold(ctx.clinicId, hold.id).catch(() => undefined);
      return {
        error: 'booking_failed',
        message: error instanceof Error ? error.message : 'unknown_error',
      };
    }
  }

  private async cancelAppointment(
    args: Record<string, unknown>,
    ctx: ReceptionistAgentToolContext,
  ): Promise<Record<string, unknown>> {
    if (
      !isPatientActionConfirmed({
        confirmedByPatient: args.confirmedByPatient,
        lastAssistantMessageText: ctx.lastAssistantMessageText ?? null,
        patientMessageText: ctx.patientMessageText ?? null,
      })
    ) {
      return { error: 'need_explicit_confirmation_first' };
    }

    const phone = readString(args.phone) ?? ctx.patientPhone ?? null;
    const appointment = await this.resolveAppointmentRef(ctx, phone, readString(args.appointmentRef));
    if (!appointment) {
      return { error: 'appointment_not_found' };
    }
    if (!ACTIVE_APPOINTMENT_STATUSES.includes(appointment.status as 'pending_confirmation' | 'confirmed')) {
      return { error: 'appointment_not_active', appointmentId: appointment.id, status: appointment.status };
    }

    await this.slotHoldService.cancelAppointment(ctx.clinicId, appointment.id);
    await this.repos.appointmentLifecycle.rejectPendingActionRequestsForAppointment(
      ctx.clinicId,
      appointment.id,
    );
    await this.staffNotification.notifyStaffActionRequest({
      clinicId: ctx.clinicId,
      eventType: 'appointment.cancelled',
      templateKey: 'cancel.completed',
      deduplicationKey: `agent-cancel:${ctx.sessionId}:${appointment.id}`,
      payload: {
        appointment_id: appointment.id,
        session_id: ctx.sessionId,
        cancelled_by: 'patient_call',
        patient_phone: phone,
      },
    });

    return { cancelled: true, appointmentId: appointment.id };
  }

  private async rescheduleAppointment(
    args: Record<string, unknown>,
    ctx: ReceptionistAgentToolContext,
  ): Promise<Record<string, unknown>> {
    if (
      !isPatientActionConfirmed({
        confirmedByPatient: args.confirmedByPatient,
        lastAssistantMessageText: ctx.lastAssistantMessageText ?? null,
        patientMessageText: ctx.patientMessageText ?? null,
      })
    ) {
      return { error: 'need_explicit_confirmation_first' };
    }

    const phone = readString(args.phone) ?? ctx.patientPhone ?? null;
    const appointment = await this.resolveAppointmentRef(ctx, phone, readString(args.appointmentRef));
    if (!appointment) {
      return { error: 'appointment_not_found' };
    }
    if (
      !ACTIVE_APPOINTMENT_STATUSES.includes(appointment.status as 'pending_confirmation' | 'confirmed')
    ) {
      return { error: 'appointment_not_active', appointmentId: appointment.id };
    }

    const newSlotId = readString(args.newSlotId);
    const newDate = readString(args.newDate);
    if (!newSlotId) {
      return { error: 'newSlotId_required' };
    }

    const hold = await this.slotHoldService.holdSlot({
      clinicId: ctx.clinicId,
      slotId: newSlotId,
      sessionId: ctx.sessionId,
      ...(phone ? { patientPhone: phone } : {}),
    });

    const [actionRequest] = await this.repos.appointmentLifecycle.insertActionRequest({
      clinicId: ctx.clinicId,
      appointmentId: appointment.id,
      requestType: 'reschedule',
      requestedBy: 'patient_call',
      status: 'pending',
      requestedNewSlotId: newSlotId,
      requestedNewDate: newDate,
      sourceSessionId: ctx.sessionId,
    });

    if (actionRequest) {
      await this.staffNotification.notifyStaffActionRequest({
        clinicId: ctx.clinicId,
        eventType: 'staff.action_request',
        templateKey: 'reschedule.request_submitted',
        deduplicationKey: `agent-reschedule:${ctx.sessionId}:${appointment.id}`,
        payload: {
          action_request_id: actionRequest.id,
          appointment_id: appointment.id,
          request_type: 'reschedule',
          requested_new_slot_id: newSlotId,
          session_id: ctx.sessionId,
        },
      });
    }

    return {
      submitted: true,
      appointmentId: appointment.id,
      actionRequestId: actionRequest?.id ?? null,
      newSlotId,
      newDate: newDate ?? null,
      holdId: hold.id,
    };
  }

  private async requestHumanCallback(
    args: Record<string, unknown>,
    ctx: ReceptionistAgentToolContext,
  ): Promise<Record<string, unknown>> {
    const reason = readString(args.reason);
    const name = readString(args.name);
    const phone = readString(args.phone) ?? ctx.patientPhone ?? null;
    if (!phone) {
      return { error: 'phone_required' };
    }

    const [callback] = await this.repos.appointmentLifecycle.insertCallbackRequest({
      clinicId: ctx.clinicId,
      patientName: name,
      patientPhone: phone,
      reason,
      status: 'pending',
      sourceSessionId: ctx.sessionId,
    });

    if (callback) {
      await this.staffNotification.notifyStaffActionRequest({
        clinicId: ctx.clinicId,
        eventType: 'staff.callback_request',
        templateKey: 'handoff.created',
        deduplicationKey: `agent-callback:${ctx.sessionId}:${callback.id}`,
        payload: {
          callback_request_id: callback.id,
          session_id: ctx.sessionId,
          reason,
          patient_name: name,
          patient_phone: phone,
        },
      });
    }

    return { submitted: true, callbackRequestId: callback?.id ?? null };
  }

  private async getAppointmentStatus(
    args: Record<string, unknown>,
    ctx: ReceptionistAgentToolContext,
  ): Promise<Record<string, unknown>> {
    const rawPhone = readString(args.phone) ?? ctx.patientPhone;
    if (!rawPhone) {
      return { error: 'phone_required' };
    }

    const digitsOnly = rawPhone.replace(/\D/g, '');
    const phone = digitsOnly.startsWith('91') ? `+${digitsOnly}` : digitsOnly;

    const candidates = await this.appointmentLookup.listAppointmentCandidates(ctx.clinicId, phone);
    if (candidates.length === 0) {
      return { error: 'no_appointments', phone };
    }

    const latest = candidates[0]!;
    const [appointment] = await this.repos.appointmentLifecycle.findAppointmentById(
      ctx.clinicId,
      latest.appointment_id,
    );
    if (!appointment) {
      return { error: 'appointment_not_found', appointmentId: latest.appointment_id };
    }

    return {
      found: true,
      appointmentId: appointment.id,
      status: appointment.status,
      patientName: appointment.patientName,
      patientPhone: appointment.patientPhone,
      doctorId: appointment.doctorId,
      appointmentStart: appointment.appointmentStart,
      appointmentEnd: appointment.appointmentEnd,
      reason: appointment.reasonForVisit,
      createdAt: appointment.createdAt,
    };
  }

  private updateBookingState(
    args: Record<string, unknown>,
    ctx: ReceptionistAgentToolContext,
  ): Record<string, unknown> {
    const rawFields = args.fields;
    if (!rawFields || typeof rawFields !== 'object' || Array.isArray(rawFields)) {
      return { error: 'fields_required' };
    }

    const collected = parseBookingCollected(ctx.collected);
    const incoming = rawFields as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(incoming)) {
      if (!BOOKING_STATE_FIELDS.has(key)) {
        continue;
      }
      if (value === null || value === undefined || value === '') {
        continue;
      }
      patch[key] = value;
    }

    let next = collected;
    if (patch.reason_for_visit && typeof patch.reason_for_visit === 'string') {
      next = applyReasonForVisitUpdate(next, patch.reason_for_visit);
      delete patch.reason_for_visit;
    }
    const normalizeDoctorName = (name: string): string =>
      name.replace(/^(dr\.?\s*|doctor\s+)/i, '').trim();

    const merged = mergeCollected(next, {
      ...(patch.doctor_id ? { doctor_id: String(patch.doctor_id) } : {}),
      ...(patch.doctor_name ? { doctor_name: normalizeDoctorName(String(patch.doctor_name)) } : {}),
      ...(patch.clinic_service_id ? { clinic_service_id: String(patch.clinic_service_id) } : {}),
      ...(patch.preferred_date ? { preferred_date: String(patch.preferred_date) } : {}),
      ...(patch.time_preference ? { time_preference: parseTimePreference(patch.time_preference) ?? undefined } : {}),
      ...(patch.patient_name ? { patient_name: String(patch.patient_name) } : {}),
      ...(patch.selected_slot_id ? { selected_slot_id: String(patch.selected_slot_id) } : {}),
      ...(patch.routing_source ? { routing_source: String(patch.routing_source) as typeof collected.routing_source } : {}),
    });

    if (patch.patient_phone) {
      (merged as Record<string, unknown>).patient_phone = String(patch.patient_phone);
    }
    if (patch.agent_clarify_count !== undefined && patch.agent_clarify_count !== null) {
      (merged as Record<string, unknown>).agent_clarify_count = Number(patch.agent_clarify_count);
    }
    if (patch.last_clarify_reply) {
      (merged as Record<string, unknown>).last_clarify_reply = String(patch.last_clarify_reply);
    }

    return {
      collected: merged as Record<string, unknown>,
      mergedFields: Object.keys(patch),
    };
  }

  private async resolveDoctorAndService(
    ctx: ReceptionistAgentToolContext,
    collected: ReturnType<typeof parseBookingCollected>,
    doctorName: string | null,
    reasonForVisit: string | null,
  ): Promise<
    | { doctorId: string; doctorName: string; clinicServiceId: string }
    | { error: string }
  > {
    let doctorId = collected.doctor_id ?? null;
    let resolvedDoctorName = collected.doctor_name ?? doctorName;
    let clinicServiceId = collected.clinic_service_id ?? null;

    if (doctorName) {
      const cleanName = doctorName.replace(/^(dr\.?\s*|doctor\s+)/i, '').trim();
      const doctors = await this.repos.clinical.findDoctorByNameFragment(ctx.clinicId, cleanName);
      if (doctors.length === 0) {
        return { error: 'doctor_not_found' };
      }
      doctorId = doctors[0]!.id;
      resolvedDoctorName = doctors[0]!.name;
    }

    if (!clinicServiceId && reasonForVisit) {
      const services = await this.repos.clinical.listServices(ctx.clinicId);
      const activeClinicServices = services
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
      const routed = await this.serviceRouter.route({
        clinicId: ctx.clinicId,
        reasonForVisit,
        activeClinicServices,
      });
      if (routed.matched && routed.clinicServiceId) {
        clinicServiceId = routed.clinicServiceId;
      }
    }

    if (!doctorId && clinicServiceId) {
      const mappings = await this.repos.clinical.listActiveDoctorServicesForClinicService(
        ctx.clinicId,
        clinicServiceId,
      );
      if (mappings.length > 0) {
        doctorId = mappings[0]!.doctorId;
        resolvedDoctorName = mappings[0]!.doctorName;
      }
    }

    if (!doctorId) {
      return { error: 'doctor_required' };
    }

    if (!clinicServiceId) {
      const mappings = await this.repos.clinical.listActiveDoctorServicesForDoctor(
        ctx.clinicId,
        doctorId,
      );
      if (mappings.length === 0) {
        return { error: 'no_service_for_doctor' };
      }
      clinicServiceId = mappings[0]!.clinicServiceId;
    }

    return {
      doctorId,
      doctorName: resolvedDoctorName ?? 'Doctor',
      clinicServiceId,
    };
  }

  private async resolveAppointmentRef(
    ctx: ReceptionistAgentToolContext,
    phone: string | null,
    appointmentRef: string | null,
  ) {
    if (appointmentRef && appointmentRef.includes('-')) {
      const [appointment] = await this.repos.appointmentLifecycle.findAppointmentById(
        ctx.clinicId,
        appointmentRef,
      );
      return appointment ?? null;
    }

    const candidates = await this.appointmentLookup.listAppointmentCandidates(ctx.clinicId, phone);
    if (candidates.length === 0) {
      return null;
    }
    if (!appointmentRef) {
      return (await this.repos.appointmentLifecycle.findAppointmentById(
        ctx.clinicId,
        candidates[0]!.appointment_id,
      ))?.[0] ?? null;
    }
    const index = Number(appointmentRef);
    if (Number.isFinite(index) && index >= 1 && index <= candidates.length) {
      const candidate = candidates[index - 1]!;
      const [appointment] = await this.repos.appointmentLifecycle.findAppointmentById(
        ctx.clinicId,
        candidate.appointment_id,
      );
      return appointment ?? null;
    }
    const byLabel = candidates.find((candidate) => candidate.display_label.includes(appointmentRef));
    if (!byLabel) {
      return null;
    }
    const [appointment] = await this.repos.appointmentLifecycle.findAppointmentById(
      ctx.clinicId,
      byLabel.appointment_id,
    );
    return appointment ?? null;
  }
}
