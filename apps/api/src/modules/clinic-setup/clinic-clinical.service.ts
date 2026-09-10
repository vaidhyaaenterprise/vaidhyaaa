import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, formatDateInTimezone, type Repositories } from '@vaidya/db';
import type { DatabaseConnection } from '@vaidya/db';
import {
  AppError,
  type CreateDoctorServiceMappingInput,
  type CreateClinicHolidayInput,
  type PatchClinicHolidayInput,
  type ReplaceClinicHoursInput,
  type ReplaceDoctorSchedulesInput,
  type UpdateBookingRuleInput,
  type UpdateDoctorServiceMappingInput,
} from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../database/database.module';
import { ScheduleChangeImpactService } from '../slots/schedule-change-impact.service';
import { SlotGenerationService } from '../slots/slot-generation.service';

function formatTime(value: string): string {
  return value.slice(0, 5);
}

function mapClinicHoursRow(row: {
  id: string;
  clinicId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    clinic_id: row.clinicId,
    day_of_week: row.dayOfWeek,
    start_time: formatTime(row.startTime),
    end_time: formatTime(row.endTime),
    active: row.active,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function mapHolidayRow(row: {
  id: string;
  clinicId: string;
  holidayDate: string;
  isFullDay: boolean;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
  active: boolean;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}, doctorIds: string[] = []) {
  const normalizedDoctorIds = [...doctorIds].sort();

  return {
    id: row.id,
    clinic_id: row.clinicId,
    holiday_date: row.holidayDate,
    is_full_day: row.isFullDay,
    start_time: row.startTime ? formatTime(row.startTime) : null,
    end_time: row.endTime ? formatTime(row.endTime) : null,
    reason: row.reason,
    active: row.active,
    created_by_user_id: row.createdByUserId,
    applies_to_clinic: normalizedDoctorIds.length === 0,
    doctor_ids: normalizedDoctorIds,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function normalizeDoctorIds(doctorIds?: string[]): string[] {
  if (!doctorIds || doctorIds.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const doctorId of doctorIds) {
    const trimmed = doctorId.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function mapScheduleRow(row: {
  id: string;
  clinicId: string;
  doctorId: string;
  doctorServiceId: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    clinic_id: row.clinicId,
    doctor_id: row.doctorId,
    doctor_service_id: row.doctorServiceId,
    day_of_week: row.dayOfWeek,
    start_time: formatTime(row.startTime),
    end_time: formatTime(row.endTime),
    effective_from: row.effectiveFrom,
    effective_to: row.effectiveTo,
    active: row.active,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class ClinicClinicalService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(ScheduleChangeImpactService)
    private readonly scheduleChangeImpact: ScheduleChangeImpactService,
    @Inject(SlotGenerationService)
    private readonly slotGeneration: SlotGenerationService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async listDoctors(clinicId: string) {
    const rows = await this.repos.clinicalSetup.listDoctors(clinicId);
    return rows.map((row) => ({
      id: row.id,
      clinic_id: row.clinicId,
      name: row.name,
      qualification: row.qualification,
      user_id: row.userId,
      active: row.active,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    }));
  }

  async listServices(clinicId: string) {
    const rows = await this.repos.clinicalSetup.listServices(clinicId);
    return rows.map((row) => ({
      id: row.id,
      clinic_id: row.clinicId,
      service_key: row.serviceKey,
      service_name: row.serviceName,
      description: row.description,
      active: row.active,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    }));
  }

  private buildServiceKey(name: string): string {
    const normalized = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    return normalized.length > 0 ? normalized : 'service';
  }

  async createClinicService(
    clinicId: string,
    input: { service_name: string; service_key?: string; active?: boolean },
  ) {
    const trimmedName = input.service_name.trim();
    if (!trimmedName) {
      throw new AppError('VALIDATION_ERROR', 'Service name is required.');
    }

    const existingServices = await this.repos.clinicalSetup.listServices(clinicId);
    const usedKeys = new Set(existingServices.map((row) => row.serviceKey));
    const baseKey = this.buildServiceKey(input.service_key?.trim() || trimmedName);

    let nextKey = baseKey;
    let suffix = 2;
    while (usedKeys.has(nextKey)) {
      nextKey = `${baseKey}_${suffix}`;
      suffix += 1;
    }

    const [row] = await this.repos.clinicalSetup.createClinicService({
      clinicId,
      serviceName: trimmedName,
      serviceKey: nextKey,
      description: null,
      handlesJson: [],
      doesNotHandleJson: [],
      redFlagsJson: [],
      routingExamplesJson: [],
      active: input.active ?? true,
    });

    if (!row) {
      throw new AppError('INTERNAL_ERROR', 'Failed to create clinic service.');
    }

    return {
      id: row.id,
      clinic_id: row.clinicId,
      service_key: row.serviceKey,
      service_name: row.serviceName,
      description: row.description,
      active: row.active,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  async listDoctorServiceMappings(clinicId: string) {
    const rows = await this.repos.clinicalSetup.listDoctorServiceMappings(clinicId);
    return rows.map((row) => ({
      id: row.id,
      clinic_id: row.clinicId,
      doctor_id: row.doctorId,
      clinic_service_id: row.clinicServiceId,
      consultation_fee_amount: row.consultationFeeAmount,
      followup_fee_amount: row.followupFeeAmount,
      followup_valid_days: row.followupValidDays,
      active: row.active,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    }));
  }

  async createDoctorServiceMapping(clinicId: string, input: CreateDoctorServiceMappingInput) {
    await this.repos.clinicalSetup.listDoctors(clinicId).then((rows) => {
      if (!rows.some((row) => row.id === input.doctor_id)) {
        throw new AppError('VALIDATION_ERROR', 'Doctor not found in this clinic.');
      }
    });

    await this.repos.clinicalSetup.listServices(clinicId).then((rows) => {
      if (!rows.some((row) => row.id === input.clinic_service_id)) {
        throw new AppError('VALIDATION_ERROR', 'Service not found in this clinic.');
      }
    });

    const [existing] = await this.repos.clinicalSetup.findDoctorServiceMappingByDoctorAndService(
      clinicId,
      input.doctor_id,
      input.clinic_service_id,
    );

    if (existing) {
      const [updated] = await this.repos.clinicalSetup.patchDoctorServiceMapping(clinicId, existing.id, {
        ...(input.consultation_fee_amount !== undefined
          ? { consultationFeeAmount: String(input.consultation_fee_amount) }
          : {}),
        ...(input.followup_fee_amount !== undefined
          ? { followupFeeAmount: String(input.followup_fee_amount) }
          : {}),
        ...(input.followup_valid_days !== undefined
          ? { followupValidDays: input.followup_valid_days }
          : {}),
        active: input.active ?? true,
      });

      if (!updated) {
        throw new AppError('INTERNAL_ERROR', 'Failed to update doctor-service mapping.');
      }

      if (updated.active) {
        await this.ensureBookingRuleForDoctorService(
          clinicId,
          updated.doctorId,
          updated.clinicServiceId,
        );
        await this.regenerateSlotsForDoctorService(
          clinicId,
          updated.doctorId,
          updated.clinicServiceId,
        );
      }

      return {
        id: updated.id,
        clinic_id: updated.clinicId,
        doctor_id: updated.doctorId,
        clinic_service_id: updated.clinicServiceId,
        consultation_fee_amount: updated.consultationFeeAmount,
        followup_fee_amount: updated.followupFeeAmount,
        followup_valid_days: updated.followupValidDays,
        active: updated.active,
        created_at: updated.createdAt.toISOString(),
        updated_at: updated.updatedAt.toISOString(),
      };
    }

    const [row] = await this.repos.clinicalSetup.createDoctorServiceMapping({
      clinicId,
      doctorId: input.doctor_id,
      clinicServiceId: input.clinic_service_id,
      consultationFeeAmount:
        input.consultation_fee_amount !== undefined
          ? String(input.consultation_fee_amount)
          : undefined,
      followupFeeAmount:
        input.followup_fee_amount !== undefined ? String(input.followup_fee_amount) : undefined,
      followupValidDays: input.followup_valid_days,
      active: input.active ?? true,
    });

    if (!row) {
      throw new AppError('INTERNAL_ERROR', 'Failed to create doctor-service mapping.');
    }

    if (row.active) {
      await this.ensureBookingRuleForDoctorService(clinicId, row.doctorId, row.clinicServiceId);
      await this.regenerateSlotsForDoctorService(clinicId, row.doctorId, row.clinicServiceId);
    }

    return {
      id: row.id,
      clinic_id: row.clinicId,
      doctor_id: row.doctorId,
      clinic_service_id: row.clinicServiceId,
      consultation_fee_amount: row.consultationFeeAmount,
      followup_fee_amount: row.followupFeeAmount,
      followup_valid_days: row.followupValidDays,
      active: row.active,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  private async ensureBookingRulesForActiveMappings(clinicId: string) {
    const mappings = await this.repos.clinicalSetup.listDoctorServiceMappings(clinicId);
    const activeMappings = mappings.filter((mapping) => mapping.active);

    await Promise.all(
      activeMappings.map((mapping) =>
        this.ensureBookingRuleForDoctorService(clinicId, mapping.doctorId, mapping.clinicServiceId),
      ),
    );
  }

  private async ensureBookingRuleForDoctorService(
    clinicId: string,
    doctorId: string,
    clinicServiceId: string,
  ) {
    const existingRules = await this.repos.clinicalSetup.listBookingRulesForDoctorService(
      clinicId,
      doctorId,
      clinicServiceId,
    );

    if (existingRules.some((rule) => rule.active)) {
      return;
    }

    const [timezoneRow] = await this.repos.slots.findClinicTimezone(clinicId);
    const timezone = timezoneRow?.timezone ?? 'Asia/Kolkata';
    const today = formatDateInTimezone(new Date(), timezone);

    const latestRule = existingRules[0];
    const nextVersion = (latestRule?.version ?? 0) + 1;

    await this.repos.clinicalSetup.createBookingRule({
      clinicId,
      doctorId,
      clinicServiceId,
      slotDurationMinutes: latestRule?.slotDurationMinutes ?? 15,
      capacityPerSlot: latestRule?.capacityPerSlot ?? 3,
      bookingHorizonDays: latestRule?.bookingHorizonDays ?? 45,
      minBookingNoticeMinutes: latestRule?.minBookingNoticeMinutes ?? 0,
      maxAdvanceBookingDays: latestRule?.maxAdvanceBookingDays ?? null,
      manualEditCutoffBeforeStartMinutes: latestRule?.manualEditCutoffBeforeStartMinutes ?? 60,
      manualEditMaxShiftMinutes: latestRule?.manualEditMaxShiftMinutes ?? 60,
      effectiveFrom: today,
      effectiveTo: null,
      active: true,
      version: nextVersion,
    });
  }

  private async regenerateSlotsForDoctorService(
    clinicId: string,
    doctorId: string,
    clinicServiceId?: string,
  ) {
    try {
      const input: { clinicId: string; doctorId: string; clinicServiceId?: string } = {
        clinicId,
        doctorId,
      };
      if (clinicServiceId) {
        input.clinicServiceId = clinicServiceId;
      }
      await this.slotGeneration.generateSlots(input);
    } catch {
      // Best-effort: slot generation must not break the main setup flow.
      // The daily cron will retry generation on the next run.
    }
  }

  async patchDoctorServiceMapping(
    clinicId: string,
    mappingId: string,
    input: UpdateDoctorServiceMappingInput,
  ) {
    const [row] = await this.repos.clinicalSetup.patchDoctorServiceMapping(clinicId, mappingId, {
      ...(input.consultation_fee_amount !== undefined
        ? { consultationFeeAmount: String(input.consultation_fee_amount) }
        : {}),
      ...(input.followup_fee_amount !== undefined
        ? { followupFeeAmount: String(input.followup_fee_amount) }
        : {}),
      ...(input.followup_valid_days !== undefined
        ? { followupValidDays: input.followup_valid_days }
        : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    });
    if (!row) {
      throw new AppError('NOT_FOUND', 'Doctor-service mapping not found.');
    }

    if (row.active) {
      await this.ensureBookingRuleForDoctorService(clinicId, row.doctorId, row.clinicServiceId);
      await this.regenerateSlotsForDoctorService(clinicId, row.doctorId, row.clinicServiceId);
    }

    return {
      id: row.id,
      clinic_id: row.clinicId,
      doctor_id: row.doctorId,
      clinic_service_id: row.clinicServiceId,
      consultation_fee_amount: row.consultationFeeAmount,
      followup_fee_amount: row.followupFeeAmount,
      followup_valid_days: row.followupValidDays,
      active: row.active,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  async patchClinicService(
    clinicId: string,
    serviceId: string,
    input: { service_name?: string; active?: boolean },
  ) {
    const [row] = await this.repos.clinicalSetup.patchClinicService(clinicId, serviceId, {
      ...(input.service_name !== undefined ? { serviceName: input.service_name } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    });
    if (!row) {
      throw new AppError('NOT_FOUND', 'Clinic service not found.');
    }
    return {
      id: row.id,
      clinic_id: row.clinicId,
      service_key: row.serviceKey,
      service_name: row.serviceName,
      active: row.active,
    };
  }

  async deleteDoctor(clinicId: string, doctorId: string) {
    // Cascade: delete booking rules, then mappings, then schedules, then the doctor
    await this.repos.clinicalSetup.deleteBookingRulesForDoctor(clinicId, doctorId);
    await this.repos.clinicalSetup.deleteDoctorServiceMappingsForDoctor(clinicId, doctorId);
    await this.repos.clinicalSetup.deleteDoctorSchedulesForDoctor(clinicId, doctorId);
    const [deleted] = await this.repos.clinicalSetup.deleteDoctor(clinicId, doctorId);
    if (!deleted) {
      throw new AppError('NOT_FOUND', 'Doctor not found.');
    }
    return { deleted: true };
  }

  async deleteClinicService(clinicId: string, serviceId: string) {
    // Cascade: delete booking rules, then mappings, then the service
    await this.repos.clinicalSetup.deleteBookingRulesForService(clinicId, serviceId);
    await this.repos.clinicalSetup.deleteDoctorServiceMappingsForService(clinicId, serviceId);
    const [deleted] = await this.repos.clinicalSetup.deleteClinicService(clinicId, serviceId);
    if (!deleted) {
      throw new AppError('NOT_FOUND', 'Service not found.');
    }
    return { deleted: true };
  }

  async deleteDoctorServiceMapping(clinicId: string, mappingId: string) {
    // Cascade: delete booking rules for this mapping first
    const [mapping] = await this.repos.clinicalSetup.findDoctorServiceMapping(clinicId, mappingId);
    if (mapping) {
      await this.repos.clinicalSetup.deleteBookingRulesForDoctorService(
        clinicId,
        mapping.doctorId,
        mapping.clinicServiceId,
      );
    }
    const [deleted] = await this.repos.clinicalSetup.deleteDoctorServiceMapping(clinicId, mappingId);
    if (!deleted) {
      throw new AppError('NOT_FOUND', 'Doctor-service mapping not found.');
    }
    return { deleted: true };
  }

  async listBookingRules(clinicId: string) {
    await this.ensureBookingRulesForActiveMappings(clinicId);

    const [rows, mappings] = await Promise.all([
      this.repos.clinicalSetup.listBookingRules(clinicId),
      this.repos.clinicalSetup.listDoctorServiceMappings(clinicId),
    ]);

    const activeMappingKeys = new Set(
      mappings
        .filter((mapping) => mapping.active)
        .map((mapping) => `${mapping.doctorId}:${mapping.clinicServiceId}`),
    );

    return rows
      .filter((row) => activeMappingKeys.has(`${row.doctorId}:${row.clinicServiceId}`))
      .map((row) => ({
      id: row.id,
      clinic_id: row.clinicId,
      doctor_id: row.doctorId,
      clinic_service_id: row.clinicServiceId,
      slot_duration_minutes: row.slotDurationMinutes,
      capacity_per_slot: row.capacityPerSlot,
      booking_horizon_days: row.bookingHorizonDays,
      min_booking_notice_minutes: row.minBookingNoticeMinutes,
      max_advance_booking_days: row.maxAdvanceBookingDays,
      manual_edit_cutoff_before_start_minutes: row.manualEditCutoffBeforeStartMinutes,
      manual_edit_max_shift_minutes: row.manualEditMaxShiftMinutes,
      effective_from: row.effectiveFrom,
      effective_to: row.effectiveTo,
      active: row.active,
      version: row.version,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      }));
  }

  previewBookingRuleChange(
    clinicId: string,
    ruleId: string,
    input: { capacity_per_slot?: number; slot_duration_minutes?: number },
  ) {
    return this.scheduleChangeImpact.previewBookingRuleChange(clinicId, ruleId, input);
  }

  previewClinicHoursReplace(clinicId: string, input: ReplaceClinicHoursInput) {
    return this.scheduleChangeImpact.previewClinicHoursReplace(clinicId, input);
  }

  async previewHolidayDate(clinicId: string, holidayDate: string, doctorIds?: string[]) {
    const normalizedDoctorIds = normalizeDoctorIds(doctorIds);
    await this.assertHolidayDoctorsBelongToClinic(clinicId, normalizedDoctorIds);
    return this.scheduleChangeImpact.previewHolidayDate(clinicId, holidayDate, normalizedDoctorIds);
  }

  private async assertHolidayDoctorsBelongToClinic(clinicId: string, doctorIds: string[]) {
    if (doctorIds.length === 0) {
      return;
    }

    const doctors = await this.repos.clinicalSetup.listDoctors(clinicId);
    const doctorIdSet = new Set(doctors.map((doctor) => doctor.id));
    const invalidDoctorIds = doctorIds.filter((doctorId) => !doctorIdSet.has(doctorId));

    if (invalidDoctorIds.length > 0) {
      throw new AppError('VALIDATION_ERROR', 'Some selected doctors do not belong to this clinic.');
    }
  }

  async patchBookingRule(clinicId: string, ruleId: string, input: UpdateBookingRuleInput) {
    const bookingRuleInput = input as UpdateBookingRuleInput & {
      implement_from?: string;
    };

    const hasCapacityOrDurationChange =
      bookingRuleInput.capacity_per_slot !== undefined ||
      bookingRuleInput.slot_duration_minutes !== undefined;

    if (hasCapacityOrDurationChange) {
      const preview = await this.scheduleChangeImpact.previewBookingRuleChange(clinicId, ruleId, {
        ...(bookingRuleInput.capacity_per_slot !== undefined
          ? { capacity_per_slot: bookingRuleInput.capacity_per_slot }
          : {}),
        ...(bookingRuleInput.slot_duration_minutes !== undefined
          ? { slot_duration_minutes: bookingRuleInput.slot_duration_minutes }
          : {}),
      });

      if (preview.blocked && !bookingRuleInput.implement_from) {
        throw new AppError('CONFLICTING_APPOINTMENTS', 'Booking rule change conflicts with active appointments.', {
          conflicts: preview.conflicts,
          next_safe_implement_from: preview.next_safe_implement_from,
        });
      }

      if (bookingRuleInput.capacity_per_slot !== undefined) {
        await this.scheduleChangeImpact.applyBookingRuleChange(clinicId, ruleId, {
          capacity_per_slot: bookingRuleInput.capacity_per_slot,
          ...(bookingRuleInput.implement_from !== undefined
            ? { implement_from: bookingRuleInput.implement_from }
            : {}),
        });
      }

      if (bookingRuleInput.slot_duration_minutes !== undefined) {
        await this.scheduleChangeImpact.applyBookingRuleChange(clinicId, ruleId, {
          slot_duration_minutes: bookingRuleInput.slot_duration_minutes,
          ...(bookingRuleInput.implement_from !== undefined
            ? { implement_from: bookingRuleInput.implement_from }
            : {}),
        });
      }
    }

    const [row] = await this.repos.clinicalSetup.patchBookingRule(clinicId, ruleId, {
      ...(bookingRuleInput.slot_duration_minutes !== undefined
        ? { slotDurationMinutes: bookingRuleInput.slot_duration_minutes }
        : {}),
      ...(bookingRuleInput.capacity_per_slot !== undefined
        ? { capacityPerSlot: bookingRuleInput.capacity_per_slot }
        : {}),
      ...(bookingRuleInput.booking_horizon_days !== undefined
        ? { bookingHorizonDays: bookingRuleInput.booking_horizon_days }
        : {}),
      ...(bookingRuleInput.min_booking_notice_minutes !== undefined
        ? { minBookingNoticeMinutes: bookingRuleInput.min_booking_notice_minutes }
        : {}),
      ...(bookingRuleInput.max_advance_booking_days !== undefined
        ? { maxAdvanceBookingDays: bookingRuleInput.max_advance_booking_days }
        : {}),
      ...(bookingRuleInput.manual_edit_cutoff_before_start_minutes !== undefined
        ? {
            manualEditCutoffBeforeStartMinutes:
              bookingRuleInput.manual_edit_cutoff_before_start_minutes,
          }
        : {}),
      ...(bookingRuleInput.manual_edit_max_shift_minutes !== undefined
        ? { manualEditMaxShiftMinutes: bookingRuleInput.manual_edit_max_shift_minutes }
        : {}),
      ...(bookingRuleInput.effective_from !== undefined
        ? { effectiveFrom: bookingRuleInput.effective_from }
        : {}),
      ...(bookingRuleInput.effective_to !== undefined
        ? { effectiveTo: bookingRuleInput.effective_to }
        : {}),
      ...(bookingRuleInput.active !== undefined ? { active: bookingRuleInput.active } : {}),
    });
    if (!row) {
      throw new AppError('NOT_FOUND', 'Booking rule not found.');
    }
    return {
      id: row.id,
      clinic_id: row.clinicId,
      doctor_id: row.doctorId,
      clinic_service_id: row.clinicServiceId,
      slot_duration_minutes: row.slotDurationMinutes,
      capacity_per_slot: row.capacityPerSlot,
      booking_horizon_days: row.bookingHorizonDays,
      manual_edit_cutoff_before_start_minutes: row.manualEditCutoffBeforeStartMinutes,
      manual_edit_max_shift_minutes: row.manualEditMaxShiftMinutes,
      active: row.active,
      version: row.version,
    };
  }

  async listClinicHours(clinicId: string) {
    const rows = await this.repos.clinicalSetup.listClinicHours(clinicId);
    return rows.map(mapClinicHoursRow);
  }

  async replaceClinicHours(clinicId: string, input: ReplaceClinicHoursInput) {
    const preview = await this.scheduleChangeImpact.previewClinicHoursReplace(clinicId, input);
    if (preview.blocked) {
      throw new AppError('CONFLICTING_APPOINTMENTS', 'Clinic hours change conflicts with active appointments.', {
        conflicts: preview.conflicts,
      });
    }

    const rows = await this.repos.clinicalSetup.replaceClinicHours(
      clinicId,
      input.windows.map((window) => ({
        dayOfWeek: window.day_of_week,
        startTime: window.start_time,
        endTime: window.end_time,
        active: window.active ?? true,
      })),
    );
    return rows.map(mapClinicHoursRow);
  }

  async listHolidays(clinicId: string) {
    const [rows, mappings] = await Promise.all([
      this.repos.clinicalSetup.listHolidays(clinicId),
      this.repos.clinicalSetup.listHolidayDoctorMappings(clinicId),
    ]);

    const doctorIdsByHoliday = new Map<string, string[]>();
    for (const mapping of mappings) {
      const current = doctorIdsByHoliday.get(mapping.holidayId) ?? [];
      current.push(mapping.doctorId);
      doctorIdsByHoliday.set(mapping.holidayId, current);
    }

    return rows.map((row) => mapHolidayRow(row, doctorIdsByHoliday.get(row.id) ?? []));
  }

  async createHoliday(clinicId: string, input: CreateClinicHolidayInput, actorUserId: string) {
    const doctorIds = normalizeDoctorIds(input.doctor_ids);
    await this.assertHolidayDoctorsBelongToClinic(clinicId, doctorIds);

    if (input.active ?? true) {
      const preview = await this.scheduleChangeImpact.previewHolidayDate(
        clinicId,
        input.holiday_date,
        doctorIds,
      );
      if (preview.blocked) {
        throw new AppError('CONFLICTING_APPOINTMENTS', 'Holiday conflicts with active appointments.', {
          conflicts: preview.conflicts,
        });
      }
    }

    const [row] = await this.repos.clinicalSetup.insertHoliday({
      clinicId,
      holidayDate: input.holiday_date,
      isFullDay: input.is_full_day ?? true,
      startTime: input.start_time ?? null,
      endTime: input.end_time ?? null,
      reason: input.reason ?? null,
      active: input.active ?? true,
      createdByUserId: actorUserId,
    });
    if (!row) {
      throw new AppError('INTERNAL_ERROR', 'Failed to create holiday.');
    }

    await this.repos.clinicalSetup.replaceHolidayDoctors(clinicId, row.id, doctorIds);
    return mapHolidayRow(row, doctorIds);
  }

  async patchHoliday(clinicId: string, holidayId: string, input: PatchClinicHolidayInput) {
    const [existing] = await this.repos.clinicalSetup.findHoliday(clinicId, holidayId);
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Holiday not found.');
    }

    const existingDoctorRows = await this.repos.clinicalSetup.listHolidayDoctors(clinicId, holidayId);
    const existingDoctorIds = existingDoctorRows.map((row) => row.doctorId);

    const nextDoctorIds =
      input.doctor_ids !== undefined ? normalizeDoctorIds(input.doctor_ids) : existingDoctorIds;

    await this.assertHolidayDoctorsBelongToClinic(clinicId, nextDoctorIds);

    const nextHolidayDate = input.holiday_date ?? existing.holidayDate;
    const nextActive = input.active ?? existing.active;
    const shouldPreview =
      nextActive &&
      (input.holiday_date !== undefined ||
        input.doctor_ids !== undefined ||
        (existing.active === false && input.active === true));

    if (shouldPreview) {
      const preview = await this.scheduleChangeImpact.previewHolidayDate(
        clinicId,
        nextHolidayDate,
        nextDoctorIds,
      );
      if (preview.blocked) {
        throw new AppError('CONFLICTING_APPOINTMENTS', 'Holiday conflicts with active appointments.', {
          conflicts: preview.conflicts,
        });
      }
    }

    const [row] = await this.repos.clinicalSetup.patchHoliday(clinicId, holidayId, {
      ...(input.holiday_date !== undefined ? { holidayDate: input.holiday_date } : {}),
      ...(input.is_full_day !== undefined ? { isFullDay: input.is_full_day } : {}),
      ...(input.start_time !== undefined ? { startTime: input.start_time } : {}),
      ...(input.end_time !== undefined ? { endTime: input.end_time } : {}),
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    });
    if (!row) {
      throw new AppError('NOT_FOUND', 'Holiday not found.');
    }

    if (input.doctor_ids !== undefined) {
      await this.repos.clinicalSetup.replaceHolidayDoctors(clinicId, holidayId, nextDoctorIds);
    }

    return mapHolidayRow(row, nextDoctorIds);
  }

  async listDoctorSchedules(clinicId: string, doctorId?: string) {
    const rows = await this.repos.clinicalSetup.listDoctorSchedules(clinicId, doctorId);
    return rows.map(mapScheduleRow);
  }

  async replaceDoctorSchedules(
    clinicId: string,
    doctorId: string,
    input: ReplaceDoctorSchedulesInput,
  ) {
    const rows = await this.repos.clinicalSetup.replaceDoctorSchedules(
      clinicId,
      doctorId,
      input.windows.map((window) => ({
        doctorServiceId: window.doctor_service_id ?? null,
        dayOfWeek: window.day_of_week,
        startTime: window.start_time,
        endTime: window.end_time,
        effectiveFrom: window.effective_from ?? null,
        effectiveTo: window.effective_to ?? null,
        active: window.active ?? true,
      })),
    );
    await this.regenerateSlotsForDoctorService(clinicId, doctorId, undefined);
    return rows.map(mapScheduleRow);
  }

  async listCalls(clinicId: string, from?: string, to?: string) {
    const rows = await this.repos.clinicalSetup.listCalls(clinicId, from, to);
    return rows.map((row) => ({
      id: row.id,
      clinic_id: row.clinicId,
      session_id: row.sessionId,
      patient_phone: row.patientPhone,
      patient_id: row.patientId,
      provider: row.provider,
      started_at: row.startedAt?.toISOString() ?? null,
      ended_at: row.endedAt?.toISOString() ?? null,
      duration_seconds: row.durationSeconds,
      outcome: row.outcome,
      summary: row.summary,
      recording_url: row.recordingUrl,
      recording_expires_at: row.recordingExpiresAt?.toISOString() ?? null,
      transcript_expires_at: row.transcriptExpiresAt?.toISOString() ?? null,
      created_appointment_request_id: row.createdAppointmentRequestId,
      created_callback_request_id: row.createdCallbackRequestId,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    }));
  }

  async listCallbackRequests(clinicId: string, status?: string) {
    const rows = await this.repos.clinicalSetup.listCallbackRequests(clinicId, status);
    return rows.map((row) => ({
      id: row.id,
      clinic_id: row.clinicId,
      patient_name: row.patientName,
      patient_phone: row.patientPhone,
      reason: row.reason,
      status: row.status,
      source_session_id: row.sourceSessionId,
      source_call_id: row.sourceCallId,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    }));
  }

  async getCall(clinicId: string, callId: string) {
    const [row] = await this.repos.clinicalSetup.findCall(clinicId, callId);
    if (!row) {
      throw new AppError('NOT_FOUND', 'Call not found.');
    }
    return {
      id: row.id,
      clinic_id: row.clinicId,
      session_id: row.sessionId,
      patient_phone: row.patientPhone,
      started_at: row.startedAt?.toISOString() ?? null,
      ended_at: row.endedAt?.toISOString() ?? null,
      duration_seconds: row.durationSeconds,
      outcome: row.outcome,
      summary: row.summary,
      recording_url: row.recordingUrl,
      recording_expires_at: row.recordingExpiresAt?.toISOString() ?? null,
      transcript_expires_at: row.transcriptExpiresAt?.toISOString() ?? null,
    };
  }

  async listClinicNotifications(clinicId: string) {
    const rows = await this.repos.clinicalSetup.listNotificationEvents(clinicId);
    return rows.map((row) => ({
      id: row.id,
      clinic_id: row.clinicId,
      event_type: row.eventType,
      channel: row.channel,
      status: row.status,
      recipient_phone: row.recipientPhone,
      recipient_email: row.recipientEmail,
      scheduled_at: row.scheduledAt?.toISOString() ?? row.createdAt.toISOString(),
      sent_at: row.sentAt?.toISOString() ?? null,
      attempt_count: row.attemptCount,
      max_attempts: row.maxAttempts,
      last_error: row.lastError,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    }));
  }

  async listPlatformNotifications() {
    const rows = await this.repos.clinicalSetup.listNotificationEvents();
    return rows.map((row) => ({
      id: row.id,
      clinic_id: row.clinicId,
      event_type: row.eventType,
      channel: row.channel,
      status: row.status,
      recipient_phone: row.recipientPhone,
      recipient_email: row.recipientEmail,
      scheduled_at: row.scheduledAt?.toISOString() ?? row.createdAt.toISOString(),
      sent_at: row.sentAt?.toISOString() ?? null,
      attempt_count: row.attemptCount,
      last_error: row.lastError,
      created_at: row.createdAt.toISOString(),
    }));
  }

  async listJobHealth() {
    const rows = await this.repos.clinicalSetup.listBackgroundJobHealth();
    const runs = await this.repos.clinicalSetup.listRecentBackgroundJobs(25);
    return {
      health: rows.map((row) => ({ status: row.status, count: row.count })),
      recent_runs: runs.map((row) => ({
        id: row.id,
        clinic_id: row.clinicId,
        job_type: row.jobType,
        status: row.status,
        attempt_count: row.attemptCount,
        last_error: row.lastError,
        scheduled_at: row.scheduledAt.toISOString(),
        completed_at: row.completedAt?.toISOString() ?? null,
        created_at: row.createdAt.toISOString(),
      })),
    };
  }
}
