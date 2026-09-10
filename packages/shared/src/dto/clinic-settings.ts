import { z } from 'zod';

import { auditTimestampsSchema, uuidSchema } from './common';

export const ANSWERING_MODES = [
  'always_on',
  'after_hours_only',
  'overflow_after_n_rings',
  'holiday_only',
  'off',
] as const;

export const BOOKING_MODES = ['pending_confirmation', 'auto_confirm'] as const;

export const PENDING_APPOINTMENT_NOTIFICATION_CHANNELS = [
  'dashboard',
  'whatsapp',
  'sms',
  'email',
] as const;

export const answeringModeSchema = z.enum(ANSWERING_MODES);
export const bookingModeSchema = z.enum(BOOKING_MODES);
export const pendingAppointmentNotificationChannelSchema = z.enum(
  PENDING_APPOINTMENT_NOTIFICATION_CHANNELS,
);

const clinicSettingsFieldsSchema = z.object({
  clinic_id: uuidSchema,
  agent_enabled: z.boolean(),
  answering_mode: answeringModeSchema,
  fallback_phone: z.string().nullable(),
  overflow_after_rings: z.number().int().positive().nullable(),
  booking_mode: bookingModeSchema,
  max_concurrent_calls: z.number().int().positive(),
  recording_retention_days: z.number().int().min(1).max(30),
  transcript_retention_days: z.number().int().min(1).max(180),
  notify_staff_on_pending_appointment: z.boolean(),
  pending_appointment_notification_channel:
    pendingAppointmentNotificationChannelSchema.nullable(),
  allow_doctor_service_edit: z.boolean(),
  allow_patient_auto_cancel: z.boolean(),
  updated_by_user_id: uuidSchema.nullable(),
});

export const clinicSettingsResponseSchema = clinicSettingsFieldsSchema.merge(auditTimestampsSchema);

export const clinicSettingsPatchSchema = clinicSettingsFieldsSchema
  .omit({ clinic_id: true, updated_by_user_id: true })
  .partial()
  .strict();

export const clinicSettingsPutSchema = clinicSettingsFieldsSchema.omit({
  clinic_id: true,
  updated_by_user_id: true,
});

export type ClinicSettingsResponse = z.infer<typeof clinicSettingsResponseSchema>;
export type ClinicSettingsPatchInput = z.infer<typeof clinicSettingsPatchSchema>;
export type ClinicSettingsPutInput = z.infer<typeof clinicSettingsPutSchema>;

/** Convenience alias for API responses that omit audit timestamps. */
export const clinicSettingsSummarySchema = clinicSettingsFieldsSchema.omit({
  updated_by_user_id: true,
});

export type ClinicSettingsSummary = z.infer<typeof clinicSettingsSummarySchema>;
