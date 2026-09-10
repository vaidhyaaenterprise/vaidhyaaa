export type LlmToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export type LlmToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type LlmToolChoice =
  | 'auto'
  | 'none'
  | { type: 'function'; function: { name: string } };

export function parseLlmToolCalls(raw: unknown): LlmToolCall[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const calls: LlmToolCall[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as Record<string, unknown>;
    const fn = record.function;
    if (
      typeof record.id !== 'string' ||
      record.type !== 'function' ||
      !fn ||
      typeof fn !== 'object'
    ) {
      continue;
    }
    const fnRecord = fn as Record<string, unknown>;
    if (typeof fnRecord.name !== 'string' || typeof fnRecord.arguments !== 'string') {
      continue;
    }
    calls.push({
      id: record.id,
      type: 'function',
      function: {
        name: fnRecord.name,
        arguments: fnRecord.arguments,
      },
    });
  }
  return calls;
}

export function buildChatCompletionToolsPayload(
  tools?: LlmToolDefinition[],
  toolChoice?: LlmToolChoice,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const hasTools = Boolean(tools?.length);
  if (hasTools) {
    payload.tools = tools;
  }
  if (toolChoice !== undefined && toolChoice !== 'none' && hasTools) {
    payload.tool_choice = toolChoice;
  }
  return payload;
}

export function assertValidChatCompletionToolRequest(
  tools?: LlmToolDefinition[],
  toolChoice?: LlmToolChoice,
): void {
  const hasTools = Boolean(tools?.length);
  const hasToolChoice = toolChoice !== undefined && toolChoice !== 'none';
  if (hasToolChoice && !hasTools) {
    throw new Error('tool_choice requires a non-empty tools array');
  }
  if (hasTools) {
    for (const tool of tools!) {
      if (tool.type !== 'function') {
        throw new Error(`invalid tool schema: expected type=function, got ${tool.type}`);
      }
      if (!tool.function?.name || !tool.function.description || !tool.function.parameters) {
        throw new Error(`invalid tool schema for ${tool.function?.name ?? 'unknown'}`);
      }
    }
  }
}
