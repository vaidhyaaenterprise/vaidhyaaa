import { z } from 'zod';

import { uuidSchema } from './common';

export const voiceIncomingCallSchema = z.object({
  provider: z.string().min(1).default('mock'),
  provider_call_id: z.string().min(1),
  provider_number: z.string().min(3),
  caller_phone: z.string().min(3),
  overflow_forwarded: z.boolean().optional(),
});

export const voiceTranscriptTurnSchema = z.object({
  transcript_text: z.string().min(1),
  speaker: z.enum(['patient', 'assistant', 'system']).default('patient'),
  stt_confidence: z.number().min(0).max(1).optional(),
  started_at_ms: z.number().int().nonnegative().optional(),
  ended_at_ms: z.number().int().nonnegative().optional(),
  idempotency_key: z.string().min(1).optional(),
});

export const voiceCallEventSchema = z.object({
  event_type: z.enum([
    'call_started',
    'call_ended',
    'silence_timeout',
    'no_speech_retry',
    'stt_failure',
    'llm_failure',
    'tts_failure',
    'forwarded',
  ]),
  outcome: z.string().optional(),
  duration_seconds: z.number().int().nonnegative().optional(),
  summary: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const voiceRecordingReadySchema = z.object({
  storage_key: z.string().min(1),
  content_type: z.string().min(1).default('audio/mpeg'),
  size_bytes: z.number().int().positive().optional(),
  provider_recording_url: z.string().url().optional(),
});

export const voiceIncomingCallResponseSchema = z.object({
  action: z.enum(['answer', 'forward']),
  forward_to: z.string().nullable(),
  call_id: uuidSchema.nullable(),
  session_id: uuidSchema.nullable(),
  greeting_text: z.string().nullable(),
  reason: z.string().optional(),
});

export type VoiceIncomingCallInput = z.infer<typeof voiceIncomingCallSchema>;
export type VoiceTranscriptTurnInput = z.infer<typeof voiceTranscriptTurnSchema>;
export type VoiceCallEventInput = z.infer<typeof voiceCallEventSchema>;
export type VoiceRecordingReadyInput = z.infer<typeof voiceRecordingReadySchema>;
export type VoiceIncomingCallResponse = z.infer<typeof voiceIncomingCallResponseSchema>;
