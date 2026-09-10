import { z } from 'zod';

import { conversationChannelSchema } from '../enums/conversation';
import { languageCodeSchema } from '../enums/language-codes';

import { uuidSchema } from './common';

export const createConversationSessionSchema = z.object({
  clinic_id: uuidSchema,
  channel: conversationChannelSchema,
  patient_phone: z.string().min(3).optional(),
  language_code: languageCodeSchema.optional(),
});

export const sendConversationMessageSchema = z.object({
  message_text: z.string().min(1),
  idempotency_key: z.string().min(1).optional(),
});

export type CreateConversationSessionInput = z.infer<typeof createConversationSessionSchema>;
export type SendConversationMessageInput = z.infer<typeof sendConversationMessageSchema>;
