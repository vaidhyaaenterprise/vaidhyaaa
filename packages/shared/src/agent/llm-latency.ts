import type { ConversationChannel } from '../enums/conversation';

export type LlmLatencyProfile = 'fast' | 'standard';

export type LlmRuntimeSettings = {
  profile: LlmLatencyProfile;
  timeoutMs: number;
  enableFallback: boolean;
  skipJsonRepair: boolean;
  skipActiveFlowClassifier: boolean;
  disableTimeoutRetry: boolean;
  maxOutputTokens: number;
  reasoningEffort?: 'low' | 'medium' | 'high' | null;
};

export type LlmLatencyEnv = {
  LLM_LATENCY_MODE?: 'auto' | 'fast' | 'standard';
  LLM_FAST_CHANNELS?: string;
  LLM_TIMEOUT_MS?: number;
  LLM_ENABLE_FALLBACK?: boolean;
  LLM_FAST_TIMEOUT_MS?: number;
  LLM_FAST_ENABLE_FALLBACK?: boolean;
  LLM_FAST_MAX_OUTPUT_TOKENS?: number;
};

const DEFAULT_FAST_CHANNELS: ConversationChannel[] = ['web_demo', 'voice_call', 'admin_test'];

export function parseFastChannels(raw: string | undefined): ConversationChannel[] {
  if (!raw?.trim()) {
    return DEFAULT_FAST_CHANNELS;
  }
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean) as ConversationChannel[];
}

export function resolveLlmLatencyProfile(
  channel: string,
  env: LlmLatencyEnv,
): LlmLatencyProfile {
  if (env.LLM_LATENCY_MODE === 'fast') {
    return 'fast';
  }
  if (env.LLM_LATENCY_MODE === 'standard') {
    return 'standard';
  }
  return parseFastChannels(env.LLM_FAST_CHANNELS).includes(channel as ConversationChannel)
    ? 'fast'
    : 'standard';
}

export function resolveLlmRuntimeSettings(
  channel: string,
  env: LlmLatencyEnv,
): LlmRuntimeSettings {
  const profile = resolveLlmLatencyProfile(channel, env);
  if (profile === 'fast') {
    return {
      profile: 'fast',
      timeoutMs: env.LLM_FAST_TIMEOUT_MS ?? 5000,
      enableFallback: env.LLM_FAST_ENABLE_FALLBACK ?? false,
      skipJsonRepair: true,
      skipActiveFlowClassifier: true,
      disableTimeoutRetry: true,
      maxOutputTokens: env.LLM_FAST_MAX_OUTPUT_TOKENS ?? 280,
      reasoningEffort: null,
    };
  }

  return {
    profile: 'standard',
    timeoutMs: env.LLM_TIMEOUT_MS ?? 20000,
    enableFallback: env.LLM_ENABLE_FALLBACK ?? true,
    skipJsonRepair: false,
    skipActiveFlowClassifier: false,
    disableTimeoutRetry: false,
    maxOutputTokens: 1024,
  };
}

export function llmRuntimeToClientOptions(
  runtime: LlmRuntimeSettings,
): Pick<
  LlmRuntimeSettings,
  'timeoutMs' | 'enableFallback' | 'disableTimeoutRetry' | 'maxOutputTokens' | 'reasoningEffort'
> {
  return {
    timeoutMs: runtime.timeoutMs,
    enableFallback: runtime.enableFallback,
    disableTimeoutRetry: runtime.disableTimeoutRetry,
    maxOutputTokens: runtime.maxOutputTokens,
    ...(runtime.reasoningEffort !== undefined
      ? { reasoningEffort: runtime.reasoningEffort }
      : {}),
  };
}

export function maxTokensForRequest(
  runtime: LlmRuntimeSettings | undefined,
  fallback = 280,
): number {
  return runtime?.maxOutputTokens ?? fallback;
}
