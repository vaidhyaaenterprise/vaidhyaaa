import { z } from 'zod';

import { auditTimestampsSchema, dateSchema, uuidSchema } from './common';

const clinicLocalTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/);

export const bookingRuleResponseSchema = z
  .object({
    id: uuidSchema,
    clinic_id: uuidSchema,
    doctor_id: uuidSchema,
    clinic_service_id: uuidSchema,
    slot_duration_minutes: z.number().int().positive(),
    capacity_per_slot: z.number().int().positive(),
    booking_horizon_days: z.number().int().min(1).max(180),
    min_booking_notice_minutes: z.number().int().min(0),
    max_advance_booking_days: z.number().int().positive().nullable(),
    manual_edit_cutoff_before_start_minutes: z.number().int().min(0),
    manual_edit_max_shift_minutes: z.number().int().min(0),
    effective_from: dateSchema,
    effective_to: dateSchema.nullable(),
    active: z.boolean(),
    version: z.number().int().positive(),
  })
  .merge(auditTimestampsSchema);

export const createBookingRuleSchema = z.object({
  doctor_id: uuidSchema,
  clinic_service_id: uuidSchema,
  slot_duration_minutes: z.number().int().positive(),
  capacity_per_slot: z.number().int().positive(),
  booking_horizon_days: z.number().int().min(1).max(180).default(45),
  min_booking_notice_minutes: z.number().int().min(0).default(0),
  max_advance_booking_days: z.number().int().positive().optional(),
  manual_edit_cutoff_before_start_minutes: z.number().int().min(0).default(60),
  manual_edit_max_shift_minutes: z.number().int().min(0).default(60),
  effective_from: dateSchema.optional(),
  effective_to: dateSchema.nullable().optional(),
  active: z.boolean().default(true),
});

export const updateBookingRuleSchema = createBookingRuleSchema
  .omit({ doctor_id: true, clinic_service_id: true })
  .partial()
  .extend({
    slot_duration_minutes: z.number().int().positive().optional(),
    capacity_per_slot: z.number().int().positive().optional(),
    implement_from: clinicLocalTimestampSchema.optional(),
  });

export type BookingRuleResponse = z.infer<typeof bookingRuleResponseSchema>;
export type CreateBookingRuleInput = z.infer<typeof createBookingRuleSchema>;
export type UpdateBookingRuleInput = z.infer<typeof updateBookingRuleSchema>;
