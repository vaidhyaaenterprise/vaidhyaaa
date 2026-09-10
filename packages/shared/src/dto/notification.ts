import { z } from 'zod';

import {
  notificationChannelSchema,
  notificationEventStatusSchema,
  notificationEventTypeSchema,
  notificationRecipientTypeSchema,
} from '../enums/notification';
import { languageCodeSchema } from '../enums/language-codes';

import { auditTimestampsSchema, timestamptzSchema, uuidSchema } from './common';

export const notificationEventResponseSchema = z
  .object({
    id: uuidSchema,
    clinic_id: uuidSchema,
    event_type: z.string().min(1),
    recipient_type: notificationRecipientTypeSchema,
    recipient_phone: z.string().nullable(),
    recipient_email: z.string().nullable(),
    channel: notificationChannelSchema,
    template_key: z.string().nullable(),
    language_code: languageCodeSchema.nullable(),
    payload_json: z.record(z.unknown()),
    deduplication_key: z.string().nullable(),
    status: notificationEventStatusSchema,
    attempt_count: z.number().int().min(0),
    max_attempts: z.number().int().positive(),
    provider_response_json: z.record(z.unknown()).nullable(),
    last_error: z.string().nullable(),
    scheduled_at: timestamptzSchema.nullable(),
    sent_at: timestamptzSchema.nullable(),
  })
  .merge(auditTimestampsSchema);

export const createNotificationEventSchema = z.object({
  event_type: notificationEventTypeSchema,
  recipient_type: notificationRecipientTypeSchema,
  recipient_phone: z.string().optional(),
  recipient_email: z.string().email().optional(),
  channel: notificationChannelSchema,
  template_key: z.string().optional(),
  language_code: languageCodeSchema.optional(),
  payload_json: z.record(z.unknown()).default({}),
  deduplication_key: z.string().optional(),
  scheduled_at: timestamptzSchema.optional(),
});

export type NotificationEventResponse = z.infer<typeof notificationEventResponseSchema>;
export type CreateNotificationEventInput = z.infer<typeof createNotificationEventSchema>;
