import { Body, Controller, Get, Inject, Post, Query, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { type ApiEnv } from '@vaidya/config';
import {
  createRepositories,
  addDays,
  dayOfWeekMon1,
  formatDateInTimezone,
  ACTIVE_APPOINTMENT_STATUSES,
  toStoredDayOfWeek,
  type Repositories,
} from '@vaidya/db';
import {
  ADAPTER_TOKENS,
  BOOKING_HORIZON_DAYS,
  extractActivePreferredDate,
  type ServiceRouterAdapter,
  type TimePreference,
} from '@vaidya/shared';
import type { DatabaseConnection } from '@vaidya/db';
import { API_ENV } from '../../config/api-config.module';
import { DATABASE_CONNECTION } from '../database/database.module';
import { BookingAppointmentService } from '../booking/booking-appointment.service';
import { KnowledgeSearchService } from '../knowledge/knowledge-search.service';
import { AppointmentLookupService } from '../patient-action/appointment-lookup.service';
import { StaffNotificationService } from '../patient-action/staff-notification.service';
import {
  formatClinicHoursText,
  formatDayHoursText,
  formatFeeAmount,
  resolveTodayDayOfWeek,
} from '../structured-info/structured-info-field-extractor';
import { SlotHoldService } from '../slots/slot-hold.service';
import { SlotService } from '../slots/slot.service';
import { Public } from '../../common/decorators/public.decorator';
import { SkipApiEnvelope } from '../../common/decorators/skip-api-envelope.decorator';
import { publicService, resolveSarvamRouting, type RoutingService } from './sarvam-routing';
import {
  availabilityOverview,
  availabilityWindow,
  chooseAvailability,
  type DoctorAvailability,
} from './sarvam-availability';

const CLINIC_INFO_TOPICS = [
  'services',
  'fee',
  'timing',
  'location',
  'parking',
  'insurance',
  'documents',
  'doctor_availability',
] as const;

type ClinicInfoTopic = (typeof CLINIC_INFO_TOPICS)[number];

function parseBody(body: unknown): Record<string, unknown> {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const obj = body as Record<string, unknown>;
    if ('(raw)' in obj) {
      const raw = obj['(raw)'];
      return typeof raw === 'string'
        ? parseBody(raw)
        : typeof raw === 'object' && raw !== null
          ? (raw as Record<string, unknown>)
          : {};
    }
    return obj;
  }
  return {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readParam(b: Record<string, unknown>, req: FastifyRequest, name: string): string | null {
  return (
    readString(b[name]) ??
    readString(req.headers[name]) ??
    readString(req.headers[name.toLowerCase()]) ??
    readString(req.headers[name.replace(/_/g, '-')]) ??
    null
  );
}

function parseTimePreference(value: unknown): TimePreference | null {
  if (value === 'morning' || value === 'afternoon' || value === 'evening') return value;
  return null;
}

function normalizeTimeTo24h(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^0+(?=\d)/, '');
  const match = /^(\d{1,2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i.exec(trimmed);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  const period = (match[3] ?? '').toUpperCase();
  if (period && (hour < 1 || hour > 12)) return null;
  if (period === 'PM' && hour < 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseOptionalTimestamp(value: unknown): Date | undefined {
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  return undefined;
}

function parseOptionalInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function formatDateDisplay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  const jsDate = new Date(Date.UTC(year, month - 1, day));
  return `${WEEKDAY_NAMES[jsDate.getUTCDay()]}, ${MONTH_NAMES[month - 1]} ${day}`;
}

function parseClinicStartTime(
  startTime: string,
): { date: string; hour: number; minute: number } | null {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(startTime);
  if (!match) return null;
  return { date: match[1]!, hour: Number(match[2]), minute: Number(match[3]) };
}

function formatTimeText(startTime: string): string {
  const parsed = parseClinicStartTime(startTime);
  if (!parsed) return startTime.slice(11, 16);
  const hour12 = parsed.hour % 12 === 0 ? 12 : parsed.hour % 12;
  const minute = String(parsed.minute).padStart(2, '0');
  const period =
    parsed.hour < 12 ? 'in the morning' : parsed.hour < 17 ? 'in the afternoon' : 'in the evening';
  return `${hour12}:${minute} ${period}`;
}

type SlotLike = { start_time: string; slot_id: string };

function findSlotByDateAndTime(
  slots: SlotLike[],
  requestedDate: string | null,
  timeInput: string | null,
): SlotLike | undefined {
  if (!timeInput) return undefined;
  const input = normalizeTimeTo24h(timeInput);
  if (!input) return undefined;
  return slots.find((slot) => {
    const parsed = parseClinicStartTime(slot.start_time);
    if (!parsed) return false;
    if (requestedDate && parsed.date !== requestedDate) return false;
    const minute = String(parsed.minute).padStart(2, '0');
    const display24 = `${String(parsed.hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    return input === display24;
  });
}

function joinTimesText(times: string[], timePreference: TimePreference | null): string {
  if (times.length === 0) return timePreference ? `no ${timePreference} slots` : 'no slots';
  return times.join(', ');
}

function isScheduleEffective(
  row: { effectiveFrom: string | null; effectiveTo: string | null },
  targetDate: string,
): boolean {
  if (row.effectiveFrom && targetDate < row.effectiveFrom.slice(0, 10)) return false;
  if (row.effectiveTo && targetDate > row.effectiveTo.slice(0, 10)) return false;
  return true;
}

function dedupeTimeRanges(ranges: string[]): string[] {
  return [...new Set(ranges)];
}

function normaliseScheduleTiming(range: string): string {
  const [start, end] = range.split('-');
  if (!start || !end) return range;
  const to12h = (t: string): string => {
    const [hour, minute] = t.split(':').map(Number);
    if (hour === undefined || minute === undefined) return t;
    const period = hour < 12 ? 'AM' : 'PM';
    const displayHour = hour % 12 === 0 ? 12 : hour % 12;
    return `${displayHour}:${String(minute).padStart(2, '0')} ${period}`;
  };
  return `${to12h(start)} - ${to12h(end)}`;
}

@SkipApiEnvelope()
@Controller('api/tools')
export class SarvamToolsController {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(SlotService) private readonly slotService: SlotService,
    @Inject(SlotHoldService) private readonly slotHoldService: SlotHoldService,
    @Inject(BookingAppointmentService)
    private readonly bookingAppointmentService: BookingAppointmentService,
    @Inject(KnowledgeSearchService) private readonly knowledgeSearchService: KnowledgeSearchService,
    @Inject(AppointmentLookupService) private readonly appointmentLookup: AppointmentLookupService,
    @Inject(StaffNotificationService) private readonly staffNotification: StaffNotificationService,
    @Inject(ADAPTER_TOKENS.ServiceRouterAdapter)
    private readonly serviceRouter: ServiceRouterAdapter,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    this.repos = createRepositories(connection.db);
  }

  @Public()
  @Get('clinic-by-phone')
  async getClinicByPhone(@Query('clinic_phone') phoneParam: unknown) {
    const phone = readString(phoneParam);
    if (!phone) return { error: 'clinic_phone_required' };

    const [clinic] = await this.repos.clinics.findClinicByPhone(phone);
    if (!clinic) return { found: false, error: 'clinic_not_found' };

    const timezone = clinic.timezone ?? 'Asia/Kolkata';
    const hours = await this.repos.slots.listClinicHours(clinic.id);

    const sessionId = await this.createSarvamSession(clinic.id);

    const addressParts = [
      clinic.addressLine1,
      clinic.addressLine2,
      clinic.city,
      clinic.state,
    ].filter((part): part is string => Boolean(part));

    return {
      found: true,
      error: '',
      sessionId,
      clinicId: clinic.id,
      clinicName: clinic.name,
      currentDate: formatDateInTimezone(new Date(), timezone),
      timezone,
      location: {
        address: addressParts.join(', ') || null,
        city: clinic.city ?? null,
        state: clinic.state ?? null,
      },
      timing: {
        hoursSummary: formatClinicHoursText(hours),
        timezone,
      },
    };
  }

  @Public()
  @Get('clinic-info')
  async getClinicInfo(@Query() query: unknown, @Req() req: FastifyRequest) {
    const b = parseBody(query);
    const clinicId = readParam(b, req, 'clinic_id');
    if (!clinicId) return { error: 'clinic_id_required' };

    const topic = readParam(b, req, 'topic') as ClinicInfoTopic | null;
    if (!topic || !CLINIC_INFO_TOPICS.includes(topic)) {
      return { error: 'invalid_topic', allowed: CLINIC_INFO_TOPICS };
    }
    if (topic === 'services') return { topic, error: '', ...(await this.listServices(query, req)) };

    const doctorId = readParam(b, req, 'doctor_id');
    const day = readParam(b, req, 'day');
    const [clinic] = await this.repos.clinics.getClinicLocation(clinicId);
    const timezone = clinic?.timezone ?? 'Asia/Kolkata';

    if (topic === 'location') {
      const addressParts = [
        clinic?.addressLine1,
        clinic?.addressLine2,
        clinic?.city,
        clinic?.state,
      ].filter((part): part is string => Boolean(part));
      return {
        topic,
        found: addressParts.length > 0,
        error: '',
        address: addressParts.join(', ') || null,
        city: clinic?.city ?? null,
        state: clinic?.state ?? null,
      };
    }

    if (topic === 'timing') {
      const hours = await this.repos.slots.listClinicHours(clinicId);
      if (!day) {
        return {
          topic,
          found: hours.length > 0,
          error: '',
          hoursSummary: formatClinicHoursText(hours),
          timezone,
        };
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
      if (!dayOfWeek) return { topic, found: false, error: 'day_not_understood', day };
      const dayHours = hours.filter((row) => row.dayOfWeek === toStoredDayOfWeek(dayOfWeek));
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      return {
        topic,
        found: dayHours.length > 0,
        error: '',
        day: dayNames[dayOfWeek - 1] ?? day,
        hours: dayHours.length > 0 ? formatDayHoursText(dayHours) : 'closed',
        timezone,
      };
    }

    if (topic === 'fee') {
      if (!doctorId) return { topic, found: false, error: 'doctor_id_required' };
      const [feeInfo] = await this.repos.clinical.getDoctorFeeInfo(clinicId, doctorId);
      const [doctor] = await this.repos.doctors.findDoctorById(clinicId, doctorId);
      if (!feeInfo || !doctor) return { topic, found: false, error: '', doctorId };
      return {
        topic,
        found: true,
        error: '',
        doctorId: doctor.id,
        doctorName: doctor.name,
        consultationFee: formatFeeAmount(feeInfo.consultationFeeAmount),
        followupFee: formatFeeAmount(feeInfo.followupFeeAmount),
        currency: 'INR',
      };
    }

    if (topic === 'doctor_availability') {
      if (!doctorId) return { topic, found: false, error: 'doctor_id_required' };
      const [doctor] = await this.repos.doctors.findDoctorById(clinicId, doctorId);
      if (!doctor)
        return {
          topic,
          found: false,
          error: '',
          doctorId,
          available: false,
          timings: [],
          timingsText: '',
        };
      const referenceDate = formatDateInTimezone(new Date(), timezone);
      const targetDate =
        (day ? extractActivePreferredDate(day, referenceDate) : null) ?? referenceDate;
      const dayOfWeek = dayOfWeekMon1(targetDate, timezone);
      const schedules = await this.repos.clinicalSetup.listDoctorSchedules(clinicId, doctor.id);
      const applicable = schedules.filter(
        (row) =>
          row.active &&
          row.dayOfWeek === toStoredDayOfWeek(dayOfWeek) &&
          isScheduleEffective(row, targetDate),
      );
      const timings = dedupeTimeRanges(
        applicable.map((row) => `${row.startTime.slice(0, 5)}-${row.endTime.slice(0, 5)}`),
      );
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      if (timings.length === 0) {
        return {
          topic,
          found: false,
          error: '',
          doctorId: doctor.id,
          doctorName: doctor.name,
          date: targetDate,
          availabilityDay: dayNames[dayOfWeek - 1] ?? null,
          available: false,
          timings: [],
          timingsText: '',
        };
      }
      return {
        topic,
        found: true,
        error: '',
        doctorId: doctor.id,
        doctorName: doctor.name,
        date: targetDate,
        availabilityDay: dayNames[dayOfWeek - 1] ?? null,
        available: true,
        timings: timings.map((range) => normaliseScheduleTiming(range)),
        timingsText: timings.map((range) => normaliseScheduleTiming(range)).join(', '),
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
      clinicId,
      knowledgeQuery,
      topic,
    );
    return {
      topic,
      found: Boolean(knowledge?.meetsThreshold),
      error: '',
      answer: knowledge?.answer ?? null,
      score: knowledge?.score ?? null,
      category: knowledge?.category ?? null,
    };
  }

  @Public()
  @Get('search-knowledge')
  async searchKnowledge(@Query() query: unknown, @Req() req: FastifyRequest) {
    const b = parseBody(query);
    const clinicId = readParam(b, req, 'clinic_id');
    if (!clinicId) return { error: 'clinic_id_required' };
    const queryText = readParam(b, req, 'query');
    if (!queryText) return { found: false, error: 'query_required' };
    const result = await this.knowledgeSearchService.searchApprovedKnowledge(clinicId, queryText);
    if (!result?.meetsThreshold) return { found: false, error: '', score: result?.score ?? null };
    return {
      found: true,
      error: '',
      answer: result.answer,
      score: result.score,
      category: result.category,
    };
  }

  @Public()
  @Get('list-services')
  async listServices(@Query() query: unknown, @Req() req: FastifyRequest) {
    const b = parseBody(query);
    const clinicId = readParam(b, req, 'clinic_id');
    if (!clinicId) return { error: 'clinic_id_required' };

    const catalog = await this.serviceCatalog(clinicId);
    return {
      found: catalog.length > 0,
      services: catalog.map(publicService),
      serviceNames: catalog.map((service) => service.name),
      servicesText: catalog.map((service) => service.name).join(', '),
      serviceRoutingText: catalog
        .map(
          (service) =>
            `${service.name}: service_key=${service.serviceKey}; handles=${JSON.stringify(service.handlesJson ?? [])}; does_not_handle=${JSON.stringify(service.doesNotHandleJson ?? [])}; examples=${JSON.stringify(service.routingExamplesJson ?? [])}`,
        )
        .join('\n'),
    };
  }

  @Public()
  @Get('recommend-service')
  async recommendService(@Query() query: unknown, @Req() req: FastifyRequest) {
    const b = parseBody(query);
    const clinicId = readParam(b, req, 'clinic_id');
    if (!clinicId) return { error: 'clinic_id_required' };
    const target = await this.resolveDoctorAndService(
      clinicId,
      readParam(b, req, 'doctor_id'),
      readParam(b, req, 'clinic_service_id'),
      readParam(b, req, 'reason_for_visit'),
      readParam(b, req, 'doctor_name'),
      readParam(b, req, 'service_key'),
    );
    return { error: '', matched: !('error' in target), ...target };
  }

  @Public()
  @Get('check-slots')
  async checkSlots(@Query() query: unknown, @Req() req: FastifyRequest) {
    const b = parseBody(query);
    const clinicId = readParam(b, req, 'clinic_id');
    if (!clinicId) return { error: 'clinic_id_required' };

    const [clinic] = await this.repos.clinics.getClinicLocation(clinicId);
    const timezone = clinic?.timezone ?? 'Asia/Kolkata';
    const referenceDate = formatDateInTimezone(new Date(), timezone);
    const horizonEnd = addDays(referenceDate, BOOKING_HORIZON_DAYS, timezone);
    const mode = readParam(b, req, 'mode') ?? 'search';
    if (mode !== 'search' && mode !== 'overview') return { success: false, error: 'invalid_mode' };

    const doctorId = readParam(b, req, 'doctor_id');
    const clinicServiceId = readParam(b, req, 'clinic_service_id');
    const reasonForVisit = readParam(b, req, 'reason_for_visit');
    const dateInput = readParam(b, req, 'date');
    const timePreferenceRaw =
      b.time_preference ?? req.headers.time_preference ?? req.headers['time-preference'];
    const timePreference = parseTimePreference(timePreferenceRaw);
    if (timePreferenceRaw != null && timePreferenceRaw !== '' && !timePreference) {
      return { success: false, error: 'invalid_time_preference' };
    }
    const afterTimeRaw = readParam(b, req, 'after_time');
    const afterTime = afterTimeRaw ? normalizeTimeTo24h(afterTimeRaw) : null;
    const beforeTimeRaw = readParam(b, req, 'before_time');
    const beforeTime = beforeTimeRaw ? normalizeTimeTo24h(beforeTimeRaw) : null;
    const exactTimeRaw = readParam(b, req, 'time');
    const exactTime = exactTimeRaw ? normalizeTimeTo24h(exactTimeRaw) : null;
    if (afterTimeRaw && !afterTime) return { success: false, error: 'invalid_after_time' };
    if (beforeTimeRaw && !beforeTime) return { success: false, error: 'invalid_before_time' };
    if (exactTimeRaw && !exactTime) return { success: false, error: 'invalid_time' };
    const window = availabilityWindow(timePreference, afterTime, beforeTime, exactTime);
    const beforeMidnightOnly =
      beforeTime === '00:00' && !afterTime && !exactTime && !timePreference;
    if (window.lower >= window.upper && !beforeMidnightOnly) {
      return { success: false, error: 'invalid_time_range' };
    }
    if (mode === 'overview' && (timePreference || afterTime || beforeTime || exactTime)) {
      return { success: false, error: 'overview_requires_no_time_filters' };
    }
    const resolveDate = (value: string | null) => {
      if (!value) return null;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? value
        : extractActivePreferredDate(value, referenceDate);
      if (!date) return null;
      const parsed = new Date(`${date}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
        ? date
        : null;
    };
    const preferredDate = resolveDate(dateInput);
    if (mode === 'search' && !dateInput) return { success: false, error: 'date_required' };
    if (dateInput && !preferredDate) return { success: false, error: 'invalid_date' };
    const fromRaw = readParam(b, req, 'from_date');
    const toRaw = readParam(b, req, 'to_date');
    if ((mode === 'search' && (fromRaw || toRaw)) || (dateInput && (fromRaw || toRaw))) {
      return { success: false, error: 'invalid_date_range' };
    }
    const from = preferredDate ?? (fromRaw ? resolveDate(fromRaw) : referenceDate);
    const to = preferredDate ?? (toRaw ? resolveDate(toRaw) : horizonEnd);
    if (!from || !to || from > to) return { success: false, error: 'invalid_date_range' };
    if (from < referenceDate) return { success: false, error: 'past_date' };
    if (to > horizonEnd) return { success: false, error: 'outside_booking_horizon' };

    const target = await this.resolveDoctorAndService(
      clinicId,
      doctorId,
      clinicServiceId,
      reasonForVisit,
      readParam(b, req, 'doctor_name'),
      readParam(b, req, 'service_key'),
    );
    if ('error' in target) return { success: false, ...target };
    const excluded = new Set(
      (readParam(b, req, 'exclude_doctor_ids') ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    );
    if (excluded.size > 100) return { success: false, error: 'too_many_excluded_doctors' };
    if (target.doctorId && excluded.has(target.doctorId)) {
      return { success: false, error: 'doctor_excluded', needsClarification: true };
    }
    const doctors = target.doctors.filter(
      (doctor) =>
        (!target.doctorId || doctor.doctorId === target.doctorId) && !excluded.has(doctor.doctorId),
    );
    // Bound concurrent DB work; overview reads once per doctor, never once per day.
    const availability: DoctorAvailability[] = [];
    for (let index = 0; index < doctors.length; index += 4) {
      availability.push(
        ...(await Promise.all(
          doctors.slice(index, index + 4).map(async (doctor) => ({
            doctor,
            rows: await this.slotService.findAvailableSlots(
              clinicId,
              doctor.doctorId,
              target.clinicServiceId,
              preferredDate ?? undefined,
            ),
          })),
        )),
      );
    }
    if (mode === 'overview') {
      const doctorAvailability = availabilityOverview(availability, from, to);
      const availableDates = [
        ...new Set(
          doctorAvailability.flatMap((doctor) =>
            doctor.availableDatesText.split(', ').filter(Boolean),
          ),
        ),
      ].sort();
      return {
        success: true,
        availabilityStatus: 'overview',
        excludedDoctorIdsText: [...excluded].join(','),
        hasAvailability: availableDates.length > 0,
        doctorId: target.doctorId,
        doctorName: target.doctorName,
        clinicServiceId: target.clinicServiceId,
        fromDate: from,
        toDate: to,
        availableSlotsText: '',
        availableDatesText: availableDates.join(', '),
        availabilityText: doctorAvailability
          .map((doctor) => `${doctor.doctorName}: ${doctor.availabilityText || 'no slots'}`)
          .join('\n'),
        availabilityChoicesText: doctorAvailability
          .map(
            (doctor) =>
              `${doctor.doctorName}${doctor.qualification ? ` (${doctor.qualification})` : ''} | doctor_id=${doctor.doctorId} | ${doctor.availabilityText || 'no slots'}`,
          )
          .join('\n'),
        doctorAvailability,
        error: '',
      };
    }
    const selected = chooseAvailability(
      availability,
      preferredDate!,
      window,
      Boolean(beforeTime && !afterTime && !exactTime),
      afterTime || beforeTime || timePreference || exactTime ? 3 : 4,
    );

    return {
      success: true,
      availabilityStatus: selected.status,
      excludedDoctorIdsText: [...excluded].join(','),
      hasAvailability: selected.times.length > 0,
      matchesPreference: selected.status === 'matched',
      suggestAnotherDate: selected.status === 'no_slots',
      doctorSelection: target.doctorId ? 'requested' : selected.doctor ? 'random' : 'none',
      doctorName: selected.doctor?.doctorName ?? target.doctorName,
      doctorId: selected.doctor?.doctorId ?? target.doctorId,
      clinicServiceId: target.clinicServiceId,
      date: preferredDate,
      dateDisplay: formatDateDisplay(preferredDate!),
      timePreference,
      availableSlotsText: joinTimesText(selected.times, timePreference),
      error: '',
    };
  }

  @Public()
  @Post('create-appointment')
  async createAppointment(@Body() body: unknown, @Req() req: FastifyRequest) {
    const b = parseBody(body);
    const clinicId = readParam(b, req, 'clinic_id');
    if (!clinicId) return { error: 'clinic_id_required' };

    const patientName = readParam(b, req, 'patient_name');
    const phone = readParam(b, req, 'phone');
    const doctorId = readParam(b, req, 'doctor_id');
    const clinicServiceId = readParam(b, req, 'clinic_service_id');
    const reasonForVisit = readParam(b, req, 'reason_for_visit');
    const date = readParam(b, req, 'date');
    const slotId = readParam(b, req, 'slot_id');
    const timeInput = readParam(b, req, 'time');

    const missing: string[] = [];
    if (!patientName) missing.push('patient_name');
    if (!phone) missing.push('phone');
    if (!reasonForVisit) missing.push('reason_for_visit');
    if (!date) missing.push('date');
    if (!slotId && !timeInput) missing.push('slot_id_or_time');
    if (missing.length > 0)
      return { error: 'missing_fields', missing, missingFieldsText: missing.join(', ') };

    const target = await this.resolveDoctorAndService(
      clinicId,
      doctorId,
      clinicServiceId,
      reasonForVisit,
      readParam(b, req, 'doctor_name'),
      readParam(b, req, 'service_key'),
    );
    if ('error' in target) return target;
    if (!target.doctorId) return { error: 'doctor_required', needsClarification: true };

    let resolvedSlotId = slotId;

    if (!resolvedSlotId && timeInput) {
      const available = await this.slotService.findAvailableSlots(
        clinicId,
        target.doctorId,
        target.clinicServiceId,
        date ?? undefined,
      );
      const timeMatch = findSlotByDateAndTime(available, date, timeInput);
      if (!timeMatch) return { error: 'invalid_slot_time', time: timeInput, date };
      resolvedSlotId = timeMatch.slot_id;
    }

    const providedSessionId = readParam(b, req, 'session_id');
    const [sessionId, [patient]] = await Promise.all([
      this.resolveSessionId(clinicId, providedSessionId, phone),
      this.repos.patients.upsertByPhone({
        clinicId,
        name: patientName!,
        phone: phone!,
        normalizedPhone: normalizePhone(phone!),
      }),
    ]);

    try {
      const { appointment, hold } =
        await this.bookingAppointmentService.createAppointmentFromFreshHold({
          clinicId,
          sessionId,
          slotId: resolvedSlotId!,
          patientName: patientName!,
          patientPhone: phone,
          reasonForVisit: reasonForVisit!,
          routingSource: 'service_router',
          patientId: patient?.id ?? null,
          expectedDoctorId: target.doctorId,
          expectedClinicServiceId: target.clinicServiceId,
        });
      return {
        status: appointment.status === 'confirmed' ? 'confirmed' : 'pending',
        error: '',
        missingFieldsText: '',
        appointmentId: appointment.id,
        patientId: patient?.id ?? null,
        holdId: hold.id,
        doctorId: target.doctorId,
        doctorName: target.doctorName,
        date,
        slotId: resolvedSlotId,
      };
    } catch (error) {
      const err = error as { code?: string };
      if (err?.code === 'SLOT_NOT_AVAILABLE') return { error: 'invalid_slot', slotId };
      return {
        error: 'booking_failed',
        message: error instanceof Error ? error.message : 'unknown_error',
      };
    }
  }

  @Public()
  @Post('create-appointment-fast')
  async createAppointmentFast(@Body() body: unknown, @Req() req: FastifyRequest) {
    const b = parseBody(body);
    const clinicId = readParam(b, req, 'clinic_id');
    if (!clinicId) return { error: 'clinic_id_required' };

    const patientName = readParam(b, req, 'patient_name');
    const phone = readParam(b, req, 'phone');
    const doctorId = readParam(b, req, 'doctor_id');
    const doctorName = readParam(b, req, 'doctor_name');
    const clinicServiceId = readParam(b, req, 'clinic_service_id');
    const reasonForVisit = readParam(b, req, 'reason_for_visit');
    const date = readParam(b, req, 'date');
    const slotId = readParam(b, req, 'slot_id');
    const timeInput = readParam(b, req, 'time');

    const missing: string[] = [];
    if (!patientName) missing.push('patient_name');
    if (!phone) missing.push('phone');
    if (!doctorId) missing.push('doctor_id');
    if (!clinicServiceId) missing.push('clinic_service_id');
    if (!reasonForVisit) missing.push('reason_for_visit');
    if (!date) missing.push('date');
    if (!slotId && !timeInput) missing.push('slot_id_or_time');
    if (missing.length > 0)
      return { error: 'missing_fields', missing, missingFieldsText: missing.join(', ') };

    const target = await this.resolveDoctorAndService(
      clinicId,
      doctorId,
      clinicServiceId,
      null,
      doctorName,
    );
    if ('error' in target) return target;
    if (!target.doctorId) return { error: 'doctor_required', needsClarification: true };
    let resolvedSlotId = slotId;

    if (!resolvedSlotId && timeInput) {
      const normalizedTime = normalizeTimeTo24h(timeInput);
      if (!normalizedTime) return { error: 'invalid_slot_time', time: timeInput, date };
      const [timeSlot] = await this.repos.slots.findSlotByExactTime(
        clinicId,
        target.doctorId,
        target.clinicServiceId,
        date!,
        normalizedTime,
      );
      if (!timeSlot) return { error: 'invalid_slot_time', time: timeInput, date };
      resolvedSlotId = timeSlot.id;
    }

    const providedSessionId = readParam(b, req, 'session_id');
    const [sessionId, [patient]] = await Promise.all([
      this.resolveSessionId(clinicId, providedSessionId, phone),
      this.repos.patients.upsertByPhone({
        clinicId,
        name: patientName!,
        phone: phone!,
        normalizedPhone: normalizePhone(phone!),
      }),
    ]);

    try {
      const { appointment, hold } =
        await this.bookingAppointmentService.createAppointmentFromFreshHold({
          clinicId,
          sessionId,
          slotId: resolvedSlotId!,
          patientName: patientName!,
          patientPhone: phone,
          reasonForVisit: reasonForVisit!,
          routingSource: 'service_router',
          patientId: patient?.id ?? null,
          expectedDoctorId: target.doctorId,
          expectedClinicServiceId: target.clinicServiceId,
        });
      return {
        status: appointment.status === 'confirmed' ? 'confirmed' : 'pending',
        error: '',
        missingFieldsText: '',
        appointmentId: appointment.id,
        patientId: patient?.id ?? null,
        holdId: hold.id,
        doctorId: target.doctorId,
        doctorName: target.doctorName,
        date,
        slotId: resolvedSlotId,
      };
    } catch (error) {
      const err = error as { code?: string };
      if (err?.code === 'SLOT_NOT_AVAILABLE') return { error: 'invalid_slot', slotId };
      return {
        error: 'booking_failed',
        message: error instanceof Error ? error.message : 'unknown_error',
      };
    }
  }

  @Public()
  @Post('cancel-appointment')
  async cancelAppointment(@Body() body: unknown, @Req() req: FastifyRequest) {
    const b = parseBody(body);
    const clinicId = readParam(b, req, 'clinic_id');
    if (!clinicId) return { error: 'clinic_id_required' };

    const phone = readParam(b, req, 'phone');
    const appointmentRef = readParam(b, req, 'appointment_id');

    const appointment = await this.resolveAppointmentRef(clinicId, phone, appointmentRef);
    if (!appointment) return { error: 'appointment_not_found' };
    if (
      !ACTIVE_APPOINTMENT_STATUSES.includes(
        appointment.status as 'pending_confirmation' | 'confirmed',
      )
    ) {
      return {
        error: 'appointment_not_active',
        appointmentId: appointment.id,
        status: appointment.status,
      };
    }

    const sessionId = await this.resolveSessionId(clinicId, readParam(b, req, 'session_id'), phone);

    await this.slotHoldService.cancelAppointment(clinicId, appointment.id);
    await this.repos.appointmentLifecycle.rejectPendingActionRequestsForAppointment(
      clinicId,
      appointment.id,
    );
    await this.repos.appointmentLifecycle.insertActionRequest({
      clinicId,
      appointmentId: appointment.id,
      requestType: 'cancel',
      requestedBy: 'patient_call',
      status: 'completed',
      reason: 'Patient confirmed cancellation during the call.',
      sourceSessionId: sessionId,
    });
    await this.staffNotification.notifyStaffActionRequest({
      clinicId,
      eventType: 'appointment.cancelled',
      templateKey: 'cancel.completed',
      deduplicationKey: `sarvam-cancel:${appointment.id}`,
      payload: {
        appointment_id: appointment.id,
        session_id: sessionId,
        cancelled_by: 'patient_call',
        patient_phone: phone,
      },
    });

    return { cancelled: true, error: '', appointmentId: appointment.id };
  }

  @Public()
  @Post('reschedule-appointment')
  async rescheduleAppointment(@Body() body: unknown, @Req() req: FastifyRequest) {
    const b = parseBody(body);
    const clinicId = readParam(b, req, 'clinic_id');
    if (!clinicId) return { error: 'clinic_id_required' };

    const phone = readParam(b, req, 'phone');
    const appointmentRef = readParam(b, req, 'appointment_id');
    const newTime = readParam(b, req, 'new_time');
    const newDate = readParam(b, req, 'new_date');

    if (!newTime) return { error: 'new_time_required' };

    const appointment = await this.resolveAppointmentRef(clinicId, phone, appointmentRef);
    if (!appointment) return { error: 'appointment_not_found' };
    if (
      !ACTIVE_APPOINTMENT_STATUSES.includes(
        appointment.status as 'pending_confirmation' | 'confirmed',
      )
    ) {
      return { error: 'appointment_not_active', appointmentId: appointment.id };
    }

    const available = await this.slotService.findAvailableSlots(
      clinicId,
      appointment.doctorId,
      appointment.clinicServiceId,
      newDate ?? undefined,
    );
    const timeMatch = findSlotByDateAndTime(available, newDate, newTime);
    if (!timeMatch) return { error: 'invalid_slot_time', time: newTime, date: newDate };
    const newSlotId = timeMatch.slot_id;

    const sessionId = await this.resolveSessionId(clinicId, readParam(b, req, 'session_id'), phone);

    const hold = await this.slotHoldService.holdSlot({
      clinicId,
      slotId: newSlotId,
      sessionId,
      ...(phone ? { patientPhone: phone } : {}),
    });

    const [actionRequest] = await this.repos.appointmentLifecycle.insertActionRequest({
      clinicId,
      appointmentId: appointment.id,
      requestType: 'reschedule',
      requestedBy: 'patient_call',
      status: 'pending',
      requestedNewSlotId: newSlotId,
      requestedNewDate: newDate,
      sourceSessionId: sessionId,
    });

    if (actionRequest) {
      await this.staffNotification.notifyStaffActionRequest({
        clinicId,
        eventType: 'staff.action_request',
        templateKey: 'reschedule.request_submitted',
        deduplicationKey: `sarvam-reschedule:${appointment.id}`,
        payload: {
          action_request_id: actionRequest.id,
          appointment_id: appointment.id,
          request_type: 'reschedule',
          requested_new_slot_id: newSlotId,
        },
      });
    }

    return {
      submitted: true,
      error: '',
      appointmentId: appointment.id,
      actionRequestId: actionRequest?.id ?? null,
      newTime,
      newDate: newDate ?? null,
      holdId: hold.id,
    };
  }

  @Public()
  @Post('request-callback')
  async requestCallback(@Body() body: unknown, @Req() req: FastifyRequest) {
    const b = parseBody(body);
    const clinicId = readParam(b, req, 'clinic_id');
    if (!clinicId) return { error: 'clinic_id_required' };

    const reason = readParam(b, req, 'reason');
    const name = readParam(b, req, 'name');
    const phone = readParam(b, req, 'phone');
    if (!phone) return { error: 'phone_required' };

    const sessionId = await this.resolveSessionId(clinicId, readParam(b, req, 'session_id'), phone);

    const [callback] = await this.repos.appointmentLifecycle.insertCallbackRequest({
      clinicId,
      patientName: name,
      patientPhone: phone,
      reason,
      status: 'pending',
      sourceSessionId: sessionId,
    });

    if (callback) {
      await this.staffNotification.notifyStaffActionRequest({
        clinicId,
        eventType: 'staff.callback_request',
        templateKey: 'handoff.created',
        deduplicationKey: `sarvam-callback:${callback.id}`,
        payload: {
          callback_request_id: callback.id,
          reason,
          patient_name: name,
          patient_phone: phone,
        },
      });
    }

    return {
      submitted: Boolean(callback),
      error: callback ? '' : 'callback_create_failed',
      callbackRequestId: callback?.id ?? null,
    };
  }

  @Public()
  @Post('record-call')
  async recordCall(@Body() body: unknown, @Req() req: FastifyRequest) {
    const b = parseBody(body);
    const clinicId = readParam(b, req, 'clinic_id');
    if (!clinicId) return { error: 'clinic_id_required' };

    const callId = readParam(b, req, 'call_id');
    const sessionId = readParam(b, req, 'session_id');
    const patientPhone = readParam(b, req, 'patient_phone');
    const patientId = readParam(b, req, 'patient_id');
    const provider = readParam(b, req, 'provider');
    const providerCallId = readParam(b, req, 'provider_call_id');
    const outcome = readParam(b, req, 'outcome');
    const summary = readParam(b, req, 'summary');
    const recordingUrl = readParam(b, req, 'recording_url');
    const recordingStorageKey = readParam(b, req, 'recording_storage_key');

    const startedAt = parseOptionalTimestamp(b.started_at);
    const endedAt = parseOptionalTimestamp(b.ended_at);
    const durationSeconds = parseOptionalInt(b.duration_seconds);

    const patch: Record<string, unknown> = {
      clinicId,
      ...(sessionId ? { sessionId } : {}),
      ...(patientPhone ? { patientPhone } : {}),
      ...(patientId ? { patientId } : {}),
      ...(provider ? { provider } : {}),
      ...(providerCallId ? { providerCallId } : {}),
      ...(outcome ? { outcome } : {}),
      ...(summary ? { summary } : {}),
      ...(recordingUrl ? { recordingUrl } : {}),
      ...(recordingStorageKey ? { recordingStorageKey } : {}),
      ...(startedAt ? { startedAt } : {}),
      ...(endedAt ? { endedAt } : {}),
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    };

    const [existing] = callId
      ? await this.repos.voice.findCallById(clinicId, callId)
      : provider && providerCallId
        ? await this.repos.voice.findCallByProviderCallId(clinicId, provider, providerCallId)
        : sessionId
          ? await this.repos.voice.findCallBySessionId(clinicId, sessionId)
          : [];

    if (existing) {
      const [updated] = await this.repos.voice.updateCall(clinicId, existing.id, patch);
      if (!updated) return { error: 'call_update_failed' };
      return { success: true, error: '', action: 'updated', callId: updated.id };
    }

    const insert = {
      clinicId,
      sessionId,
      patientPhone,
      patientId,
      provider,
      providerCallId,
      outcome,
      summary,
      recordingUrl,
      recordingStorageKey,
      startedAt,
      endedAt,
      durationSeconds,
    };
    const [created] = await this.repos.voice.createCall(insert);
    if (!created) return { error: 'call_create_failed' };
    return { success: true, error: '', action: 'created', callId: created.id };
  }

  @Public()
  @Get('appointment-status')
  async getAppointmentStatus(@Query() query: unknown, @Req() req: FastifyRequest) {
    const b = parseBody(query);
    const clinicId = readParam(b, req, 'clinic_id');
    if (!clinicId) return { error: 'clinic_id_required' };
    const phone = readParam(b, req, 'phone');
    if (!phone) return { error: 'phone_required' };

    const candidates = await this.appointmentLookup.listAppointmentCandidates(clinicId, phone);
    if (candidates.length === 0) return { found: false, error: '' };

    const [appointment] = await this.repos.appointmentLifecycle.findAppointmentById(
      clinicId,
      candidates[0]!.appointment_id,
    );
    if (!appointment) return { found: false, error: '' };

    const [doctor] = await this.repos.doctors.findDoctorById(clinicId, appointment.doctorId);
    const parsedTime = parseClinicStartTime(appointment.appointmentStart);

    return {
      found: true,
      error: '',
      appointmentId: appointment.id,
      status: appointment.status,
      statusDisplay:
        appointment.status === 'confirmed' ? 'confirmed' : 'pending confirmation from the clinic',
      doctorId: appointment.doctorId,
      doctorName: doctor?.name ?? 'Doctor',
      clinicServiceId: appointment.clinicServiceId,
      patientName: appointment.patientName,
      patientPhone: appointment.patientPhone,
      reasonForVisit: appointment.reasonForVisit,
      startTime: appointment.appointmentStart,
      date: parsedTime?.date ?? appointment.appointmentStart.slice(0, 10),
      dateDisplay: parsedTime
        ? formatDateDisplay(parsedTime.date)
        : appointment.appointmentStart.slice(0, 10),
      time: appointment.appointmentStart.slice(11, 16),
      timeText: formatTimeText(appointment.appointmentStart),
    };
  }

  private async createSarvamSession(
    clinicId: string,
    patientPhone?: string | null,
  ): Promise<string> {
    const sessionId = randomUUID();
    const [session] = await this.repos.conversationSessions.create({
      id: sessionId,
      clinicId,
      channel: 'voice_call',
      patientPhone: patientPhone ?? null,
    });
    return session?.id ?? sessionId;
  }

  private async resolveSessionId(
    clinicId: string,
    providedSessionId: string | null,
    patientPhone?: string | null,
  ): Promise<string> {
    if (providedSessionId) return providedSessionId;
    return this.createSarvamSession(clinicId, patientPhone);
  }

  private async serviceCatalog(clinicId: string): Promise<RoutingService[]> {
    const [services, mappings] = await Promise.all([
      this.repos.clinical.listServices(clinicId),
      this.repos.clinical.listActiveDoctorServices(clinicId),
    ]);
    return services
      .filter((service) => service.active)
      .map((service) => ({
        clinicServiceId: service.id,
        name: service.serviceName,
        serviceKey: service.serviceKey,
        handlesJson: service.handlesJson,
        doesNotHandleJson: service.doesNotHandleJson,
        redFlagsJson: service.redFlagsJson,
        routingExamplesJson: service.routingExamplesJson,
        doctors: [
          ...new Map(
            mappings
              .filter((mapping) => mapping.clinicServiceId === service.id)
              .map((mapping) => [
                mapping.doctorId,
                {
                  doctorId: mapping.doctorId,
                  doctorName: mapping.doctorName,
                  qualification: mapping.qualification,
                },
              ]),
          ).values(),
        ].sort(
          (a, b) =>
            a.doctorName.localeCompare(b.doctorName) || a.doctorId.localeCompare(b.doctorId),
        ),
      }))
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name) || a.clinicServiceId.localeCompare(b.clinicServiceId),
      );
  }

  private async resolveDoctorAndService(
    clinicId: string,
    doctorId: string | null,
    clinicServiceId: string | null,
    reasonForVisit: string | null,
    doctorName?: string | null,
    serviceKey?: string | null,
  ) {
    const catalog = await this.serviceCatalog(clinicId);
    return resolveSarvamRouting(
      catalog,
      {
        doctorId,
        doctorName: doctorName ?? null,
        clinicServiceId,
        reasonForVisit,
        serviceKey: serviceKey ?? null,
      },
      async (reason) => {
        const routed = await this.serviceRouter.route({
          clinicId,
          reasonForVisit: reason,
          activeClinicServices: catalog.map((service) => ({
            id: service.clinicServiceId,
            serviceName: service.name,
            serviceKey: service.serviceKey,
            handlesJson: service.handlesJson,
            doesNotHandleJson: service.doesNotHandleJson,
            redFlagsJson: service.redFlagsJson,
            routingExamplesJson: service.routingExamplesJson,
          })),
        });
        return routed.matched ? (routed.clinicServiceId ?? null) : null;
      },
    );
  }

  private async resolveAppointmentRef(
    clinicId: string,
    phone: string | null,
    appointmentRef: string | null,
  ) {
    if (appointmentRef && appointmentRef.includes('-')) {
      const [appointment] = await this.repos.appointmentLifecycle.findAppointmentById(
        clinicId,
        appointmentRef,
      );
      return appointment ?? null;
    }

    const candidates = await this.appointmentLookup.listAppointmentCandidates(clinicId, phone);
    if (candidates.length === 0) return null;

    if (!appointmentRef) {
      return (
        (
          await this.repos.appointmentLifecycle.findAppointmentById(
            clinicId,
            candidates[0]!.appointment_id,
          )
        )?.[0] ?? null
      );
    }
    const index = Number(appointmentRef);
    if (Number.isFinite(index) && index >= 1 && index <= candidates.length) {
      const candidate = candidates[index - 1]!;
      return (
        (
          await this.repos.appointmentLifecycle.findAppointmentById(
            clinicId,
            candidate.appointment_id,
          )
        )?.[0] ?? null
      );
    }
    const byLabel = candidates.find((c) => c.display_label.includes(appointmentRef));
    if (!byLabel) return null;
    return (
      (
        await this.repos.appointmentLifecycle.findAppointmentById(clinicId, byLabel.appointment_id)
      )?.[0] ?? null
    );
  }
}
