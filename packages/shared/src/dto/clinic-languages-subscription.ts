import { z } from 'zod';

export const clinicLanguageItemSchema = z.object({
  language_code: z.string().min(1),
  enabled: z.boolean(),
  is_default: z.boolean(),
});

export const clinicLanguagesResponseSchema = z.object({
  default_language_code: z.string(),
  languages: z.array(clinicLanguageItemSchema),
});

export const replaceClinicLanguagesSchema = z.object({
  default_language_code: z.string().min(1),
  languages: z.array(clinicLanguageItemSchema),
});

export const supportedLanguageResponseSchema = z.object({
  language_code: z.string(),
  display_name: z.string(),
  enabled_platform_wide: z.boolean(),
});

export const clinicSubscriptionResponseSchema = z.object({
  plan_key: z.string(),
  plan_name: z.string(),
  status: z.string(),
  included_voice_minutes: z.number().int(),
  max_concurrent_calls: z.number().int(),
  recording_retention_days: z.number().int(),
  transcript_retention_days: z.number().int(),
  trial_end: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const clinicUsageResponseSchema = z.object({
  month: z.string(),
  used_voice_minutes: z.number().int(),
  included_voice_minutes: z.number().int(),
  voice_call_count: z.number().int(),
});

export const platformSubscriptionChangeSchema = z.object({
  plan_key: z.string().min(1),
  status: z.string().min(1),
  trial_end: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type ClinicLanguagesResponse = z.infer<typeof clinicLanguagesResponseSchema>;
export type ReplaceClinicLanguagesInput = z.infer<typeof replaceClinicLanguagesSchema>;
export type ClinicSubscriptionResponse = z.infer<typeof clinicSubscriptionResponseSchema>;
export type ClinicUsageResponse = z.infer<typeof clinicUsageResponseSchema>;
export type PlatformSubscriptionChangeInput = z.infer<typeof platformSubscriptionChangeSchema>;
