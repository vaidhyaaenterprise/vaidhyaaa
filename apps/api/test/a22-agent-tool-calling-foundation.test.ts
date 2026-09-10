import { describe, expect, it, vi } from 'vitest';

import { parseApiEnv } from '@vaidya/config';
import {
  CLINIC_AGENT_TOOLS,
  CLINIC_AGENT_TOOL_NAMES,
  parseLlmToolCalls,
  serializeChatCompletionMessages,
} from '@vaidya/shared';

import { AnthropicLlmClient } from '../src/common/llm/anthropic-client';
import { createReceptionistAgentLlmClient, isAgentModeEnabled } from '../src/common/llm/receptionist-agent-llm.factory';
import { OpenAiCompatLlmClient } from '../src/common/llm/openai-compat-client';
import { SarvamLlmClient } from '../src/common/llm/sarvam-client';

describe('A22 agent tool-calling foundation', () => {
  it('defines seven clinic agent tools', () => {
    expect(CLINIC_AGENT_TOOL_NAMES).toHaveLength(7);
    expect(CLINIC_AGENT_TOOLS.map((tool) => tool.function.name)).toEqual([
      ...CLINIC_AGENT_TOOL_NAMES,
    ]);
  });

  it('parses OpenAI-style tool_calls payloads', () => {
    const parsed = parseLlmToolCalls([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'get_clinic_info', arguments: '{"info_type":"location"}' },
      },
    ]);
    expect(parsed).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'get_clinic_info', arguments: '{"info_type":"location"}' },
      },
    ]);
  });

  it('serializes tool result messages for multi-turn tool loops', () => {
    const serialized = serializeChatCompletionMessages([
      { role: 'assistant', content: null, tool_calls: parseLlmToolCalls([
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'get_clinic_info', arguments: '{}' },
        },
      ]) },
      { role: 'tool', content: '{"address":"Chennai"}', tool_call_id: 'call_1', name: 'get_clinic_info' },
    ]);
    expect(serialized[0]?.tool_calls).toHaveLength(1);
    expect(serialized[1]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_1',
      name: 'get_clinic_info',
    });
  });

  it('Sarvam client sends tools in chat completion request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'sarvam-30b',
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_abc',
                  type: 'function',
                  function: {
                    name: 'check_slot_availability',
                    arguments: '{"preferred_date":"2026-07-10"}',
                  },
                },
              ],
            },
          },
        ],
      }),
    });

    const env = parseApiEnv({
      NODE_ENV: 'test',
      APP_ENV: 'local',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/vaidya_test',
      JWT_SECRET: 'test-secret',
      SARVAM_API_KEY: 'sk-test',
      RECEPTIONIST_AGENT_PROVIDER: 'sarvam',
    });

    const client = SarvamLlmClient.fromEnvForReceptionistAgent(env, fetchMock as typeof fetch);
    const response = await client.chat({
      model: 'sarvam-30b',
      messages: [{ role: 'user', content: 'Tomorrow evening slot irukka?' }],
      tools: CLINIC_AGENT_TOOLS,
      toolChoice: 'auto',
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.tools).toHaveLength(7);
    expect(body.tool_choice).toBe('auto');
    expect(response.toolCalls?.[0]?.function.name).toBe('check_slot_availability');
    expect(response.finishReason).toBe('tool_calls');
  });

  it('OpenAI-compatible client uses configured base URL and bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'gpt-4.1-mini',
        choices: [
          {
            finish_reason: 'stop',
            message: { content: 'Seri, clinic location solluren.' },
          },
        ],
      }),
    });

    const env = parseApiEnv({
      NODE_ENV: 'test',
      APP_ENV: 'local',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/vaidya_test',
      JWT_SECRET: 'test-secret',
      RECEPTIONIST_AGENT_PROVIDER: 'openai_compatible',
      OPENAI_COMPAT_BASE_URL: 'https://api.openai.com',
      OPENAI_COMPAT_API_KEY: 'sk-openai-test',
      RECEPTIONIST_AGENT_MODEL: 'gpt-4.1-mini',
    });

    const client = OpenAiCompatLlmClient.fromEnv(env, fetchMock as typeof fetch);
    const response = await client.chat({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: 'Clinic enga?' }],
      tools: CLINIC_AGENT_TOOLS,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/chat/completions');
    expect(fetchMock.mock.calls[0]?.[1]?.headers?.Authorization).toBe('Bearer sk-openai-test');
    expect(response.content).toContain('clinic location');
  });

  it('Anthropic client maps tool_use blocks to OpenAI-style tool calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_01',
            name: 'get_clinic_info',
            input: { info_type: 'location' },
          },
        ],
      }),
    });

    const env = parseApiEnv({
      NODE_ENV: 'test',
      APP_ENV: 'local',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/vaidya_test',
      JWT_SECRET: 'test-secret',
      RECEPTIONIST_AGENT_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      RECEPTIONIST_AGENT_MODEL: 'claude-sonnet-4-20250514',
    });

    const client = AnthropicLlmClient.fromEnv(env, fetchMock as typeof fetch);
    const response = await client.chat({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Clinic enga?' }],
      tools: CLINIC_AGENT_TOOLS,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.anthropic.com/v1/messages');
    expect(response.toolCalls?.[0]?.function.name).toBe('get_clinic_info');
    expect(response.finishReason).toBe('tool_use');
  });

  it('agent mode env gate requires a real tool-calling provider', () => {
    const legacyEnv = parseApiEnv({
      NODE_ENV: 'test',
      APP_ENV: 'local',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/vaidya_test',
      JWT_SECRET: 'test-secret',
      CONVERSATION_AGENT_MODE: 'legacy',
    });
    expect(isAgentModeEnabled(legacyEnv)).toBe(false);

    expect(() =>
      parseApiEnv({
        NODE_ENV: 'test',
        APP_ENV: 'local',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/vaidya_test',
        JWT_SECRET: 'test-secret',
        CONVERSATION_AGENT_MODE: 'agent',
        RECEPTIONIST_AGENT_PROVIDER: 'mock',
      }),
    ).toThrow();

    const sarvamEnv = parseApiEnv({
      NODE_ENV: 'test',
      APP_ENV: 'local',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/vaidya_test',
      JWT_SECRET: 'test-secret',
      CONVERSATION_AGENT_MODE: 'agent',
      RECEPTIONIST_AGENT_PROVIDER: 'sarvam',
      SARVAM_API_KEY: 'sk-test',
    });
    expect(isAgentModeEnabled(sarvamEnv)).toBe(true);
    expect(createReceptionistAgentLlmClient(sarvamEnv, vi.fn() as typeof fetch)).toBeInstanceOf(
      SarvamLlmClient,
    );
  });

  it('accepts legacy AGENT_PLANNER_PROVIDER aliases', () => {
    const env = parseApiEnv({
      NODE_ENV: 'test',
      APP_ENV: 'local',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/vaidya_test',
      JWT_SECRET: 'test-secret',
      CONVERSATION_AGENT_MODE: 'agent',
      AGENT_PLANNER_PROVIDER: 'openai_compat',
      OPENAI_COMPAT_BASE_URL: 'https://api.openai.com',
      OPENAI_COMPAT_API_KEY: 'sk-openai-test',
    });
    expect(env.RECEPTIONIST_AGENT_PROVIDER).toBe('openai_compatible');
  });
});
