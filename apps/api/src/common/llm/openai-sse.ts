import { parseLlmToolCalls, type LlmStreamDelta } from '@vaidya/shared';

type ToolCallAccumulator = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export async function consumeOpenAiCompatibleSse(
  body: ReadableStream<Uint8Array> | null,
  handlers?: {
    onDelta?: (delta: LlmStreamDelta) => void;
    onFirstToken?: (elapsedMs: number) => void;
  },
  startedAt = Date.now(),
): Promise<{
  content: string;
  toolCalls: ToolCallAccumulator[];
  finishReason: string | null;
  model: string | null;
}> {
  if (!body) {
    return { content: '', toolCalls: [], finishReason: null, model: null };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finishReason: string | null = null;
  let model: string | null = null;
  let firstTokenLogged = false;
  const toolCalls = new Map<number, ToolCallAccumulator>();

  const emitFirstToken = () => {
    if (!firstTokenLogged) {
      firstTokenLogged = true;
      handlers?.onFirstToken?.(Date.now() - startedAt);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) {
        continue;
      }
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') {
        continue;
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (typeof parsed.model === 'string') {
        model = parsed.model;
      }

      const choices = parsed.choices;
      if (!Array.isArray(choices) || choices.length === 0) {
        continue;
      }
      const choice = choices[0] as Record<string, unknown>;
      if (typeof choice.finish_reason === 'string') {
        finishReason = choice.finish_reason;
      }

      const delta = choice.delta as Record<string, unknown> | undefined;
      if (!delta) {
        continue;
      }

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        content += delta.content;
        emitFirstToken();
        handlers?.onDelta?.({ content: delta.content });
      }

      const rawToolCalls = delta.tool_calls;
      if (Array.isArray(rawToolCalls)) {
        for (const raw of rawToolCalls) {
          if (!raw || typeof raw !== 'object') {
            continue;
          }
          const entry = raw as Record<string, unknown>;
          const index = typeof entry.index === 'number' ? entry.index : 0;
          const current = toolCalls.get(index) ?? {
            id: '',
            type: 'function' as const,
            function: { name: '', arguments: '' },
          };
          if (typeof entry.id === 'string') {
            current.id = entry.id;
          }
          const fn = entry.function;
          if (fn && typeof fn === 'object') {
            const fnRecord = fn as Record<string, unknown>;
            if (typeof fnRecord.name === 'string') {
              current.function.name = fnRecord.name;
            }
            if (typeof fnRecord.arguments === 'string') {
              current.function.arguments += fnRecord.arguments;
            }
          }
          toolCalls.set(index, current);
          emitFirstToken();
        }
      }
    }
  }

  const parsedToolCalls = parseLlmToolCalls([...toolCalls.values()]);
  if (parsedToolCalls.length > 0) {
    handlers?.onDelta?.({ toolCalls: parsedToolCalls, finishReason });
  }

  return {
    content,
    toolCalls: [...toolCalls.values()],
    finishReason,
    model,
  };
}
