import { z } from 'zod';

import {
  appointmentActionRequestStatusSchema,
  appointmentActionRequestTypeSchema,
  appointmentActionRequestedBySchema,
} from '../enums/appointment-action-statuses';

import { auditTimestampsSchema, dateSchema, uuidSchema } from './common';

export const appointmentActionRequestResponseSchema = z
  .object({
    id: uuidSchema,
    clinic_id: uuidSchema,
    appointment_id: uuidSchema,
    request_type: appointmentActionRequestTypeSchema,
    requested_by: appointmentActionRequestedBySchema,
    status: appointmentActionRequestStatusSchema,
    requested_new_slot_id: uuidSchema.nullable(),
    requested_new_date: dateSchema.nullable(),
    requested_new_time_preference: z.string().nullable(),
    reason: z.string().nullable(),
    source_call_id: uuidSchema.nullable(),
    source_session_id: uuidSchema.nullable(),
  })
  .merge(auditTimestampsSchema);

export const createAppointmentActionRequestSchema = z.object({
  appointment_id: uuidSchema,
  request_type: appointmentActionRequestTypeSchema,
  requested_by: appointmentActionRequestedBySchema,
  requested_new_slot_id: uuidSchema.optional(),
  requested_new_date: dateSchema.optional(),
  requested_new_time_preference: z.string().optional(),
  reason: z.string().optional(),
  source_call_id: uuidSchema.optional(),
  source_session_id: uuidSchema.optional(),
});

export const patchAppointmentActionRequestSchema = z.object({
  status: appointmentActionRequestStatusSchema.optional(),
  requested_new_slot_id: uuidSchema.nullable().optional(),
  requested_new_date: dateSchema.nullable().optional(),
  requested_new_time_preference: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
});

export const resolveAppointmentActionRequestSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  new_slot_id: uuidSchema.optional(),
});

export type AppointmentActionRequestResponse = z.infer<
  typeof appointmentActionRequestResponseSchema
>;
export type CreateAppointmentActionRequestInput = z.infer<
  typeof createAppointmentActionRequestSchema
>;
export type PatchAppointmentActionRequestInput = z.infer<
  typeof patchAppointmentActionRequestSchema
>;
export type ResolveAppointmentActionRequestInput = z.infer<
  typeof resolveAppointmentActionRequestSchema
>;
