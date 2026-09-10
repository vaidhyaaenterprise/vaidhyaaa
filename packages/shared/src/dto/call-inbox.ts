import { z } from 'zod';

import { auditTimestampsSchema, timestamptzSchema, uuidSchema } from './common';

export const callInboxItemSchema = z
  .object({
    id: uuidSchema,
    clinic_id: uuidSchema,
    session_id: uuidSchema.nullable(),
    patient_phone: z.string().nullable(),
    patient_id: uuidSchema.nullable(),
    provider: z.string().nullable(),
    provider_call_id: z.string().nullable(),
    started_at: timestamptzSchema.nullable(),
    ended_at: timestamptzSchema.nullable(),
    duration_seconds: z.number().int().nullable(),
    outcome: z.string().nullable(),
    summary: z.string().nullable(),
    recording_url: z.string().nullable(),
    recording_storage_key: z.string().nullable(),
    recording_expires_at: timestamptzSchema.nullable(),
    recording_deleted_at: timestamptzSchema.nullable(),
    transcript_expires_at: timestamptzSchema.nullable(),
    created_appointment_request_id: uuidSchema.nullable(),
    created_callback_request_id: uuidSchema.nullable(),
  })
  .merge(auditTimestampsSchema);

export const callTranscriptEntrySchema = z.object({
  id: uuidSchema,
  clinic_id: uuidSchema,
  call_id: uuidSchema,
  speaker: z.enum(['patient', 'assistant', 'system']),
  transcript_text: z.string().min(1),
  started_at_ms: z.number().int().nullable(),
  ended_at_ms: z.number().int().nullable(),
  created_at: timestamptzSchema,
});

export const callInboxListResponseSchema = z.object({
  items: z.array(callInboxItemSchema),
  next_cursor: z.string().nullable(),
});

export type CallInboxItem = z.infer<typeof callInboxItemSchema>;
export type CallTranscriptEntry = z.infer<typeof callTranscriptEntrySchema>;
export type CallInboxListResponse = z.infer<typeof callInboxListResponseSchema>;
