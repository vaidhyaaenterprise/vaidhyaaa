import { z } from 'zod';

export const SLOT_HOLD_STATUSES = ['active', 'expired', 'released', 'converted'] as const;

export const slotHoldStatusSchema = z.enum(SLOT_HOLD_STATUSES);
export type SlotHoldStatus = z.infer<typeof slotHoldStatusSchema>;
