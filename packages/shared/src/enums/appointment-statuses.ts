import { z } from 'zod';

export const APPOINTMENT_STATUSES = [
  'pending_confirmation',
  'confirmed',
  'visited',
  'cancelled',
  'rescheduled',
  'no_show',
  'conflict_required',
] as const;

export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;
