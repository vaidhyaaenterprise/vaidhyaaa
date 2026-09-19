import { z } from 'zod';

import { appointmentStatusSchema } from '../enums/appointment-statuses';
import { uuidSchema } from './common';

const clinicLocalTimestampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/);

export const scheduleConflictAppointmentSchema = z.object({
  patient_name: z.string().min(1),
  appointment_start: clinicLocalTimestampSchema,
  appointment_end: clinicLocalTimestampSchema,
  doctor_name: z.string().nullable(),
  service_name: z.string().nullable(),
  status: appointmentStatusSchema,
});

export const scheduleConflictItemSchema = z.object({
  appointment_id: uuidSchema.optional(),
  appointment: scheduleConflictAppointmentSchema.optional(),
  slot_id: uuidSchema.optional(),
  slot_start: clinicLocalTimestampSchema.optional(),
  slot_end: clinicLocalTimestampSchema.optional(),
  hold_id: uuidSchema.optional(),
  holiday_date: z.string().optional(),
  reason: z.string(),
});

export const conflictPreviewResponseSchema = z.object({
  blocked: z.boolean(),
  conflicts: z.array(scheduleConflictItemSchema),
  next_safe_implement_from: clinicLocalTimestampSchema.optional(),
});

export type ScheduleConflictItem = z.infer<typeof scheduleConflictItemSchema>;
export type ScheduleConflictAppointment = z.infer<typeof scheduleConflictAppointmentSchema>;
export type ConflictPreviewResponse = z.infer<typeof conflictPreviewResponseSchema>;
