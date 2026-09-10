import { z } from 'zod';

export const createReviewedExampleSchema = z.object({
  language_code: z.string().min(2),
  message_text_redacted: z.string().min(1),
  context_flow: z.string().min(1),
  context_state: z.string().min(1),
  expected_recognized_as: z.string().min(1),
  expected_intent: z.string().optional(),
  expected_entities_json: z.record(z.unknown()).optional(),
  source: z.string().optional(),
  approved_for_prompt_examples: z.boolean().optional(),
});

export const addLanguagePackWordsSchema = z.object({
  field: z.enum([
    'yes_words',
    'no_words',
    'cancel_words',
    'today_words',
    'tomorrow_words',
    'later_words',
    'time_preference_morning',
    'time_preference_afternoon',
    'time_preference_evening',
  ]),
  words: z.array(z.string().min(1)).min(1),
});

export const createLanguagePackSchema = z.object({
  language_code: z.string().min(2),
  display_name: z.string().min(1),
  yes_words: z.array(z.string()).optional(),
  no_words: z.array(z.string()).optional(),
  today_words: z.array(z.string()).optional(),
  tomorrow_words: z.array(z.string()).optional(),
});

export type CreateReviewedExampleInput = z.infer<typeof createReviewedExampleSchema>;
export type AddLanguagePackWordsInput = z.infer<typeof addLanguagePackWordsSchema>;
export type CreateLanguagePackInput = z.infer<typeof createLanguagePackSchema>;
