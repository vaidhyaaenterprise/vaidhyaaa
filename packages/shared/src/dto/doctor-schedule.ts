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

export const replaceDoctorSchedulesSchema = z
  .object({
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
  })
  .superRefine(({ windows }, context) => {
    for (const [index, window] of windows.entries()) {
      const timePattern = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
      if (
        !timePattern.test(window.start_time) ||
        !timePattern.test(window.end_time) ||
        window.start_time.padEnd(8, ':00') >= window.end_time.padEnd(8, ':00')
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['windows', index],
          message: 'Choose valid working hours with the end time after the start time.',
        });
      }
      if (
        window.effective_from &&
        window.effective_to &&
        window.effective_from > window.effective_to
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['windows', index],
          message: 'The schedule end date must not be before its start date.',
        });
      }
      if (!window.active) continue;
      const overlaps = windows
        .slice(0, index)
        .some(
          (other) =>
            other.active &&
            other.day_of_week === window.day_of_week &&
            other.start_time.padEnd(8, ':00') < window.end_time.padEnd(8, ':00') &&
            other.end_time.padEnd(8, ':00') > window.start_time.padEnd(8, ':00') &&
            (other.effective_from ?? '0000-01-01') <= (window.effective_to ?? '9999-12-31') &&
            (window.effective_from ?? '0000-01-01') <= (other.effective_to ?? '9999-12-31'),
        );
      if (overlaps)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['windows', index],
          message:
            'Working hours for the same doctor must not overlap. Adjust or remove the overlapping time.',
        });
    }
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
