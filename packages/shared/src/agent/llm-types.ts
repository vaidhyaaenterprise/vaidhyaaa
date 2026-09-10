import type { LlmToolChoice, LlmToolDefinition } from './llm-tool-types';
import type { LlmToolCall } from './llm-tool-types';

export type LlmStreamDelta = {
  content?: string;
  toolCalls?: LlmToolCall[];
  finishReason?: string | null;
};

export type LlmStreamHandlers = {
  onDelta?: (delta: LlmStreamDelta) => void;
  onFirstToken?: (elapsedMs: number) => void;
};

export type LlmChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type LlmChatRequest = {
  model: string;
  messages: LlmChatMessage[];
  temperature?: number;
  responseFormat?: 'json_object';
  maxTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high' | null;
  tools?: LlmToolDefinition[];
  toolChoice?: LlmToolChoice;
};

export type LlmChatResponse = {
  model: string;
  content: string;
  toolCalls?: LlmToolCall[];
  finishReason?: string | null;
  raw?: unknown;
};

export type LlmClientOptions = {
  timeoutMs: number;
  enableFallback: boolean;
  primaryModel: string;
  fallbackModel: string;
  logRaw: boolean;
  confidenceThreshold?: number;
  disableTimeoutRetry?: boolean;
};

export type LlmRequestRuntimeOptions = Partial<
  Pick<
    LlmClientOptions,
    'timeoutMs' | 'enableFallback' | 'disableTimeoutRetry'
  >
> & {
  maxOutputTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high' | null;
};

export interface LlmClient {
  chat(request: LlmChatRequest, runtime?: LlmRequestRuntimeOptions): Promise<LlmChatResponse>;
  chatStream?(
    request: LlmChatRequest,
    runtime?: LlmRequestRuntimeOptions,
    handlers?: LlmStreamHandlers,
  ): Promise<LlmChatResponse>;
  chatWithFallback(
    request: LlmChatRequest,
    options?: { confidence?: number; confidenceThreshold?: number },
  ): Promise<LlmChatResponse & { usedFallback: boolean }>;
}

export type LlmEvaluationCase = {
  id: string;
  kind: 'classifier' | 'router';
  input: Record<string, unknown>;
  expectedIntent?: string;
  expectedMatched?: boolean;
  expectedServiceKey?: string;
  notes?: string;
};

export interface LlmEvaluationRunner {
  runMockEvaluation(): Promise<{ passed: number; failed: number; results: Array<Record<string, unknown>> }>;
  runRealEvaluation(): Promise<{ passed: number; failed: number; skipped: boolean; results: Array<Record<string, unknown>> }>;
}
