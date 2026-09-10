import { z } from 'zod';

export const SUPPORTED_LANGUAGE_CODES = ['ta_tanglish', 'english'] as const;

export const languageCodeSchema = z.enum(SUPPORTED_LANGUAGE_CODES);
export type LanguageCode = z.infer<typeof languageCodeSchema>;
