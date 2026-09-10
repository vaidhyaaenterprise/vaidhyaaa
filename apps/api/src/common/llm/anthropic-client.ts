import { Injectable } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import {
  AppError,
  type LlmChatMessage,
  type LlmChatRequest,
  type LlmChatResponse,
  type LlmClient,
  type LlmClientOptions,
  type LlmRequestRuntimeOptions,
  type LlmToolCall,
  type LlmToolDefinition,
} from '@vaidya/shared';

export type AnthropicFetch = typeof fetch;

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

type AnthropicMessage = {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
};

export type AnthropicClientDeps = {
  apiKey: string;
  options: LlmClientOptions;
  fetchImpl?: AnthropicFetch;
};

function toAnthropicTools(tools?: LlmToolDefinition[]) {
  if (!tools?.length) {
    return undefined;
  }
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}

function toAnthropicToolChoice(toolChoice: LlmChatRequest['toolChoice']) {
  if (toolChoice === undefined || toolChoice === 'auto') {
    return { type: 'auto' as const };
  }
  if (toolChoice === 'none') {
    return undefined;
  }
  return { type: 'tool' as const, name: toolChoice.function.name };
}

function toAnthropicToolCalls(content: AnthropicContentBlock[]): LlmToolCall[] {
  const calls: LlmToolCall[] = [];
  for (const block of content) {
    if (block.type !== 'tool_use') {
      continue;
    }
    calls.push({
      id: block.id,
      type: 'function',
      function: {
        name: block.name,
        arguments: JSON.stringify(block.input ?? {}),
      },
    });
  }
  return calls;
}

function toAnthropicMessages(messages: LlmChatMessage[]): {
  system: string | undefined;
  messages: AnthropicMessage[];
} {
  const systemParts: string[] = [];
  const anthropicMessages: AnthropicMessage[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content) {
        systemParts.push(message.content);
      }
      continue;
    }

    if (message.role === 'tool') {
      const last = anthropicMessages[anthropicMessages.length - 1];
      const toolResult: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: message.tool_call_id ?? '',
        content: message.content ?? '',
      };
      if (
        last?.role === 'user' &&
        Array.isArray(last.content) &&
        last.content.some((block) => block.type === 'tool_result')
      ) {
        last.content.push(toolResult);
      } else {
        anthropicMessages.push({ role: 'user', content: [toolResult] });
      }
      continue;
    }

    if (message.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];
      if (message.content) {
        blocks.push({ type: 'text', text: message.content });
      }
      for (const toolCall of message.tool_calls ?? []) {
        let parsedInput: Record<string, unknown> = {};
        try {
          parsedInput = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        } catch {
          parsedInput = {};
        }
        blocks.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: parsedInput,
        });
      }
      anthropicMessages.push({
        role: 'assistant',
        content: blocks.length === 1 && blocks[0]?.type === 'text' ? blocks[0].text : blocks,
      });
      continue;
    }

    anthropicMessages.push({
      role: 'user',
      content: message.content ?? '',
    });
  }

  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    messages: anthropicMessages,
  };
}

@Injectable()
export class AnthropicLlmClient implements LlmClient {
  private readonly fetchImpl: AnthropicFetch;

  constructor(private readonly deps: AnthropicClientDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  static fromEnv(env: ApiEnv, fetchImpl?: AnthropicFetch): AnthropicLlmClient {
    if (!env.ANTHROPIC_API_KEY) {
      throw new AppError('INTERNAL_ERROR', 'ANTHROPIC_API_KEY is required for Anthropic LLM client.');
    }

    return new AnthropicLlmClient({
      apiKey: env.ANTHROPIC_API_KEY,
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
    const { system, messages } = toAnthropicMessages(request.messages);
    const tools = toAnthropicTools(request.tools);
    const toolChoice = toAnthropicToolChoice(request.toolChoice);

    try {
      const response = await this.fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.deps.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: request.maxTokens ?? runtime?.maxOutputTokens ?? 420,
          temperature: request.temperature ?? 0.3,
          ...(system ? { system } : {}),
          ...(tools ? { tools } : {}),
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
          messages,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new AppError('INTERNAL_ERROR', `Anthropic request failed with status ${response.status}.`);
      }

      const payload = (await response.json()) as {
        model?: string;
        content?: AnthropicContentBlock[];
        stop_reason?: string | null;
      };

      const contentBlocks = payload.content ?? [];
      const textParts = contentBlocks
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map((block) => block.text);
      const toolCalls = toAnthropicToolCalls(contentBlocks);
      const content = textParts.join('\n').trim();

      if (!content && toolCalls.length === 0) {
        throw new AppError('INTERNAL_ERROR', 'Anthropic provider returned empty assistant content.');
      }

      if (this.deps.options.logRaw) {
        console.info(
          JSON.stringify({
            provider: 'anthropic',
            model: payload.model ?? model,
            classification_ms: Date.now() - startedAt,
            tool_calls_count: toolCalls.length,
          }),
        );
      }

      return {
        model: payload.model ?? model,
        content,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(payload.stop_reason !== undefined && payload.stop_reason !== null
          ? { finishReason: payload.stop_reason }
          : {}),
        raw: payload,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppError('INTERNAL_ERROR', 'Anthropic request timed out.');
      }
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('INTERNAL_ERROR', 'Anthropic request failed.');
    } finally {
      clearTimeout(timeout);
    }
  }
}
