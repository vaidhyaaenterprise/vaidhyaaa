import { describe, expect, it } from 'vitest';

import {
  APPOINTMENT_STATUSES,
  clinicRoleSchema,
  platformRoleSchema,
} from './enums/index';
import {
  clinicSettingsPatchSchema,
  clinicSettingsPutSchema,
  createAppointmentRequestSchema,
  createBookingRuleSchema,
  createDoctorSchema,
} from './dto/index';
import { apiErrorBodySchema, toApiErrorBody } from './errors/index';

describe('C03 shared DTO contracts', () => {
  it('1. DTO schemas reject missing required fields', () => {
    const doctorResult = createDoctorSchema.safeParse({});
    expect(doctorResult.success).toBe(false);

    const bookingRuleResult = createBookingRuleSchema.safeParse({
      doctor_id: '00000000-0000-0000-0000-000000000001',
      clinic_service_id: '00000000-0000-0000-0000-000000000002',
    });
    expect(bookingRuleResult.success).toBe(false);
  });

  it('2. appointment creation DTO requires reason_for_visit', () => {
    const missingReason = createAppointmentRequestSchema.safeParse({
      patient_name: 'Patient',
      doctor_id: '00000000-0000-0000-0000-000000000001',
      clinic_service_id: '00000000-0000-0000-0000-000000000002',
      appointment_start: '2026-06-12T10:00:00+05:30',
      appointment_end: '2026-06-12T10:30:00+05:30',
    });
    expect(missingReason.success).toBe(false);

    const withReason = createAppointmentRequestSchema.safeParse({
      patient_name: 'Patient',
      doctor_id: '00000000-0000-0000-0000-000000000001',
      clinic_service_id: '00000000-0000-0000-0000-000000000002',
      reason_for_visit: 'Fever',
      appointment_start: '2026-06-12T10:00:00+05:30',
      appointment_end: '2026-06-12T10:30:00+05:30',
    });
    expect(withReason.success).toBe(true);
  });

  it('3. booking rule DTO requires slot_duration_minutes and capacity_per_slot', () => {
    const missingFields = createBookingRuleSchema.safeParse({
      doctor_id: '00000000-0000-0000-0000-000000000001',
      clinic_service_id: '00000000-0000-0000-0000-000000000002',
    });
    expect(missingFields.success).toBe(false);

    const withFields = createBookingRuleSchema.safeParse({
      doctor_id: '00000000-0000-0000-0000-000000000001',
      clinic_service_id: '00000000-0000-0000-0000-000000000002',
      slot_duration_minutes: 15,
      capacity_per_slot: 2,
    });
    expect(withFields.success).toBe(true);
  });

  it('4. clinic setting patch accepts partial update', () => {
    const partial = clinicSettingsPatchSchema.safeParse({
      agent_enabled: true,
    });
    expect(partial.success).toBe(true);

    const empty = clinicSettingsPatchSchema.safeParse({});
    expect(empty.success).toBe(true);
  });

  it('5. clinic setting put requires full object', () => {
    const partial = clinicSettingsPutSchema.safeParse({
      agent_enabled: true,
    });
    expect(partial.success).toBe(false);

    const full = clinicSettingsPutSchema.safeParse({
      agent_enabled: false,
      answering_mode: 'off',
      fallback_phone: null,
      overflow_after_rings: null,
      booking_mode: 'pending_confirmation',
      max_concurrent_calls: 1,
      recording_retention_days: 10,
      transcript_retention_days: 30,
      notify_staff_on_pending_appointment: true,
      pending_appointment_notification_channel: 'whatsapp',
      allow_doctor_service_edit: false,
      allow_patient_auto_cancel: false,
    });
    expect(full.success).toBe(true);
  });

  it('6. error DTO matches standard error shape', () => {
    const body = toApiErrorBody('VALIDATION_ERROR', 'Invalid payload.', 'req_c03test', {
      field: 'reason_for_visit',
    });
    const parsed = apiErrorBodySchema.parse(body);
    expect(parsed.error.code).toBe('VALIDATION_ERROR');
    expect(parsed.error.request_id).toBe('req_c03test');
    expect(parsed.error.details).toEqual({ field: 'reason_for_visit' });
  });

  it('7. shared enums import without circular dependency with dto', async () => {
    expect(APPOINTMENT_STATUSES).toContain('pending_confirmation');
    expect(platformRoleSchema.parse('platform_admin')).toBe('platform_admin');
    expect(clinicRoleSchema.parse('doctor')).toBe('doctor');

    const enumsModule = await import('./enums/index');
    const dtoModule = await import('./dto/index');
    expect(enumsModule.APPOINTMENT_STATUSES.length).toBeGreaterThan(0);
    expect(dtoModule.createAppointmentRequestSchema).toBeDefined();
    expect(enumsModule).not.toHaveProperty('createAppointmentRequestSchema');
  });
});

describe('API method policy', () => {
  it('clinic_settings disallows POST and allows PATCH', async () => {
    const { API_RESOURCE_POLICIES, isMethodAllowed } = await import('./api-client/index');
    expect(API_RESOURCE_POLICIES.clinic_settings.post).toBe(false);
    expect(isMethodAllowed('clinic_settings', 'PATCH')).toBe(true);
    expect(isMethodAllowed('clinic_settings', 'POST')).toBe(false);
  });

  it('doctor schedules and clinic hours support window operations', async () => {
    const { isMethodAllowed, supportsDisableAction } = await import('./api-client/index');
    expect(isMethodAllowed('doctor_schedules', 'PUT')).toBe(true);
    expect(isMethodAllowed('doctor_schedules', 'POST')).toBe(true);
    expect(isMethodAllowed('doctor_schedules', 'PATCH')).toBe(true);
    expect(supportsDisableAction('doctor_schedules')).toBe(true);
    expect(isMethodAllowed('clinic_hours', 'PUT')).toBe(true);
    expect(supportsDisableAction('clinic_hours')).toBe(true);
  });
});
