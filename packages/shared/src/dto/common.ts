import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const timestamptzSchema = z.string().datetime({ offset: true });
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const timeSchema = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);
export const dayOfWeekSchema = z.number().int().min(0).max(6);

export const auditTimestampsSchema = z.object({
  created_at: timestamptzSchema,
  updated_at: timestamptzSchema,
});
