import { parseLlmToolCalls } from './llm-tool-types';

export type SarvamAuthMode = 'subscription' | 'bearer' | 'api_key' | 'auto';

export type SarvamMessagePayload = {
  content?: string | Array<string | { text?: string | null }> | null;
  reasoning_content?: string | null;
  reasoning?: string | null;
  tool_calls?: unknown;
};

export function normalizeSarvamAuthMode(mode: string): 'subscription' | 'bearer' {
  if (mode === 'bearer' || mode === 'api_key') {
    return 'bearer';
  }
  return 'subscription';
}

export function resolveSarvamAuthModeAttempts(mode: string): Array<'subscription' | 'bearer'> {
  if (mode === 'auto') {
    return ['subscription', 'bearer'];
  }
  return [normalizeSarvamAuthMode(mode)];
}

export function buildSarvamRequestHeaders(
  apiKey: string,
  authMode: 'subscription' | 'bearer',
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'X-Sarvam-Auth-Mode': authMode,
  };
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function extractSarvamAssistantContent(
  message: SarvamMessagePayload | null | undefined,
): string | null {
  if (!message) {
    return null;
  }

  const direct = readString(message.content);
  if (direct) {
    return direct;
  }

  if (Array.isArray(message.content)) {
    const parts = message.content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (part && typeof part === 'object' && 'text' in part) {
          return readString((part as { text?: unknown }).text);
        }
        return null;
      })
      .filter((part): part is string => Boolean(part));
    if (parts.length > 0) {
      return parts.join('\n').trim();
    }
  }

  return readString(message.reasoning_content) ?? readString(message.reasoning);
}

export function extractSarvamAssistantToolCalls(
  message: SarvamMessagePayload | null | undefined,
) {
  return parseLlmToolCalls(message?.tool_calls);
}

export function redactSarvamLogPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const clone = structuredClone(payload) as Record<string, unknown>;
  if (Array.isArray(clone.choices)) {
    clone.choices = clone.choices.map((choice) => {
      if (!choice || typeof choice !== 'object') {
        return choice;
      }
      const message = (choice as { message?: Record<string, unknown> }).message;
      if (!message) {
        return choice;
      }
      return {
        ...choice,
        message: {
          ...message,
          content: typeof message.content === 'string' ? `[${message.content.length} chars]` : message.content,
          reasoning_content:
            typeof message.reasoning_content === 'string'
              ? `[${message.reasoning_content.length} chars]`
              : message.reasoning_content,
        },
      };
    });
  }
  return clone;
}
