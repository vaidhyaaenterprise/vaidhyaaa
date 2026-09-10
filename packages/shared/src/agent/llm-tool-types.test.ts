import { describe, expect, it } from 'vitest';

import {
  assertValidChatCompletionToolRequest,
  buildChatCompletionToolsPayload,
  type LlmToolDefinition,
} from './llm-tool-types';

const sampleTool: LlmToolDefinition = {
  type: 'function',
  function: {
    name: 'update_booking_state',
    description: 'Persist partial booking fields.',
    parameters: {
      type: 'object',
      properties: {
        fields: { type: 'object' },
      },
      required: ['fields'],
    },
  },
};

describe('chat completion tool payload', () => {
  it('omits tool_choice when tools[] is empty', () => {
    expect(buildChatCompletionToolsPayload(undefined, 'auto')).toEqual({});
    expect(buildChatCompletionToolsPayload([], 'auto')).toEqual({});
    expect(buildChatCompletionToolsPayload([], 'none')).toEqual({});
  });

  it('includes tool_choice only when tools[] is non-empty', () => {
    expect(buildChatCompletionToolsPayload([sampleTool], 'auto')).toEqual({
      tools: [sampleTool],
      tool_choice: 'auto',
    });
  });

  it('rejects tool_choice without tools', () => {
    expect(() => assertValidChatCompletionToolRequest([], 'auto')).toThrow(
      'tool_choice requires a non-empty tools array',
    );
    expect(() => assertValidChatCompletionToolRequest(undefined, { type: 'function', function: { name: 'x' } })).toThrow(
      'tool_choice requires a non-empty tools array',
    );
  });

  it('accepts valid OpenAI function tool schemas', () => {
    expect(() => assertValidChatCompletionToolRequest([sampleTool], 'auto')).not.toThrow();
  });
});
