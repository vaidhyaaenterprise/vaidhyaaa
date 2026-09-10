import { z } from 'zod';

const nodeEnvSchema = z.enum(['development', 'test', 'production']);
const appEnvSchema = z.enum(['local', 'qa', 'staging', 'production']);
const authModeSchema = z.enum(['dev', 'otp', 'supabase', 'jwt']);
const queueModeSchema = z.preprocess(
  (value) => (value === 'redis' ? 'bullmq' : value),
  z.enum(['inline', 'bullmq']),
);
const llmProviderSchema = z.enum(['mock', 'sarvam']);
const receptionistAgentProviderSchema = z.enum(['mock', 'sarvam', 'openai_compatible', 'anthropic']);
const conversationAgentModeSchema = z.enum(['legacy', 'agent']);
const providerSchema = z.enum(['mock', 'real']);

function isSupabaseDatabaseHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host.endsWith('.supabase.co') || host.endsWith('.supabase.com');
}

function requiresSupabaseDatabase(env: {
  NODE_ENV: z.infer<typeof nodeEnvSchema>;
  APP_ENV: z.infer<typeof appEnvSchema>;
}): boolean {
  return !(env.NODE_ENV === 'test' && env.APP_ENV === 'local');
}

function getSupabaseDatabaseUrlIssues(databaseUrl: string): string[] {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    return ['DATABASE_URL must be a valid PostgreSQL URL.'];
  }
  const issues: string[] = [];

  if (parsedUrl.protocol !== 'postgres:' && parsedUrl.protocol !== 'postgresql:') {
    issues.push('DATABASE_URL must use the PostgreSQL protocol.');
  }

  if (!isSupabaseDatabaseHost(parsedUrl.hostname)) {
    issues.push('DATABASE_URL must use a Supabase PostgreSQL connection URL.');
  }

  if (parsedUrl.searchParams.get('sslmode') !== 'require') {
    issues.push('Supabase PostgreSQL connections must set sslmode=require.');
  }

  return issues;
}

export function assertSupabaseDatabaseUrl(databaseUrl: string): void {
  const issues = getSupabaseDatabaseUrlIssues(databaseUrl);
  if (issues.length > 0) {
    throw new Error(issues.join(' '));
  }
}

export const apiEnvSchema = z
  .object({
    NODE_ENV: nodeEnvSchema.default('development'),
    APP_ENV: appEnvSchema.default('local'),
    API_PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL URL'),
    REDIS_URL: z.string().optional(),
    QUEUE_MODE: queueModeSchema.default('inline'),
    JOB_WORKER_ENABLED: z
      .string()
      .optional()
      .transform((value) => value === 'true' || value === '1'),
    AUTH_MODE: authModeSchema.default('dev'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  DEV_CLINIC_ID: z.string().uuid().optional(),
  DEV_USER_ID: z.string().uuid().optional(),
  DEV_USER_ROLE: z.enum(['clinic_admin', 'doctor', 'platform_admin']).optional(),
  DEV_DOCTOR_ID: z.string().uuid().optional(),
  API_BASE_URL: z.string().url().default('http://localhost:3000'),
  PRIMARY_LLM_PROVIDER: llmProviderSchema.default('mock'),
  SERVICE_ROUTER_PROVIDER: llmProviderSchema.default('mock'),
  STATE_ENTITY_EXTRACTOR_PROVIDER: llmProviderSchema.default('mock'),
  STATE_ENTITY_EXTRACTOR_MODEL: z.string().default('sarvam-30b'),
  STATE_ENTITY_EXTRACTOR_FALLBACK_MODEL: z.string().default('sarvam-105b'),
  STATE_ENTITY_EXTRACTOR_ENABLE_FALLBACK: z.preprocess(
    (value) => (value === undefined ? true : value === 'true' || value === '1'),
    z.boolean(),
  ),
  STATE_ENTITY_EXTRACTOR_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  STATE_ENTITY_EXTRACTOR_LOG_RAW: z.preprocess(
    (value) => value === 'true' || value === '1',
    z.boolean(),
  ),
  ACTIVE_STATE_INTERPRETER_PROVIDER: z.enum(['composite', 'mock', 'sarvam']).default('composite'),
  ACTIVE_STATE_LLM_PROVIDER: llmProviderSchema.default('mock'),
  ACTIVE_STATE_LLM_MODEL: z.string().default('sarvam-30b'),
  ACTIVE_STATE_LLM_FALLBACK_MODEL: z.string().default('sarvam-105b'),
  ACTIVE_STATE_LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  ACTIVE_STATE_LLM_ENABLE_FALLBACK: z.preprocess(
    (value) => (value === undefined ? true : value === 'true' || value === '1'),
    z.boolean(),
  ),
  RECEPTIONIST_DIALOG_PLANNER_PROVIDER: llmProviderSchema.default('mock'),
  RECEPTIONIST_DIALOG_PLANNER_MODEL: z.string().default('sarvam-30b'),
  RECEPTIONIST_DIALOG_PLANNER_FALLBACK_MODEL: z.string().default('sarvam-105b'),
  RECEPTIONIST_DIALOG_PLANNER_ENABLE_FALLBACK: z.preprocess(
    (value) => (value === undefined ? true : value === 'true' || value === '1'),
    z.boolean(),
  ),
  RECEPTIONIST_DIALOG_PLANNER_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  CONVERSATION_AGENT_MODE: conversationAgentModeSchema.default('legacy'),
  RECEPTIONIST_AGENT_PROVIDER: receptionistAgentProviderSchema.default('mock'),
  RECEPTIONIST_AGENT_MODEL: z.string().default('sarvam-105b'),
  RECEPTIONIST_AGENT_FASTPATH_MODEL: z.string().default('sarvam-30b'),
  RECEPTIONIST_AGENT_FALLBACK_MODEL: z.string().default('sarvam-105b'),
  RECEPTIONIST_AGENT_ENABLE_FALLBACK: z.preprocess(
    (value) => (value === undefined ? true : value === 'true' || value === '1'),
    z.boolean(),
  ),
  RECEPTIONIST_AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  RECEPTIONIST_AGENT_TURN_BUDGET_MS: z.coerce.number().int().positive().default(15000),
  RECEPTIONIST_AGENT_MAX_TOKENS: z.coerce.number().int().positive().default(1000),
  RECEPTIONIST_AGENT_MAX_TOOL_ROUNDS: z.coerce.number().int().positive().default(4),
  OPENAI_COMPAT_BASE_URL: z.string().url().optional(),
  OPENAI_COMPAT_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  PRIMARY_LLM_MODEL: z.string().default('sarvam-30b'),
  FALLBACK_LLM_MODEL: z.string().default('sarvam-105b'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  LLM_ENABLE_FALLBACK: z.preprocess(
    (value) => (value === undefined ? true : value === 'true' || value === '1'),
    z.boolean(),
  ),
  LLM_LATENCY_MODE: z.enum(['auto', 'fast', 'standard']).default('auto'),
  LLM_FAST_CHANNELS: z.string().default('web_demo,voice_call,admin_test'),
  LLM_FAST_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  LLM_FAST_ENABLE_FALLBACK: z.preprocess(
    (value) => (value === undefined ? false : value === 'true' || value === '1'),
    z.boolean(),
  ),
  LLM_FAST_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(280),
  LLM_SERVICE_ROUTER_MEMORY_CACHE_TTL_SEC: z.coerce.number().int().nonnegative().default(3600),
  LLM_LOG_RAW: z.preprocess(
    (value) => value === 'true' || value === '1',
    z.boolean(),
  ),
  SARVAM_API_KEY: z.string().optional(),
  SARVAM_AUTH_MODE: z.enum(['subscription', 'bearer', 'api_key', 'auto']).default('auto'),
  STT_PROVIDER: providerSchema.default('mock'),
  TTS_PROVIDER: providerSchema.default('mock'),
  TELEPHONY_PROVIDER: providerSchema.default('mock'),
  MESSAGING_PROVIDER: providerSchema.default('mock'),
  OBJECT_STORAGE_PROVIDER: providerSchema.default('mock'),
  DEFAULT_RECORDING_RETENTION_DAYS: z.coerce.number().int().positive().default(10),
  DEFAULT_TRANSCRIPT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  VOICE_SILENCE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(5),
  VOICE_NO_SPEECH_RETRY_COUNT: z.coerce.number().int().nonnegative().default(2),
  VOICE_MAX_CALL_DURATION_SECONDS: z.coerce.number().int().positive().default(300),
  VOICE_STT_LOW_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.55),
  VOICE_TTS_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  DEBUG_API: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  KNOWLEDGE_SEARCH_PROVIDER: z.enum(['text', 'pgvector', 'hybrid']).default('text'),
  EMBEDDING_PROVIDER: z.enum(['mock', 'sarvam', 'gemini', 'openai', 'nvidia']).default('mock'),
  EMBEDDING_MODEL: z.string().default('mock-embedding-v1'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1024),
  KNOWLEDGE_VECTOR_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.7),
  KNOWLEDGE_VECTOR_MAX_RESULTS: z.coerce.number().int().positive().default(5),
  KNOWLEDGE_VECTOR_USE_HYBRID_FALLBACK: z.preprocess(
    (value) => (value === undefined ? true : value === 'true' || value === '1'),
    z.boolean(),
  ),
  EMBEDDING_MOCK_FAIL_KNOWLEDGE_IDS: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  NVIDIA_API_KEY: z.string().optional(),
  NVIDIA_API_BASE_URL: z.string().url().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:3001'),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(465),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (requiresSupabaseDatabase(env)) {
      for (const message of getSupabaseDatabaseUrlIssues(env.DATABASE_URL)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_URL'],
          message,
        });
      }
    }

    if (env.QUEUE_MODE === 'bullmq' && !env.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'REDIS_URL is required when QUEUE_MODE is bullmq',
      });
    }

    if (
      (env.PRIMARY_LLM_PROVIDER === 'sarvam' ||
        env.SERVICE_ROUTER_PROVIDER === 'sarvam' ||
        env.STATE_ENTITY_EXTRACTOR_PROVIDER === 'sarvam' ||
        env.ACTIVE_STATE_LLM_PROVIDER === 'sarvam' ||
        env.RECEPTIONIST_DIALOG_PLANNER_PROVIDER === 'sarvam' ||
        env.RECEPTIONIST_AGENT_PROVIDER === 'sarvam') &&
      !env.SARVAM_API_KEY
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SARVAM_API_KEY'],
        message: 'SARVAM_API_KEY is required when LLM provider is sarvam',
      });
    }

    if (env.CONVERSATION_AGENT_MODE === 'agent' && env.RECEPTIONIST_AGENT_PROVIDER === 'mock') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RECEPTIONIST_AGENT_PROVIDER'],
        message:
          'RECEPTIONIST_AGENT_PROVIDER must be sarvam, openai_compatible, or anthropic when CONVERSATION_AGENT_MODE=agent',
      });
    }

    if (env.RECEPTIONIST_AGENT_PROVIDER === 'openai_compatible') {
      if (!env.OPENAI_COMPAT_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OPENAI_COMPAT_API_KEY'],
          message:
            'OPENAI_COMPAT_API_KEY is required when RECEPTIONIST_AGENT_PROVIDER is openai_compatible',
        });
      }
      if (!env.OPENAI_COMPAT_BASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OPENAI_COMPAT_BASE_URL'],
          message:
            'OPENAI_COMPAT_BASE_URL is required when RECEPTIONIST_AGENT_PROVIDER is openai_compatible',
        });
      }
    }

    if (env.RECEPTIONIST_AGENT_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ANTHROPIC_API_KEY'],
        message: 'ANTHROPIC_API_KEY is required when RECEPTIONIST_AGENT_PROVIDER is anthropic',
      });
    }
  });

export const webEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  WEB_PORT: z.coerce.number().int().positive().default(3001),
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:3000'),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WebEnv = z.infer<typeof webEnvSchema>;

export class EnvValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: z.ZodIssue[],
  ) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}

function normalizeReceptionistAgentEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const normalized = { ...env };

  if (!normalized.RECEPTIONIST_AGENT_PROVIDER) {
    const legacy = normalized.AGENT_PLANNER_PROVIDER;
    if (legacy === 'openai_compat') {
      normalized.RECEPTIONIST_AGENT_PROVIDER = 'openai_compatible';
    } else if (legacy) {
      normalized.RECEPTIONIST_AGENT_PROVIDER = legacy;
    }
  }
  if (normalized.RECEPTIONIST_AGENT_PROVIDER === 'openai_compat') {
    normalized.RECEPTIONIST_AGENT_PROVIDER = 'openai_compatible';
  }

  const legacyPairs: Array<[string, string]> = [
    ['RECEPTIONIST_AGENT_MODEL', 'AGENT_PLANNER_MODEL'],
    ['RECEPTIONIST_AGENT_FASTPATH_MODEL', 'AGENT_PLANNER_FASTPATH_MODEL'],
    ['RECEPTIONIST_AGENT_FALLBACK_MODEL', 'AGENT_PLANNER_FALLBACK_MODEL'],
    ['RECEPTIONIST_AGENT_ENABLE_FALLBACK', 'AGENT_PLANNER_ENABLE_FALLBACK'],
    ['RECEPTIONIST_AGENT_TIMEOUT_MS', 'AGENT_PLANNER_TIMEOUT_MS'],
    ['RECEPTIONIST_AGENT_MAX_TOOL_ROUNDS', 'AGENT_PLANNER_MAX_TOOL_ROUNDS'],
  ];
  for (const [primary, legacy] of legacyPairs) {
    if (!normalized[primary] && normalized[legacy]) {
      normalized[primary] = normalized[legacy];
    }
  }

  return normalized;
}

export function parseApiEnv(
  env: Record<string, string | undefined> = process.env,
): ApiEnv {
  const result = apiEnvSchema.safeParse(normalizeReceptionistAgentEnv(env));
  if (!result.success) {
    throw new EnvValidationError(
      `Invalid API environment: ${formatZodIssues(result.error.issues)}`,
      result.error.issues,
    );
  }
  return result.data;
}

export function parseWebEnv(
  env: Record<string, string | undefined> = process.env,
): WebEnv {
  const result = webEnvSchema.safeParse(env);
  if (!result.success) {
    throw new EnvValidationError(
      `Invalid Web environment: ${formatZodIssues(result.error.issues)}`,
      result.error.issues,
    );
  }
  return result.data;
}
