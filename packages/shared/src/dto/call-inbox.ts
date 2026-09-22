import { z } from 'zod';

import { auditTimestampsSchema, timestamptzSchema, uuidSchema } from './common';

export const CALL_INBOX_OUTCOMES = [
  'appointment_booked',
  'appointment_cancelled',
  'appointment_rescheduled',
  'general_inquiry',
  'callback_requested',
  'emergency',
] as const;

export const callInboxOutcomeSchema = z.enum(CALL_INBOX_OUTCOMES);

export const callInboxSourceSchema = z.enum([
  'appointment_request',
  'appointment_action_request',
  'callback_request',
  'emergency_incident',
  'conversation_message',
  'call',
]);

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
    patient_name: z.string().nullable().optional(),
    call_id: uuidSchema.nullable().optional(),
    source_type: callInboxSourceSchema.optional(),
    source_id: uuidSchema.optional(),
    occurred_at: timestamptzSchema.optional(),
    outcome: callInboxOutcomeSchema.nullable(),
    action_needed: z
      .enum([
        'confirmation_needed',
        'appointment_action_needed',
        'callback_needed',
        'emergency_response',
        'none',
      ])
      .optional(),
    summary: z.string().nullable(),
    recording_url: z.string().nullable(),
    recording_storage_key: z.string().nullable(),
    recording_expires_at: timestamptzSchema.nullable(),
    recording_deleted_at: timestamptzSchema.nullable(),
    transcript_expires_at: timestamptzSchema.nullable(),
    created_appointment_request_id: uuidSchema.nullable(),
    created_callback_request_id: uuidSchema.nullable(),
    created_emergency_incident_id: uuidSchema.nullable().optional(),
    appointment_action_request_id: uuidSchema.nullable().optional(),
    source_status: z.string().nullable().optional(),
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
export type CallInboxOutcome = z.infer<typeof callInboxOutcomeSchema>;
export type CallInboxSource = z.infer<typeof callInboxSourceSchema>;
