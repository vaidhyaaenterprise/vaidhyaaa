export type LlmInvocationDebug = {
  provider: 'mock' | 'sarvam' | 'deterministic' | 'language_pack' | 'none';
  role: 'intent_classifier' | 'state_entity_extractor';
  llm_called: boolean;
  model?: string | null;
  raw_response?: string | null;
  parsed_result?: Record<string, unknown> | null;
  latency_ms?: number | null;
  skipped_reason?: string | null;
};

export function mockLlmDebug(
  role: LlmInvocationDebug['role'],
  parsed: Record<string, unknown>,
): LlmInvocationDebug {
  return {
    provider: 'mock',
    role,
    llm_called: false,
    skipped_reason: 'mock_provider',
    parsed_result: parsed,
  };
}

export function languagePackLlmDebug(
  role: LlmInvocationDebug['role'],
  parsed: Record<string, unknown>,
  skippedReason = 'language_pack_fast_path',
): LlmInvocationDebug {
  return {
    provider: 'language_pack',
    role,
    llm_called: false,
    skipped_reason: skippedReason,
    parsed_result: parsed,
  };
}
export function deterministicLlmDebug(
  role: LlmInvocationDebug['role'],
  parsed: Record<string, unknown>,
  skippedReason = 'deterministic_active_state_match',
): LlmInvocationDebug {
  return {
    provider: 'deterministic',
    role,
    llm_called: false,
    skipped_reason: skippedReason,
    parsed_result: parsed,
  };
}

export function skippedClassifierLlmDebug(
  skippedReason: string,
): LlmInvocationDebug {
  return {
    provider: 'none',
    role: 'intent_classifier',
    llm_called: false,
    skipped_reason: skippedReason,
  };
}

export function attachIntentClassifierLlmDebug<T extends { llmDebug?: LlmInvocationDebug }>(
  result: T,
  debug: LlmInvocationDebug,
): T {
  return { ...result, llmDebug: debug };
}

export function attachStateEntityLlmDebug<T extends { llmDebug?: LlmInvocationDebug }>(
  result: T,
  debug: LlmInvocationDebug,
): T {
  return { ...result, llmDebug: debug };
}

export function buildSarvamLlmDebug(input: {
  role: LlmInvocationDebug['role'];
  model: string;
  rawResponse: string;
  latencyMs: number;
  parsed: Record<string, unknown>;
  corrected?: Record<string, unknown> | null;
}): LlmInvocationDebug {
  return {
    provider: 'sarvam',
    role: input.role,
    llm_called: true,
    model: input.model,
    raw_response: input.rawResponse,
    latency_ms: input.latencyMs,
    parsed_result: input.corrected
      ? { llm_parsed: input.parsed, corrected: input.corrected }
      : input.parsed,
  };
}

export function summarizeLlmPath(
  intentClassifier?: LlmInvocationDebug | null,
  stateEntityExtractor?: LlmInvocationDebug | null,
): string {
  const parts: string[] = [];
  if (intentClassifier) {
    parts.push(
      intentClassifier.llm_called
        ? `intent_classifier:${intentClassifier.provider}`
        : `intent_classifier:skipped(${intentClassifier.skipped_reason ?? 'unknown'})`,
    );
  }
  if (stateEntityExtractor) {
    parts.push(
      stateEntityExtractor.llm_called
        ? `state_extractor:${stateEntityExtractor.provider}`
        : `state_extractor:skipped(${stateEntityExtractor.skipped_reason ?? 'unknown'})`,
    );
  }
  return parts.length > 0 ? parts.join(' · ') : 'no_nlu';
}
