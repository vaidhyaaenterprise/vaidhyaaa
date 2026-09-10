import { z } from 'zod';

export const APPOINTMENT_ACTION_REQUEST_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'completed',
] as const;

export const APPOINTMENT_ACTION_REQUEST_TYPES = ['cancel', 'reschedule'] as const;

export const APPOINTMENT_ACTION_REQUESTED_BY = [
  'patient_call',
  'admin',
  'doctor',
] as const;

export const appointmentActionRequestStatusSchema = z.enum(APPOINTMENT_ACTION_REQUEST_STATUSES);
export const appointmentActionRequestTypeSchema = z.enum(APPOINTMENT_ACTION_REQUEST_TYPES);
export const appointmentActionRequestedBySchema = z.enum(APPOINTMENT_ACTION_REQUESTED_BY);

export type AppointmentActionRequestStatus = z.infer<typeof appointmentActionRequestStatusSchema>;
export type AppointmentActionRequestType = z.infer<typeof appointmentActionRequestTypeSchema>;
export type AppointmentActionRequestedBy = z.infer<typeof appointmentActionRequestedBySchema>;
