import { z } from 'zod';

import { appointmentStatusSchema } from '../enums/appointment-statuses';

import { auditTimestampsSchema, dateSchema, timestamptzSchema, uuidSchema } from './common';

export const appointmentResponseSchema = z
  .object({
    id: uuidSchema,
    clinic_id: uuidSchema,
    slot_id: uuidSchema.nullable(),
    slot_hold_id: uuidSchema.nullable(),
    patient_id: uuidSchema.nullable(),
    patient_name: z.string().min(1),
    patient_phone: z.string().nullable(),
    doctor_id: uuidSchema,
    clinic_service_id: uuidSchema,
    reason_for_visit: z.string().min(1),
    normalized_reason: z.string().nullable(),
    appointment_start: timestamptzSchema,
    appointment_end: timestamptzSchema,
    status: appointmentStatusSchema,
    is_followup: z.boolean(),
    followup_of_visit_id: uuidSchema.nullable(),
    routing_source: z
      .enum([
        'service_router',
        'returning_patient_followup',
        'doctor_name',
        'manual',
        'admin_action',
      ])
      .nullable(),
    source_session_id: uuidSchema.nullable(),
    replaces_appointment_id: uuidSchema.nullable(),
    replaced_by_appointment_id: uuidSchema.nullable(),
    created_by_user_id: uuidSchema.nullable(),
  })
  .merge(auditTimestampsSchema);

export const createAppointmentRequestSchema = z.object({
  slot_id: uuidSchema.optional(),
  slot_hold_id: uuidSchema.optional(),
  patient_name: z.string().min(1),
  patient_phone: z.string().optional(),
  doctor_id: uuidSchema,
  clinic_service_id: uuidSchema,
  reason_for_visit: z.string().min(1),
  appointment_start: timestamptzSchema,
  appointment_end: timestamptzSchema,
  is_followup: z.boolean().default(false),
  followup_of_visit_id: uuidSchema.optional(),
  source_session_id: uuidSchema.optional(),
});

export const manualAppointmentCreateSchema = createAppointmentRequestSchema.extend({
  patient_phone: z.string().min(8),
  patient_age: z.number().int().min(0).max(130),
  patient_date_of_birth: dateSchema.optional(),
  override_reason: z.string().min(1).optional(),
  status: z.enum(['pending_confirmation', 'confirmed']).default('confirmed'),
});

export const markAppointmentVisitedSchema = z.object({
  visit_reason: z.string().min(1),
  examination_notes: z.string().min(1).optional(),
  diagnosis: z.string().min(1).optional(),
  advice: z.string().min(1).optional(),
});

export const patchAppointmentRequestSchema = z.object({
  status: appointmentStatusSchema.optional(),
  reason_for_visit: z.string().min(1).optional(),
  appointment_start: timestamptzSchema.optional(),
  appointment_end: timestamptzSchema.optional(),
});

export type AppointmentResponse = z.infer<typeof appointmentResponseSchema>;
export type CreateAppointmentRequestInput = z.infer<typeof createAppointmentRequestSchema>;
export type ManualAppointmentCreateInput = z.infer<typeof manualAppointmentCreateSchema>;
export type MarkAppointmentVisitedInput = z.infer<typeof markAppointmentVisitedSchema>;
export type PatchAppointmentRequestInput = z.infer<typeof patchAppointmentRequestSchema>;
