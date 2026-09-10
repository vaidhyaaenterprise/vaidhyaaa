import { describe, expect, it } from 'vitest';

import {
  parseFastChannels,
  resolveLlmLatencyProfile,
  resolveLlmRuntimeSettings,
} from './llm-latency';

describe('llm-latency', () => {
  it('uses fast profile for text and voice test channels in auto mode', () => {
    const env = { LLM_LATENCY_MODE: 'auto' as const };
    expect(resolveLlmLatencyProfile('web_demo', env)).toBe('fast');
    expect(resolveLlmLatencyProfile('admin_test', env)).toBe('fast');
    expect(resolveLlmLatencyProfile('voice_call', env)).toBe('fast');
    expect(resolveLlmLatencyProfile('whatsapp', env)).toBe('standard');
  });

  it('forces fast or standard profile from env mode', () => {
    expect(resolveLlmLatencyProfile('whatsapp', { LLM_LATENCY_MODE: 'fast' })).toBe('fast');
    expect(resolveLlmLatencyProfile('web_demo', { LLM_LATENCY_MODE: 'standard' })).toBe('standard');
  });

  it('returns fast runtime settings under 5 second budget', () => {
    const runtime = resolveLlmRuntimeSettings('web_demo', {
      LLM_LATENCY_MODE: 'auto',
      LLM_FAST_TIMEOUT_MS: 5000,
    });
    expect(runtime.profile).toBe('fast');
    expect(runtime.timeoutMs).toBe(5000);
    expect(runtime.enableFallback).toBe(false);
    expect(runtime.skipJsonRepair).toBe(true);
    expect(runtime.skipActiveFlowClassifier).toBe(true);
    expect(runtime.disableTimeoutRetry).toBe(true);
    expect(runtime.maxOutputTokens).toBe(280);
    expect(runtime.reasoningEffort).toBeNull();
  });

  it('parses custom fast channel list', () => {
    expect(parseFastChannels('whatsapp,web_demo')).toEqual(['whatsapp', 'web_demo']);
  });
});
