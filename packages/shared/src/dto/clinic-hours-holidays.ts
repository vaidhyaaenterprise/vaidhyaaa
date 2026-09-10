import { z } from 'zod';

import {
  auditTimestampsSchema,
  dateSchema,
  dayOfWeekSchema,
  timeSchema,
  uuidSchema,
} from './common';

export const clinicHoursWindowSchema = z.object({
  id: uuidSchema,
  clinic_id: uuidSchema,
  day_of_week: dayOfWeekSchema,
  start_time: timeSchema,
  end_time: timeSchema,
  active: z.boolean(),
});

export const clinicHoursResponseSchema = clinicHoursWindowSchema.merge(auditTimestampsSchema);

export const replaceClinicHoursSchema = z.object({
  windows: z.array(
    z.object({
      day_of_week: dayOfWeekSchema,
      start_time: timeSchema,
      end_time: timeSchema,
      active: z.boolean().default(true),
    }),
  ),
});

export const addClinicHoursWindowSchema = z.object({
  day_of_week: dayOfWeekSchema,
  start_time: timeSchema,
  end_time: timeSchema,
  active: z.boolean().default(true),
});

export const patchClinicHoursWindowSchema = addClinicHoursWindowSchema.partial().extend({
  active: z.boolean().optional(),
});

export const disableClinicHoursWindowSchema = z.object({
  active: z.literal(false),
});

export const clinicHolidayResponseSchema = z
  .object({
    id: uuidSchema,
    clinic_id: uuidSchema,
    holiday_date: dateSchema,
    is_full_day: z.boolean(),
    start_time: timeSchema.nullable(),
    end_time: timeSchema.nullable(),
    reason: z.string().nullable(),
    active: z.boolean(),
    created_by_user_id: uuidSchema.nullable(),
    applies_to_clinic: z.boolean(),
    doctor_ids: z.array(uuidSchema),
  })
  .merge(auditTimestampsSchema);

export const createClinicHolidaySchema = z.object({
  holiday_date: dateSchema,
  is_full_day: z.boolean().default(true),
  start_time: timeSchema.nullable().optional(),
  end_time: timeSchema.nullable().optional(),
  reason: z.string().optional(),
  active: z.boolean().default(true),
  doctor_ids: z.array(uuidSchema).optional(),
});

export const patchClinicHolidaySchema = createClinicHolidaySchema.partial();

export type ClinicHoursResponse = z.infer<typeof clinicHoursResponseSchema>;
export type ReplaceClinicHoursInput = z.infer<typeof replaceClinicHoursSchema>;
export type AddClinicHoursWindowInput = z.infer<typeof addClinicHoursWindowSchema>;
export type PatchClinicHoursWindowInput = z.infer<typeof patchClinicHoursWindowSchema>;
export type ClinicHolidayResponse = z.infer<typeof clinicHolidayResponseSchema>;
export type CreateClinicHolidayInput = z.infer<typeof createClinicHolidaySchema>;
export type PatchClinicHolidayInput = z.infer<typeof patchClinicHolidaySchema>;
