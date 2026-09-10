import { z } from 'zod';

import { AGENT_INTENTS } from '../agent/intents';

export const nluReviewCaptureReasonSchema = z.enum([
  'unknown_intent',
  'low_confidence',
  'unrecognized_active_state',
  'low_confidence_state_extraction',
]);

export const nluReviewStatusSchema = z.enum(['pending', 'reviewed', 'dismissed', 'exported']);

export const patchNluReviewItemSchema = z.object({
  correct_intent: z.enum(AGENT_INTENTS),
  correct_entities_json: z.record(z.unknown()).optional(),
});

export const exportNluReviewItemsSchema = z.object({
  clinic_id: z.string().uuid().optional(),
  include_exported: z.boolean().optional(),
});

export type PatchNluReviewItemInput = z.infer<typeof patchNluReviewItemSchema>;

export type NluReviewExportCase = {
  id: string;
  message_text_redacted: string;
  current_flow: string;
  current_state: string;
  failure_type: string;
  capture_reason: string;
  predicted_intent: string | null;
  predicted_confidence: number | null;
  predicted_entities_json: Record<string, unknown>;
  correct_intent: string;
  correct_entities_json: Record<string, unknown>;
};
