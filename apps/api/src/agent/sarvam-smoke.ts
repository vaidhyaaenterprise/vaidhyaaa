import { parseApiEnv } from '@vaidya/config';
import {
  buildCompactClassifierUserPayload,
  COMPACT_CLASSIFIER_SYSTEM_PROMPT,
  parseIntentClassifierJson,
  type IntentClassifierInput,
} from '@vaidya/shared';

import { SarvamLlmClient } from '../common/llm/sarvam-client';

const SMOKE_MESSAGES = [
  'Naalaikku evening appointment venum',
  'Fever-ku enna tablet?',
  'Chest pain irukku',
  'Sunday open-a?',
] as const;

const baseInput: IntentClassifierInput = {
  clinicId: '00000000-0000-0000-0000-000000000001',
  messageText: '',
  currentFlow: 'none',
  currentState: 'IDLE',
  languageCode: 'ta_tanglish',
  knownCollectedFields: {},
};

async function main() {
  if (!process.env.SARVAM_API_KEY) {
    console.log(
      JSON.stringify(
        {
          mode: 'sarvam_smoke',
          skipped: true,
          reason: 'SARVAM_API_KEY missing',
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  const env = parseApiEnv({
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    APP_ENV: process.env.APP_ENV ?? 'local',
    DATABASE_URL:
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/vaidya_local',
    JWT_SECRET: process.env.JWT_SECRET ?? 'dev_only_change_me',
    SARVAM_API_KEY: process.env.SARVAM_API_KEY,
    SARVAM_AUTH_MODE: process.env.SARVAM_AUTH_MODE,
    PRIMARY_LLM_MODEL: process.env.PRIMARY_LLM_MODEL,
    FALLBACK_LLM_MODEL: process.env.FALLBACK_LLM_MODEL,
  });

  const client = SarvamLlmClient.fromEnv(env);
  const results: Array<Record<string, unknown>> = [];

  for (const messageText of SMOKE_MESSAGES) {
    const userPayload = buildCompactClassifierUserPayload({
      ...baseInput,
      messageText,
    });
    const response = await client.chat({
      model: '',
      messages: [
        { role: 'system', content: COMPACT_CLASSIFIER_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
      responseFormat: 'json_object',
      temperature: 0,
    });

    const classification =
      parseIntentClassifierJson(response.content, baseInput.languageCode) ??
      ({
        intent: 'unknown',
        needsClarification: true,
        provider_error: 'invalid_or_empty_json',
      } as const);

    results.push({
      message: messageText,
      model: response.model,
      classification,
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: 'sarvam_smoke',
        skipped: false,
        auth_mode: env.SARVAM_AUTH_MODE,
        primary_model: env.PRIMARY_LLM_MODEL,
        results,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      mode: 'sarvam_smoke',
      error: error instanceof Error ? error.message : 'unknown_error',
    }),
  );
  process.exit(1);
});
