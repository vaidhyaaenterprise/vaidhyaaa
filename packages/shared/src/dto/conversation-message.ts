import { z } from 'zod';

import {
  conversationChannelSchema,
  conversationFlowSchema,
  conversationMessageSenderSchema,
  conversationSessionStatusSchema,
} from '../enums/conversation';
import { languageCodeSchema } from '../enums/language-codes';

import { auditTimestampsSchema, timestamptzSchema, uuidSchema } from './common';

export const conversationSessionResponseSchema = z
  .object({
    id: uuidSchema,
    clinic_id: uuidSchema,
    channel: conversationChannelSchema,
    patient_phone: z.string().nullable(),
    patient_id: uuidSchema.nullable(),
    language_code: languageCodeSchema,
    language_source: z.enum(['clinic_default', 'patient_requested', 'detected']).nullable(),
    current_flow: conversationFlowSchema,
    current_state: z.string().min(1),
    collected_json: z.record(z.unknown()),
    status: conversationSessionStatusSchema,
    expires_at: timestamptzSchema.nullable(),
  })
  .merge(auditTimestampsSchema);

export const conversationMessageResponseSchema = z.object({
  id: uuidSchema,
  clinic_id: uuidSchema,
  session_id: uuidSchema,
  sender: conversationMessageSenderSchema,
  message_text: z.string().min(1),
  intent: z.string().nullable(),
  reply_template_key: z.string().nullable(),
  flow_before: z.string().nullable(),
  state_before: z.string().nullable(),
  flow_after: z.string().nullable(),
  state_after: z.string().nullable(),
  debug_json: z.record(z.unknown()).nullable(),
  created_at: timestamptzSchema,
});

export const createConversationMessageSchema = z.object({
  session_id: uuidSchema,
  sender: conversationMessageSenderSchema,
  message_text: z.string().min(1),
  intent: z.string().optional(),
  reply_template_key: z.string().optional(),
  flow_before: z.string().optional(),
  state_before: z.string().optional(),
  flow_after: z.string().optional(),
  state_after: z.string().optional(),
  debug_json: z.record(z.unknown()).optional(),
});

export type ConversationSessionResponse = z.infer<typeof conversationSessionResponseSchema>;
export type ConversationMessageResponse = z.infer<typeof conversationMessageResponseSchema>;
export type CreateConversationMessageInput = z.infer<typeof createConversationMessageSchema>;
