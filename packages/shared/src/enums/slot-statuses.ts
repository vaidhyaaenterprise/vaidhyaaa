import { z } from 'zod';

export const SLOT_STATUSES = ['open', 'blocked', 'cancelled', 'superseded'] as const;

export const slotStatusSchema = z.enum(SLOT_STATUSES);
export type SlotStatus = z.infer<typeof slotStatusSchema>;
