import { Injectable } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import {
  AppError,
  buildChatCompletionToolsPayload,
  extractSarvamAssistantContent,
  extractSarvamAssistantToolCalls,
  parseLlmToolCalls,
  serializeChatCompletionMessages,
  type LlmChatRequest,
  type LlmChatResponse,
  type LlmClient,
  type LlmClientOptions,
  type LlmRequestRuntimeOptions,
  type LlmStreamHandlers,
  type SarvamMessagePayload,
} from '@vaidya/shared';

import { consumeOpenAiCompatibleSse } from './openai-sse';

export type OpenAiCompatFetch = typeof fetch;

export type OpenAiCompatClientDeps = {
  apiKey: string;
  baseUrl: string;
  options: LlmClientOptions;
  fetchImpl?: OpenAiCompatFetch;
  nodeEnv?: string;
};

@Injectable()
export class OpenAiCompatLlmClient implements LlmClient {
  private readonly fetchImpl: OpenAiCompatFetch;

  constructor(private readonly deps: OpenAiCompatClientDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  static fromEnv(env: ApiEnv, fetchImpl?: OpenAiCompatFetch): OpenAiCompatLlmClient {
    if (!env.OPENAI_COMPAT_API_KEY) {
      throw new AppError('INTERNAL_ERROR', 'OPENAI_COMPAT_API_KEY is required for OpenAI-compatible LLM client.');
    }
    if (!env.OPENAI_COMPAT_BASE_URL) {
      throw new AppError('INTERNAL_ERROR', 'OPENAI_COMPAT_BASE_URL is required for OpenAI-compatible LLM client.');
    }

    return new OpenAiCompatLlmClient({
      apiKey: env.OPENAI_COMPAT_API_KEY,
      baseUrl: env.OPENAI_COMPAT_BASE_URL.replace(/\/$/, ''),
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

  async chat(request: LlmChatRequest, runtime?: LlmRequestRuntimeOptions): Promise<LlmChatResponse> {
    return this.requestModel(request.model || this.deps.options.primaryModel, request, runtime);
  }

  async chatStream(
    request: LlmChatRequest,
    runtime?: LlmRequestRuntimeOptions,
    handlers?: import('@vaidya/shared').LlmStreamHandlers,
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
    _options?: { confidence?: number; confidenceThreshold?: number },
  ): Promise<LlmChatResponse & { usedFallback: boolean }> {
    const primary = await this.chat({ ...request, model: this.deps.options.primaryModel });
    return { ...primary, usedFallback: false };
  }

  private async requestModel(
    model: string,
    request: LlmChatRequest,
    runtime?: LlmRequestRuntimeOptions,
  ): Promise<LlmChatResponse> {
    const timeoutMs = runtime?.timeoutMs ?? this.deps.options.timeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await this.fetchImpl(`${this.deps.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.deps.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: serializeChatCompletionMessages(request.messages),
          temperature: request.temperature ?? 0,
          ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
          ...(request.responseFormat ? { response_format: { type: 'json_object' } } : {}),
          ...buildChatCompletionToolsPayload(request.tools, request.toolChoice),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new AppError('INTERNAL_ERROR', `OpenAI-compatible request failed with status ${response.status}.`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{
          message?: SarvamMessagePayload;
          finish_reason?: string | null;
        }>;
        model?: string;
      };

      const choice = payload.choices?.[0];
      const message = choice?.message;
      const content = extractSarvamAssistantContent(message);
      const toolCalls = extractSarvamAssistantToolCalls(message);

      if (!content && toolCalls.length === 0) {
        throw new AppError('INTERNAL_ERROR', 'OpenAI-compatible provider returned empty assistant content.');
      }

      if (this.deps.options.logRaw) {
        console.info(
          JSON.stringify({
            provider: 'openai_compat',
            model: payload.model ?? model,
            classification_ms: Date.now() - startedAt,
            tool_calls_count: toolCalls.length,
          }),
        );
      }

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
        throw new AppError('INTERNAL_ERROR', 'OpenAI-compatible request timed out.');
      }
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('INTERNAL_ERROR', 'OpenAI-compatible request failed.');
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requestModelStream(
    model: string,
    request: LlmChatRequest,
    runtime?: LlmRequestRuntimeOptions,
    handlers?: LlmStreamHandlers,
  ): Promise<LlmChatResponse> {
    const timeoutMs = runtime?.timeoutMs ?? this.deps.options.timeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await this.fetchImpl(`${this.deps.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.deps.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: serializeChatCompletionMessages(request.messages),
          temperature: request.temperature ?? 0,
          stream: true,
          ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
          ...buildChatCompletionToolsPayload(request.tools, request.toolChoice),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new AppError(
          'INTERNAL_ERROR',
          `OpenAI-compatible stream request failed with status ${response.status}.`,
        );
      }

      const streamed = await consumeOpenAiCompatibleSse(response.body, handlers, startedAt);
      const toolCalls = parseLlmToolCalls(streamed.toolCalls);
      if (!streamed.content && toolCalls.length === 0) {
        throw new AppError('INTERNAL_ERROR', 'OpenAI-compatible stream returned empty content.');
      }

      return {
        model: streamed.model ?? model,
        content: streamed.content,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(streamed.finishReason ? { finishReason: streamed.finishReason } : {}),
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppError('INTERNAL_ERROR', 'OpenAI-compatible stream request timed out.');
      }
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('INTERNAL_ERROR', 'OpenAI-compatible stream request failed.');
    } finally {
      clearTimeout(timeout);
    }
  }
}
