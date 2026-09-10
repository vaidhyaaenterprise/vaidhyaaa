import { z } from 'zod';

import { uuidSchema } from './common';

const clinicLocalTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/);

export const scheduleConflictItemSchema = z.object({
  appointment_id: uuidSchema.optional(),
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
export type ConflictPreviewResponse = z.infer<typeof conflictPreviewResponseSchema>;
