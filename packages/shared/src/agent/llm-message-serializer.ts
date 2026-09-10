import type { LlmChatMessage } from './llm-types';

export function serializeChatCompletionMessages(
  messages: LlmChatMessage[],
): Array<Record<string, unknown>> {
  return messages.map((message) => {
    const payload: Record<string, unknown> = {
      role: message.role,
      content: message.content,
    };
    if (message.tool_calls?.length) {
      payload.tool_calls = message.tool_calls;
    }
    if (message.tool_call_id) {
      payload.tool_call_id = message.tool_call_id;
    }
    if (message.name) {
      payload.name = message.name;
    }
    return payload;
  });
}
