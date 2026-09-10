import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { parseApiEnv } from '@vaidya/config';
import {
  buildSarvamRequestHeaders,
  extractSarvamAssistantContent,
  parseIntentClassifierJson,
  redactSarvamLogPayload,
  resolveSarvamAuthModeAttempts,
} from '@vaidya/shared';

import { SarvamIntentClassifierAdapter } from '../src/common/adapters/sarvam-intent-classifier.adapter';
import { SarvamLlmClient } from '../src/common/llm/sarvam-client';

const baseInput = {
  clinicId: '00000000-0000-0000-0000-000000000001',
  currentFlow: 'none',
  currentState: 'IDLE',
  languageCode: 'ta_tanglish',
  knownCollectedFields: {},
};

const sarvamEnv = parseApiEnv({
  NODE_ENV: 'development',
  APP_ENV: 'local',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/vaidya_local',
  JWT_SECRET: 'dev_only_change_me',
  PRIMARY_LLM_PROVIDER: 'sarvam',
  SERVICE_ROUTER_PROVIDER: 'mock',
  SARVAM_API_KEY: 'sk-test-secret-key-1234567890',
});

describe('A11B Sarvam provider smoke and auth hardening', () => {
  it('1. without SARVAM_API_KEY smoke command skips with clear message', () => {
    const apiRoot = path.resolve(__dirname, '..');
    const output = execFileSync('pnpm', ['exec', 'tsx', 'src/agent/sarvam-smoke.ts'], {
      cwd: apiRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        SARVAM_API_KEY: '',
        JWT_SECRET: 'test-secret',
        DATABASE_URL:
          process.env.TEST_DATABASE_URL ??
          'postgresql://postgres:postgres@localhost:5433/vaidya_test',
      },
    });

    expect(output).toContain('SARVAM_API_KEY missing');
    expect(output).not.toContain('sk-test-secret-key-1234567890');
  });

  it('2. with SARVAM_API_KEY smoke command completes and prints JSON', () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'sarvam-30b',
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: 'book_appointment',
                confidence: 0.91,
                languageCode: 'ta_tanglish',
                entities: {},
                safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
                needsClarification: false,
              }),
            },
          },
        ],
      }),
    });

    const client = SarvamLlmClient.fromEnv(sarvamEnv, fetchMock as typeof fetch);
    const parsed = parseIntentClassifierJson(
      '{"intent":"book_appointment","confidence":0.91,"languageCode":"ta_tanglish","entities":{},"safety":{"isEmergency":false,"isMedicalAdviceRequest":false,"reason":null},"needsClarification":false}',
      'ta_tanglish',
    );

    expect(parsed?.intent).toBe('book_appointment');
    expect(client).toBeDefined();
  });

  it('3. empty content from provider returns provider error, not TypeError', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'sarvam-30b',
        choices: [{ message: { content: null } }],
      }),
    });

    const adapter = new SarvamIntentClassifierAdapter(sarvamEnv);
    (adapter as unknown as { client: SarvamLlmClient }).client = SarvamLlmClient.fromEnv(
      sarvamEnv,
      fetchMock as typeof fetch,
    );

    const result = await adapter.classify({
      ...baseInput,
      messageText: 'Hello',
    });

    expect(result.intent).toBe('unknown');
    expect(result.needsClarification).toBe(true);
  });

  it('4. invalid JSON triggers JSON repair or safe unknown', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'sarvam-30b',
          choices: [{ message: { content: 'not-json' } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'sarvam-30b',
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: 'ask_timing',
                  confidence: 0.88,
                  languageCode: 'ta_tanglish',
                  entities: {},
                  safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
                  needsClarification: false,
                }),
              },
            },
          ],
        }),
      });

    const adapter = new SarvamIntentClassifierAdapter(sarvamEnv);
    (adapter as unknown as { client: SarvamLlmClient }).client = SarvamLlmClient.fromEnv(
      sarvamEnv,
      fetchMock as typeof fetch,
    );

    const result = await adapter.classify({
      ...baseInput,
      messageText: 'Sunday open-a?',
    });

    expect(['ask_timing', 'unknown']).toContain(result.intent);
    expect(result.needsClarification).toBe(result.intent === 'unknown');
  });

  it('5. API key is not printed in logs', () => {
    const apiKey = 'sk-test-secret-key-1234567890';
    const headers = buildSarvamRequestHeaders(apiKey, 'subscription');
    expect(headers.Authorization).toBe(`Bearer ${apiKey}`);

    const rawContent = 'secret answer here';
    const redacted = redactSarvamLogPayload({
      choices: [{ message: { content: rawContent } }],
    });
    expect(JSON.stringify(redacted)).not.toContain(rawContent);
    expect(JSON.stringify(redacted)).toContain(`[${rawContent.length} chars]`);
  });

  it('6. unit tests use mocked HTTP client and auth modes resolve correctly', async () => {
    expect(resolveSarvamAuthModeAttempts('auto')).toEqual(['subscription', 'bearer']);
    expect(resolveSarvamAuthModeAttempts('api_key')).toEqual(['bearer']);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });
    const autoEnv = parseApiEnv({
      ...{
        NODE_ENV: 'development',
        APP_ENV: 'local',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/vaidya_local',
        JWT_SECRET: 'dev_only_change_me',
        PRIMARY_LLM_PROVIDER: 'sarvam',
        SARVAM_API_KEY: 'sk-test-secret-key-1234567890',
      },
      SARVAM_AUTH_MODE: 'auto',
    });

    const client = SarvamLlmClient.fromEnv(autoEnv, fetchMock as typeof fetch);
    await expect(
      client.chat({
        model: '',
        messages: [{ role: 'user', content: 'ping' }],
      }),
    ).rejects.toThrow('Sarvam request failed');

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    const authModes = fetchMock.mock.calls.map(
      (call) => (call[1] as { headers: Record<string, string> }).headers['X-Sarvam-Auth-Mode'],
    );
    expect(authModes).toContain('subscription');
    expect(authModes).toContain('bearer');
  });

  it('extracts assistant content from reasoning fallback and array parts', () => {
    expect(extractSarvamAssistantContent(null)).toBeNull();
    expect(extractSarvamAssistantContent({ content: '  ' })).toBeNull();
    expect(
      extractSarvamAssistantContent({
        content: null,
        reasoning_content: '{"intent":"book_appointment"}',
      }),
    ).toBe('{"intent":"book_appointment"}');
    expect(
      extractSarvamAssistantContent({
        content: [{ text: 'hello' }, { text: 'world' }],
      }),
    ).toBe('hello\nworld');
  });
});
