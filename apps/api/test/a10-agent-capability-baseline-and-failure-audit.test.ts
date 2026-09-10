import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { apiSuccessBodySchema, buildAgentTrace, sanitizeAuditMessagePreview } from '@vaidya/shared';

import {
  AgentCapabilityEvaluationRunner,
  countCasesByCategory,
} from '../src/agent/evaluation/agent-capability-evaluation-runner';
import { RECEPTIONIST_CAPABILITY_GOLDEN_CASES } from '../src/agent/evaluation/receptionist-capability-golden';
import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { SEED } from './test-constants';

async function createConversation(app: NestFastifyApplication, phone: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/conversations',
    payload: {
      clinic_id: SEED.CLINIC_ID,
      channel: 'web_demo',
      patient_phone: phone,
    },
  });
  expect(response.statusCode).toBe(201);
  const body = apiSuccessBodySchema.parse(response.json());
  return (body.data as { session: { id: string } }).session.id;
}

describe('A10 agent capability baseline and failure audit', () => {
  describe('evaluation commands', () => {
    it('1-2. agent:evaluate:mock prints category-wise pass/fail summary', () => {
      const apiRoot = path.resolve(__dirname, '..');
      const output = execFileSync('pnpm', ['exec', 'tsx', 'src/agent/evaluate-mock.ts'], {
        cwd: apiRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL:
            process.env.TEST_DATABASE_URL ??
            'postgresql://postgres:postgres@localhost:5433/vaidya_test',
          JWT_SECRET: 'test-secret',
        },
      });

      expect(output).toContain('Agent Capability Evaluation (mock)');
      expect(output).toContain('Total cases:');
      expect(output).toContain('Category pass rates:');
      expect(output).toContain('booking:');
    });

    it('3. booking category contains at least 20 examples', () => {
      const counts = countCasesByCategory(RECEPTIONIST_CAPABILITY_GOLDEN_CASES);
      expect(counts.booking).toBeGreaterThanOrEqual(20);
    });

    it('4. active-state short replies include vendam/seri/inaiku/nalaki/6:30/name variants', () => {
      const cases = RECEPTIONIST_CAPABILITY_GOLDEN_CASES.filter(
        (testCase) => testCase.category === 'active_state_short_replies',
      );
      const messages = cases.map((testCase) => testCase.messageText?.toLowerCase() ?? '');
      expect(messages.some((message) => message.includes('vendam'))).toBe(true);
      expect(messages.some((message) => message.includes('seri'))).toBe(true);
      expect(messages.some((message) => message.includes('inaiku'))).toBe(true);
      expect(messages.some((message) => message.includes('nalaki'))).toBe(true);
      expect(messages.some((message) => message.includes('6:30'))).toBe(true);
      expect(messages.some((message) => message.includes('kumar'))).toBe(true);
      expect(cases.length).toBeGreaterThanOrEqual(20);
    });

    it('10. sample evaluation runs without real LLM', async () => {
      const runner = new AgentCapabilityEvaluationRunner();
      const summary = await runner.runMockEvaluation({ sample: true, maxPerCategory: 2 });
      expect(summary.skipped).toBe(false);
      expect(summary.totalCases).toBeGreaterThan(0);
      expect(summary.passPercentage).toBeGreaterThan(0);
    });
  });

  describe('integration audit and trace', () => {
    let app: NestFastifyApplication;
    let sql: postgres.Sql;

    beforeAll(async () => {
      process.env.DATABASE_URL =
        process.env.TEST_DATABASE_URL ??
        'postgresql://postgres:postgres@localhost:5433/vaidya_test';
      process.env.QUEUE_MODE = 'inline';
      process.env.NODE_ENV = 'test';
      process.env.DEBUG_API = 'true';
      process.env.ACTIVE_STATE_INTERPRETER_PROVIDER = 'mock';
      process.env.ACTIVE_STATE_LLM_PROVIDER = 'mock';
      delete process.env.REDIS_URL;

      await prepareTestDatabase();
      app = await createTestApp();
      sql = postgres(process.env.DATABASE_URL, { max: 5 });
    });

    afterAll(async () => {
      await app.close();
      await sql.end({ timeout: 5 });
    });

    it('5. unknown message stores reviewable audit event', async () => {
      process.env.DEBUG_API = 'false';
      const sessionId = await createConversation(app, '+919222331005');
      await app.inject({
        method: 'POST',
        url: `/v1/conversations/${sessionId}/messages`,
        payload: {
          message_text: 'Random gibberish xyzabc',
          idempotency_key: 'a10_unknown_audit',
        },
      });

      const rows = await sql`
        SELECT event_type, event_data_json
        FROM audit_logs
        WHERE clinic_id = ${SEED.CLINIC_ID}
          AND event_type = 'agent_nlu_classifier_failure'
          AND event_data_json->>'reason' = 'unknown_intent'
        ORDER BY created_at DESC
        LIMIT 1
      `;
      expect(rows.length).toBeGreaterThan(0);
      expect((rows[0]?.event_data_json as { reason?: string }).reason).toBe('unknown_intent');
    });

    it('6. low-confidence classifier output stores reviewable audit event', async () => {
      const sessionId = await createConversation(app, '+919222331006');
      await app.inject({
        method: 'POST',
        url: `/v1/conversations/${sessionId}/messages`,
        payload: {
          message_text: '???',
          idempotency_key: 'a10_low_conf_audit',
        },
      });

      const rows = await sql`
        SELECT event_type, event_data_json
        FROM audit_logs
        WHERE clinic_id = ${SEED.CLINIC_ID}
          AND event_type = 'agent_nlu_classifier_failure'
          AND event_data_json->>'reason' = 'low_confidence'
        ORDER BY created_at DESC
        LIMIT 1
      `;
      expect(rows.length).toBeGreaterThan(0);
    });

    it('7. DEBUG_API=true includes standardized trace fields', async () => {
      process.env.DEBUG_API = 'true';
      const sessionId = await createConversation(app, '+919222331007');
      const response = await app.inject({
        method: 'POST',
        url: `/v1/conversations/${sessionId}/messages?debug=true`,
        payload: {
          message_text: 'Fever appointment venum',
          idempotency_key: 'a10_trace_on',
        },
      });

      const body = apiSuccessBodySchema.parse(response.json());
      const assistant = (body.data as { assistant_message: { debug_json?: Record<string, unknown> } })
        .assistant_message;
      const trace = assistant.debug_json?.trace as Record<string, unknown> | undefined;
      expect(trace?.sessionId).toBe(sessionId);
      expect(trace?.clinicId).toBe(SEED.CLINIC_ID);
      expect(trace?.globalIntent).toBeTruthy();
      expect(trace?.replyTemplateKey).toBeTruthy();
      expect(typeof trace?.activeStateInterpreterCalled).toBe('boolean');
    });

    it('8. DEBUG_API=false hides trace from patient response', async () => {
      process.env.DEBUG_API = 'false';
      delete process.env.DEBUG_API;
      const debugOffApp = await createTestApp();
      const sessionId = await createConversation(debugOffApp, '+919222331008');
      const response = await debugOffApp.inject({
        method: 'POST',
        url: `/v1/conversations/${sessionId}/messages`,
        payload: {
          message_text: 'Fees evlo?',
          idempotency_key: 'a10_trace_off',
        },
      });

      const body = apiSuccessBodySchema.parse(response.json());
      const assistant = (body.data as { assistant_message: { debug_json?: unknown } }).assistant_message;
      expect(assistant.debug_json).toBeUndefined();
      await debugOffApp.close();
    });

    it('9. no API key appears in audit/log payloads', () => {
      const preview = sanitizeAuditMessagePreview('My key is sk-test1234567890 and phone +919876543210');
      expect(preview).not.toContain('sk-test1234567890');
      expect(preview).toContain('[phone-redacted]');

      const trace = buildAgentTrace({
        messageId: '00000000-0000-0000-0000-000000000001',
        sessionId: '00000000-0000-0000-0000-000000000002',
        clinicId: SEED.CLINIC_ID,
        flowBefore: 'none',
        stateBefore: 'IDLE',
        flowAfter: 'booking',
        stateAfter: 'ASK_DATE',
        intent: 'book_appointment',
        templateKey: 'booking.ask_date',
        debug: { classification: { confidence: 0.92 } },
      });
      expect(JSON.stringify(trace)).not.toMatch(/sk-[a-z0-9]+/i);
    });
  });
});
