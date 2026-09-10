import { z } from 'zod';

import { languageCodeSchema } from '../enums/language-codes';

import { auditTimestampsSchema, timestamptzSchema, uuidSchema } from './common';

export const KNOWLEDGE_STATUSES = [
  'pending_review',
  'approved',
  'disabled',
  'needs_update',
] as const;

export const KNOWLEDGE_FILE_STATUSES = ['uploaded', 'processing', 'processed', 'failed'] as const;

export const knowledgeStatusSchema = z.enum(KNOWLEDGE_STATUSES);
export const knowledgeFileStatusSchema = z.enum(KNOWLEDGE_FILE_STATUSES);

export const knowledgeEntryResponseSchema = z
  .object({
    id: uuidSchema,
    clinic_id: uuidSchema,
    question: z.string().min(1),
    answer: z.string(),
    category: z.string().nullable(),
    alternative_phrases_json: z.array(z.string()),
    template_key: z.string().nullable().optional(),
    section_key: z.string().nullable().optional(),
    source_notes: z.string().nullable().optional(),
    service_name: z.string().nullable().optional(),
    applicable: z.boolean().optional(),
    qa_approved: z.boolean().optional(),
    embedding_status: z.string().optional(),
    embedding_model: z.string().nullable().optional(),
    embedding_generated_at: timestamptzSchema.nullable().optional(),
    search_text: z.string().nullable().optional(),
    source_file_id: uuidSchema.nullable(),
    source_file: z.string().nullable(),
    source_page: z.number().int().nullable(),
    status: knowledgeStatusSchema,
    approved_by_user_id: uuidSchema.nullable(),
    approved_at: timestamptzSchema.nullable(),
  })
  .merge(auditTimestampsSchema);

export const createKnowledgeEntrySchema = z.object({
  template_key: z.string().min(1).optional(),
  section_key: z.string().min(1).optional(),
  question: z.string().min(1),
  answer: z.string(),
  category: z.string().optional(),
  alternative_phrases_json: z.array(z.string()).default([]),
  source_notes: z.string().optional(),
  service_name: z.string().optional(),
  applicable: z.boolean().optional(),
  qa_approved: z.boolean().optional(),
  source_file_id: uuidSchema.optional(),
  source_file: z.string().optional(),
  source_page: z.number().int().optional(),
  status: z.enum(['pending_review', 'needs_update', 'approved', 'disabled']).optional(),
});

export const patchKnowledgeEntrySchema = createKnowledgeEntrySchema.partial().extend({
  status: knowledgeStatusSchema.optional(),
});

export const knowledgeTranslationResponseSchema = z
  .object({
    id: uuidSchema,
    clinic_id: uuidSchema,
    knowledge_id: uuidSchema,
    language_code: languageCodeSchema,
    translated_question: z.string().nullable(),
    translated_answer: z.string().min(1),
    status: knowledgeStatusSchema,
    approved_by_user_id: uuidSchema.nullable(),
    approved_at: timestamptzSchema.nullable(),
  })
  .merge(auditTimestampsSchema);

export const knowledgeFileResponseSchema = z
  .object({
    id: uuidSchema,
    clinic_id: uuidSchema,
    file_name: z.string().min(1),
    file_type: z.string().min(1),
    storage_key: z.string().nullable(),
    status: knowledgeFileStatusSchema,
    uploaded_by_user_id: uuidSchema.nullable(),
  })
  .merge(auditTimestampsSchema);

export type KnowledgeEntryResponse = z.infer<typeof knowledgeEntryResponseSchema>;
export type CreateKnowledgeEntryInput = z.infer<typeof createKnowledgeEntrySchema>;
export type PatchKnowledgeEntryInput = z.infer<typeof patchKnowledgeEntrySchema>;
export type KnowledgeTranslationResponse = z.infer<typeof knowledgeTranslationResponseSchema>;
export type KnowledgeFileResponse = z.infer<typeof knowledgeFileResponseSchema>;
