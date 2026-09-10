import { z } from 'zod';

import { AppError } from '../errors/index';
import { JOB_TYPES, type JobType } from './job-types';

const clinicScopedSchema = z.object({
  clinic_id: z.string().uuid(),
});

export const sendNotificationJobPayloadSchema = clinicScopedSchema.extend({
  notification_event_id: z.string().uuid(),
  channel: z.enum(['whatsapp', 'sms', 'email', 'dashboard']),
  recipient: z.string().min(1),
  template_key: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
});

export const expireSlotHoldsJobPayloadSchema = z.object({
  clinic_id: z.string().uuid().optional(),
  batch_limit: z.number().int().positive().default(100),
});

export const generateSlotsJobPayloadSchema = z.object({
  clinic_id: z.string().uuid().optional(),
  doctor_id: z.string().uuid().optional(),
  clinic_service_id: z.string().uuid().optional(),
  horizon_days: z.number().int().positive().optional(),
});

export const cleanupExpiredRecordingsJobPayloadSchema = z.object({
  clinic_id: z.string().uuid().optional(),
  retention_days: z.number().int().positive().optional(),
});

export const cleanupExpiredTranscriptsJobPayloadSchema = z.object({
  clinic_id: z.string().uuid().optional(),
  retention_days: z.number().int().positive().optional(),
});

export const parseKnowledgeDocxJobPayloadSchema = clinicScopedSchema.extend({
  knowledge_file_id: z.string().uuid(),
});

export const generateKnowledgeEmbeddingJobPayloadSchema = clinicScopedSchema.extend({
  knowledge_entry_id: z.string().uuid(),
  requested_by_user_id: z.string().uuid().optional(),
  reason: z
    .enum(['approved', 'edited', 'bulk_regenerate', 'manual_retry'])
    .optional()
    .default('approved'),
});

export const generateDailyClinicReportJobPayloadSchema = clinicScopedSchema.extend({
  report_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const jobPayloadSchemas: Record<JobType, z.ZodTypeAny> = {
  [JOB_TYPES.SEND_NOTIFICATION]: sendNotificationJobPayloadSchema,
  [JOB_TYPES.EXPIRE_SLOT_HOLDS]: expireSlotHoldsJobPayloadSchema,
  [JOB_TYPES.GENERATE_SLOTS]: generateSlotsJobPayloadSchema,
  [JOB_TYPES.CLEANUP_EXPIRED_RECORDINGS]: cleanupExpiredRecordingsJobPayloadSchema,
  [JOB_TYPES.CLEANUP_EXPIRED_TRANSCRIPTS]: cleanupExpiredTranscriptsJobPayloadSchema,
  [JOB_TYPES.PARSE_KNOWLEDGE_DOCX]: parseKnowledgeDocxJobPayloadSchema,
  [JOB_TYPES.GENERATE_KNOWLEDGE_EMBEDDING]: generateKnowledgeEmbeddingJobPayloadSchema,
  [JOB_TYPES.GENERATE_DAILY_CLINIC_REPORT]: generateDailyClinicReportJobPayloadSchema,
};

export function validateJobPayload(
  jobType: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const schema = jobPayloadSchemas[jobType as JobType];
  if (!schema) {
    throw new AppError('VALIDATION_ERROR', `Unknown job type: ${jobType}`, { job_type: jobType });
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid job payload.', {
      job_type: jobType,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  return result.data as Record<string, unknown>;
}

export function isClinicScopedJobType(jobType: string): jobType is JobType {
  return jobType in jobPayloadSchemas;
}
