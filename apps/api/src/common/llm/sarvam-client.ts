import { Injectable } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import {
  AppError,
  assertValidChatCompletionToolRequest,
  buildChatCompletionToolsPayload,
  buildSarvamRequestHeaders,
  extractSarvamAssistantContent,
  extractSarvamAssistantToolCalls,
  LlmJsonParser,
  LOW_INTENT_CONFIDENCE,
  parseLlmToolCalls,
  redactSarvamLogPayload,
  resolveSarvamAuthModeAttempts,
  serializeChatCompletionMessages,
  type LlmChatMessage,
  type LlmChatRequest,
  type LlmChatResponse,
  type LlmClient,
  type LlmClientOptions,
  type LlmRequestRuntimeOptions,
  type LlmStreamHandlers,
  type SarvamMessagePayload,
} from '@vaidya/shared';

import { consumeOpenAiCompatibleSse } from './openai-sse';

export type SarvamFetch = typeof fetch;

export type SarvamClientDeps = {
  apiKey: string;
  authMode: ApiEnv['SARVAM_AUTH_MODE'];
  options: LlmClientOptions;
  fetchImpl?: SarvamFetch;
  nodeEnv?: string;
};

const DEFAULT_CONFIDENCE_THRESHOLD = 0.55;

type RequestAttemptOptions = {
  maxTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high' | null;
  minimalPayload?: boolean;
};

@Injectable()
export class SarvamLlmClient implements LlmClient {
  private readonly parser = new LlmJsonParser();
  private readonly fetchImpl: SarvamFetch;
  private readonly confidenceThreshold: number;
  private readonly authModeAttempts: Array<'subscription' | 'bearer'>;

  constructor(private readonly deps: SarvamClientDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.confidenceThreshold = deps.options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    this.authModeAttempts = resolveSarvamAuthModeAttempts(deps.authMode);
  }

  static fromEnv(env: ApiEnv, fetchImpl?: SarvamFetch): SarvamLlmClient {
    if (!env.SARVAM_API_KEY) {
      throw new AppError('INTERNAL_ERROR', 'SARVAM_API_KEY is required for Sarvam LLM client.');
    }

    return SarvamLlmClient.create({
      apiKey: env.SARVAM_API_KEY,
      authMode: env.SARVAM_AUTH_MODE,
      nodeEnv: env.NODE_ENV,
      options: {
        timeoutMs: env.LLM_TIMEOUT_MS,
        enableFallback: env.LLM_ENABLE_FALLBACK,
        primaryModel: env.PRIMARY_LLM_MODEL,
        fallbackModel: env.FALLBACK_LLM_MODEL,
        logRaw: env.LLM_LOG_RAW,
      },
      ...(fetchImpl ? { fetchImpl } : {}),
    });
  }

  static fromEnvForStateExtractor(env: ApiEnv, fetchImpl?: SarvamFetch): SarvamLlmClient {
    if (!env.SARVAM_API_KEY) {
      throw new AppError('INTERNAL_ERROR', 'SARVAM_API_KEY is required for Sarvam LLM client.');
    }

    return SarvamLlmClient.create({
      apiKey: env.SARVAM_API_KEY,
      authMode: env.SARVAM_AUTH_MODE,
      nodeEnv: env.NODE_ENV,
      options: {
        timeoutMs: env.STATE_ENTITY_EXTRACTOR_TIMEOUT_MS,
        enableFallback: env.STATE_ENTITY_EXTRACTOR_ENABLE_FALLBACK,
        primaryModel: env.STATE_ENTITY_EXTRACTOR_MODEL,
        fallbackModel: env.STATE_ENTITY_EXTRACTOR_FALLBACK_MODEL,
        logRaw: env.STATE_ENTITY_EXTRACTOR_LOG_RAW,
      },
      ...(fetchImpl ? { fetchImpl } : {}),
    });
  }

  static fromEnvForReceptionistAgent(env: ApiEnv, fetchImpl?: SarvamFetch): SarvamLlmClient {
    if (!env.SARVAM_API_KEY) {
      throw new AppError('INTERNAL_ERROR', 'SARVAM_API_KEY is required for Sarvam LLM client.');
    }

    return SarvamLlmClient.create({
      apiKey: env.SARVAM_API_KEY,
      authMode: env.SARVAM_AUTH_MODE,
      nodeEnv: env.NODE_ENV,
      options: {
        timeoutMs: env.RECEPTIONIST_AGENT_TIMEOUT_MS,
        enableFallback: env.RECEPTIONIST_AGENT_ENABLE_FALLBACK,
        primaryModel: env.RECEPTIONIST_AGENT_MODEL,
        fallbackModel: env.RECEPTIONIST_AGENT_FALLBACK_MODEL,
        logRaw: env.LLM_LOG_RAW,
      },
      ...(fetchImpl ? { fetchImpl } : {}),
    });
  }

  /** @deprecated Use fromEnvForReceptionistAgent */
  static fromEnvForAgentPlanner(env: ApiEnv, fetchImpl?: SarvamFetch): SarvamLlmClient {
    return SarvamLlmClient.fromEnvForReceptionistAgent(env, fetchImpl);
  }

  private static create(deps: SarvamClientDeps): SarvamLlmClient {
    return new SarvamLlmClient(deps);
  }

  shouldUseFallback(confidence: number, threshold?: number, runtime?: LlmRequestRuntimeOptions): boolean {
    const effectiveThreshold = threshold ?? this.confidenceThreshold;
    const enableFallback = runtime?.enableFallback ?? this.deps.options.enableFallback;
    return enableFallback && confidence < effectiveThreshold;
  }

  async chatFallback(
    request: LlmChatRequest,
    runtime?: LlmRequestRuntimeOptions,
  ): Promise<LlmChatResponse> {
    return this.requestModel(this.deps.options.fallbackModel, request, 0, runtime);
  }

  async chat(request: LlmChatRequest, runtime?: LlmRequestRuntimeOptions): Promise<LlmChatResponse> {
    return this.requestModel(request.model || this.deps.options.primaryModel, request, 0, runtime);
  }

  async chatStream(
    request: LlmChatRequest,
    runtime?: LlmRequestRuntimeOptions,
    handlers?: LlmStreamHandlers,
  ): Promise<LlmChatResponse> {
    return this.requestModelStream(
      request.model || this.deps.options.primaryModel,
      request,
      runtime,
      handlers,
    );
  }

  async chatWithFallback(
    request: LlmChatRequest,
    options?: { confidence?: number; confidenceThreshold?: number },
  ): Promise<LlmChatResponse & { usedFallback: boolean }> {
    const primary = await this.chat({ ...request, model: this.deps.options.primaryModel });
    const threshold = options?.confidenceThreshold ?? this.confidenceThreshold;
    const confidence = options?.confidence;

    const shouldFallback =
      this.deps.options.enableFallback &&
      confidence !== undefined &&
      confidence < threshold;

    if (!shouldFallback) {
      return { ...primary, usedFallback: false };
    }

    const fallback = await this.chat({ ...request, model: this.deps.options.fallbackModel });
    return { ...fallback, usedFallback: true };
  }

  parseJsonContent<T>(content: string): T | null {
    const parsed = this.parser.parseObject<Record<string, unknown>>(content);
    return parsed.ok ? (parsed.value as T) : null;
  }

  private resolveOptions(runtime?: LlmRequestRuntimeOptions): LlmClientOptions {
    if (!runtime) {
      return this.deps.options;
    }
    return {
      ...this.deps.options,
      ...(runtime.timeoutMs !== undefined ? { timeoutMs: runtime.timeoutMs } : {}),
      ...(runtime.enableFallback !== undefined ? { enableFallback: runtime.enableFallback } : {}),
      ...(runtime.disableTimeoutRetry !== undefined
        ? { disableTimeoutRetry: runtime.disableTimeoutRetry }
        : {}),
    };
  }

  private resolveRequestOptions(
    request: LlmChatRequest,
    runtime?: LlmRequestRuntimeOptions,
    minimalPayload = false,
  ): RequestAttemptOptions {
    if (minimalPayload) {
      return {};
    }

    const resolved: RequestAttemptOptions = {};
    const maxTokens = request.maxTokens ?? runtime?.maxOutputTokens;
    if (maxTokens !== undefined) {
      resolved.maxTokens = maxTokens;
    }
    const reasoningEffort = request.reasoningEffort ?? runtime?.reasoningEffort;
    if (reasoningEffort !== undefined) {
      resolved.reasoningEffort = reasoningEffort;
    }
    return resolved;
  }

  private shouldRetryWithMinimalPayload(
    status: number,
    requestOptions: RequestAttemptOptions,
  ): boolean {
    return (
      status >= 400 &&
      status < 500 &&
      (requestOptions.maxTokens !== undefined || requestOptions.reasoningEffort !== undefined)
    );
  }

  private logProviderEvent(event: Record<string, unknown>, rawPayload?: unknown): void {
    console.info(JSON.stringify(event));
    if (this.deps.options.logRaw && rawPayload !== undefined) {
      const safePayload =
        this.deps.nodeEnv === 'production' ? redactSarvamLogPayload(rawPayload) : rawPayload;
      console.info('[llm.raw]', JSON.stringify(safePayload));
    }
  }

  private async requestModel(
    model: string,
    request: LlmChatRequest,
    attempt = 0,
    runtime?: LlmRequestRuntimeOptions,
    authModeIndex = 0,
    minimalPayload = false,
  ): Promise<LlmChatResponse> {
    const options = this.resolveOptions(runtime);
    const requestOptions = this.resolveRequestOptions(request, runtime, minimalPayload);
    const authMode = this.authModeAttempts[authModeIndex] ?? this.authModeAttempts[0] ?? 'subscription';
    assertValidChatCompletionToolRequest(request.tools, request.toolChoice);
    const toolsPayload = buildChatCompletionToolsPayload(request.tools, request.toolChoice);
    const toolsCount = Array.isArray(toolsPayload.tools) ? toolsPayload.tools.length : 0;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    const startedAt = Date.now();

    try {
      if (this.deps.options.logRaw) {
        this.logProviderEvent({
          event: 'sarvam_chat_request',
          model,
          tools_count: toolsCount,
          tool_choice: toolsPayload.tool_choice ?? null,
          has_tools: toolsCount > 0,
          message_count: request.messages.length,
        });
      }

      const response = await this.fetchImpl('https://api.sarvam.ai/v1/chat/completions', {
        method: 'POST',
        headers: buildSarvamRequestHeaders(this.deps.apiKey, authMode),
        body: JSON.stringify({
          model,
          messages: serializeChatCompletionMessages(request.messages),
          temperature: request.temperature ?? 0,
          ...(requestOptions.maxTokens !== undefined ? { max_tokens: requestOptions.maxTokens } : {}),
          ...(requestOptions.reasoningEffort !== undefined
            ? { reasoning_effort: requestOptions.reasoningEffort }
            : {}),
          response_format: request.responseFormat ? { type: 'json_object' } : undefined,
          ...toolsPayload,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        let parsedError: Record<string, unknown> | null = null;
        try {
          parsedError = JSON.parse(errorBody) as Record<string, unknown>;
        } catch {
          parsedError = null;
        }
        const errorRecord =
          parsedError?.error && typeof parsedError.error === 'object'
            ? (parsedError.error as Record<string, unknown>)
            : null;
        this.logProviderEvent({
          event: 'sarvam_chat_error',
          model,
          status: response.status,
          tools_count: toolsCount,
          tool_choice: toolsPayload.tool_choice ?? null,
          error_message: errorRecord?.message ?? errorBody.slice(0, 500),
          error_code: errorRecord?.code ?? null,
          request_id: parsedError?.request_id ?? parsedError?.requestId ?? null,
        });

        if (
          !minimalPayload &&
          this.shouldRetryWithMinimalPayload(response.status, requestOptions)
        ) {
          return this.requestModel(model, request, attempt, runtime, authModeIndex, true);
        }

        if (
          (response.status === 401 || response.status === 403) &&
          authModeIndex + 1 < this.authModeAttempts.length
        ) {
          return this.requestModel(model, request, attempt, runtime, authModeIndex + 1, minimalPayload);
        }

        if (response.status >= 500 && attempt < 1) {
          return this.requestModel(model, request, attempt + 1, runtime, authModeIndex, minimalPayload);
        }

        throw new AppError('INTERNAL_ERROR', `Sarvam request failed with status ${response.status}.`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{
          message?: SarvamMessagePayload;
          finish_reason?: string | null;
        }>;
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const choice = payload.choices?.[0];
      const message = choice?.message;
      const content = extractSarvamAssistantContent(message);
      const toolCalls = extractSarvamAssistantToolCalls(message);
      const classificationMs = Date.now() - startedAt;

      if (!content && toolCalls.length === 0) {
        throw new AppError('INTERNAL_ERROR', 'Sarvam provider returned empty assistant content.');
      }

      this.logProviderEvent(
        {
          provider: 'sarvam',
          model: payload.model ?? model,
          auth_mode: authMode,
          classification_ms: classificationMs,
          fallback_used: false,
          minimal_payload: minimalPayload,
          tool_calls_count: toolCalls.length,
          ...(payload.usage?.prompt_tokens !== undefined
            ? { input_tokens: payload.usage.prompt_tokens }
            : {}),
          ...(payload.usage?.completion_tokens !== undefined
            ? { output_tokens: payload.usage.completion_tokens }
            : {}),
        },
        payload,
      );

      return {
        model: payload.model ?? model,
        content: content ?? '',
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(choice?.finish_reason !== undefined && choice?.finish_reason !== null
          ? { finishReason: choice.finish_reason }
          : {}),
        raw: payload,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.logProviderEvent({
          provider: 'sarvam',
          model,
          auth_mode: authMode,
          classification_ms: Date.now() - startedAt,
          fallback_used: false,
          timeout: true,
          attempt,
        });
        if (attempt < 1 && !options.disableTimeoutRetry) {
          return this.requestModel(model, request, attempt + 1, runtime, authModeIndex, minimalPayload);
        }
        throw new AppError('INTERNAL_ERROR', 'Sarvam request timed out.');
      }
      if (attempt < 1 && error instanceof TypeError) {
        return this.requestModel(model, request, attempt + 1, runtime, authModeIndex, minimalPayload);
      }
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('INTERNAL_ERROR', 'Sarvam request failed.');
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requestModelStream(
    model: string,
    request: LlmChatRequest,
    runtime?: LlmRequestRuntimeOptions,
    handlers?: LlmStreamHandlers,
    authModeIndex = 0,
  ): Promise<LlmChatResponse> {
    const options = this.resolveOptions(runtime);
    const requestOptions = this.resolveRequestOptions(request, runtime, false);
    const authMode = this.authModeAttempts[authModeIndex] ?? this.authModeAttempts[0] ?? 'subscription';
    assertValidChatCompletionToolRequest(request.tools, request.toolChoice);
    const toolsPayload = buildChatCompletionToolsPayload(request.tools, request.toolChoice);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await this.fetchImpl('https://api.sarvam.ai/v1/chat/completions', {
        method: 'POST',
        headers: buildSarvamRequestHeaders(this.deps.apiKey, authMode),
        body: JSON.stringify({
          model,
          messages: serializeChatCompletionMessages(request.messages),
          temperature: request.temperature ?? 0,
          stream: true,
          ...(requestOptions.maxTokens !== undefined ? { max_tokens: requestOptions.maxTokens } : {}),
          ...(requestOptions.reasoningEffort !== undefined
            ? { reasoning_effort: requestOptions.reasoningEffort }
            : {}),
          ...toolsPayload,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        let parsedError: Record<string, unknown> | null = null;
        try {
          parsedError = JSON.parse(errorBody) as Record<string, unknown>;
        } catch {
          parsedError = null;
        }
        const errorRecord =
          parsedError?.error && typeof parsedError.error === 'object'
            ? (parsedError.error as Record<string, unknown>)
            : null;
        this.logProviderEvent({
          event: 'sarvam_chat_stream_error',
          model,
          status: response.status,
          tool_choice: toolsPayload.tool_choice ?? null,
          error_message: errorRecord?.message ?? errorBody.slice(0, 500),
          error_code: errorRecord?.code ?? null,
          request_id: parsedError?.request_id ?? parsedError?.requestId ?? null,
        });
        if (response.status === 401 && authModeIndex + 1 < this.authModeAttempts.length) {
          return this.requestModelStream(model, request, runtime, handlers, authModeIndex + 1);
        }
        throw new AppError('INTERNAL_ERROR', `Sarvam stream request failed with status ${response.status}.`);
      }

      const streamed = await consumeOpenAiCompatibleSse(response.body, handlers, startedAt);
      const toolCalls = parseLlmToolCalls(streamed.toolCalls);
      if (!streamed.content && toolCalls.length === 0) {
        throw new AppError('INTERNAL_ERROR', 'Sarvam stream returned empty assistant content.');
      }

      this.logProviderEvent({
        provider: 'sarvam',
        model: streamed.model ?? model,
        auth_mode: authMode,
        classification_ms: Date.now() - startedAt,
        streaming: true,
        tool_calls_count: toolCalls.length,
      });

      return {
        model: streamed.model ?? model,
        content: streamed.content,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(streamed.finishReason ? { finishReason: streamed.finishReason } : {}),
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppError('INTERNAL_ERROR', 'Sarvam stream request timed out.');
      }
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('INTERNAL_ERROR', 'Sarvam stream request failed.');
    } finally {
      clearTimeout(timeout);
    }
  }
}

export { unknownIntentClassifierResult as unknownClassifierResult } from '@vaidya/shared';
