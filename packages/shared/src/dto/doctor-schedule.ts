import { z } from 'zod';

import {
  auditTimestampsSchema,
  dateSchema,
  dayOfWeekSchema,
  timeSchema,
  uuidSchema,
} from './common';

export const scheduleWindowSchema = z.object({
  id: uuidSchema,
  clinic_id: uuidSchema,
  doctor_id: uuidSchema,
  doctor_service_id: uuidSchema.nullable(),
  day_of_week: dayOfWeekSchema,
  start_time: timeSchema,
  end_time: timeSchema,
  effective_from: dateSchema.nullable(),
  effective_to: dateSchema.nullable(),
  active: z.boolean(),
});

export const doctorScheduleResponseSchema = scheduleWindowSchema.merge(auditTimestampsSchema);

export const replaceDoctorSchedulesSchema = z.object({
  windows: z.array(
    z.object({
      doctor_service_id: uuidSchema.nullable().optional(),
      day_of_week: dayOfWeekSchema,
      start_time: timeSchema,
      end_time: timeSchema,
      effective_from: dateSchema.nullable().optional(),
      effective_to: dateSchema.nullable().optional(),
      active: z.boolean().default(true),
    }),
  ),
});

export const addDoctorScheduleWindowSchema = z.object({
  doctor_service_id: uuidSchema.nullable().optional(),
  day_of_week: dayOfWeekSchema,
  start_time: timeSchema,
  end_time: timeSchema,
  effective_from: dateSchema.nullable().optional(),
  effective_to: dateSchema.nullable().optional(),
  active: z.boolean().default(true),
});

export const patchDoctorScheduleWindowSchema = addDoctorScheduleWindowSchema.partial().extend({
  active: z.boolean().optional(),
});

export const disableDoctorScheduleWindowSchema = z.object({
  active: z.literal(false),
});

export type DoctorScheduleResponse = z.infer<typeof doctorScheduleResponseSchema>;
export type ReplaceDoctorSchedulesInput = z.infer<typeof replaceDoctorSchedulesSchema>;
export type AddDoctorScheduleWindowInput = z.infer<typeof addDoctorScheduleWindowSchema>;
export type PatchDoctorScheduleWindowInput = z.infer<typeof patchDoctorScheduleWindowSchema>;
