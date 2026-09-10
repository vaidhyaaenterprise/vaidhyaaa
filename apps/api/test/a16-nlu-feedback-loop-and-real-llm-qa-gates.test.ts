import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import {
  apiSuccessBodySchema,
  sanitizeAuditMessagePreview,
} from '@vaidya/shared';

import { AgentCapabilityEvaluationRunner } from '../src/agent/evaluation/agent-capability-evaluation-runner';
import { LlmEvaluationRunner } from '../src/agent/evaluation/llm-evaluation-runner';
import { runQaActivationCheck } from '../src/agent/qa-activation';

import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { devAuthHeaders, SEED } from './test-constants';

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

describe('A16 NLU feedback loop and real LLM QA gates', () => {
  describe('QA gate evaluation', () => {
    it('5. emergency evaluation must pass 100%', async () => {
      const { gateResult } = await runQaActivationCheck();
      expect(gateResult.gates.emergency_recall?.passed).toBe(true);
      expect(gateResult.gates.emergency_recall?.passRate).toBe(100);
    });

    it('6. medical advice evaluation must pass 100%', async () => {
      const { gateResult } = await runQaActivationCheck();
      expect(gateResult.gates.medical_advice_refusal?.passed).toBe(true);
      expect(gateResult.gates.medical_advice_refusal?.passRate).toBe(100);
    });

    it('7. real LLM activation command refuses to enable provider if QA gate fails', () => {
      const apiRoot = path.resolve(__dirname, '..');
      expect(() =>
        execFileSync('pnpm', ['exec', 'tsx', 'src/agent/activate-qa-llm.ts'], {
          cwd: apiRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            JWT_SECRET: 'test-secret',
            QA_GATE_FORCE_FAIL: 'true',
          },
        }),
      ).toThrow();
    });

    it('8. redaction removes raw sensitive values where configured', () => {
      const redacted = sanitizeAuditMessagePreview(
        'Call me at +919876543210 about sk-testapikey123456789 secret',
      );
      expect(redacted).not.toContain('9876543210');
      expect(redacted).not.toContain('sk-testapikey');
      expect(redacted).toContain('[phone-redacted]');
      expect(redacted).toContain('[api-key-redacted]');
    });
  });

  describe('review item integration', () => {
    let app: NestFastifyApplication;
    let sql: postgres.Sql;

    const adminHeaders = devAuthHeaders({
      userId: SEED.CLINIC_ADMIN_ID,
      clinicId: SEED.CLINIC_ID,
      role: 'clinic_admin',
    });

    beforeAll(async () => {
      process.env.DATABASE_URL =
        process.env.TEST_DATABASE_URL ??
        'postgresql://postgres:postgres@localhost:5433/vaidya_test';
      process.env.QUEUE_MODE = 'inline';
      process.env.NODE_ENV = 'test';
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

    it('1. unknown classification creates review item', async () => {
      const sessionId = await createConversation(app, '+919222226001');
      await app.inject({
        method: 'POST',
        url: `/v1/conversations/${sessionId}/messages`,
        payload: {
          message_text: 'Random gibberish xyzabc',
          idempotency_key: 'a16_unknown_review',
        },
      });

      const [row] = await sql`
        SELECT capture_reason, failure_type, review_status
        FROM nlu_review_items
        WHERE clinic_id = ${SEED.CLINIC_ID}
          AND session_id = ${sessionId}
          AND failure_type = 'classifier'
        ORDER BY created_at DESC
        LIMIT 1
      `;
      expect(['unknown_intent', 'low_confidence']).toContain(row?.capture_reason);
      expect(row?.failure_type).toBe('classifier');
      expect(row?.review_status).toBe('pending');
    });

    it('2. low-confidence state extraction creates review item', async () => {
      const sessionId = await createConversation(app, '+919222226002');
      await app.inject({
        method: 'POST',
        url: `/v1/conversations/${sessionId}/messages`,
        payload: {
          message_text: 'Fever appointment venum',
          idempotency_key: 'a16_state_1',
        },
      });
      await app.inject({
        method: 'POST',
        url: `/v1/conversations/${sessionId}/messages`,
        payload: {
          message_text: 'gibberish state xyz',
          idempotency_key: 'a16_state_2',
        },
      });

      const [row] = await sql`
        SELECT capture_reason, failure_type
        FROM nlu_review_items
        WHERE clinic_id = ${SEED.CLINIC_ID}
          AND session_id = ${sessionId}
          AND failure_type = 'interpreter'
        ORDER BY created_at DESC
        LIMIT 1
      `;
      expect(row?.failure_type).toBe('interpreter');
      expect(['low_confidence_state_extraction', 'unrecognized_active_state']).toContain(
        row?.capture_reason,
      );
    });

    it('3. review item can be marked reviewed with correct intent/entities', async () => {
      const sessionId = await createConversation(app, '+919222226003');
      await app.inject({
        method: 'POST',
        url: `/v1/conversations/${sessionId}/messages`,
        payload: {
          message_text: 'Random gibberish xyzabc',
          idempotency_key: 'a16_review_patch',
        },
      });

      const [pending] = await sql<{ id: string }[]>`
        SELECT id FROM nlu_review_items
        WHERE clinic_id = ${SEED.CLINIC_ID}
          AND session_id = ${sessionId}
        ORDER BY created_at DESC
        LIMIT 1
      `;
      expect(pending?.id).toBeTruthy();

      const response = await app.inject({
        method: 'PATCH',
        url: `/internal/nlu-review/items/${pending!.id}`,
        headers: adminHeaders,
        payload: {
          correct_intent: 'book_appointment',
          correct_entities_json: { reason_for_visit: 'fever' },
        },
      });
      expect(response.statusCode).toBe(200);
      const body = apiSuccessBodySchema.parse(response.json());
      const item = (body.data as { item: Record<string, unknown> }).item;
      expect(item.review_status).toBe('reviewed');
      expect(item.correct_intent).toBe('book_appointment');
      expect(item.correct_entities_json).toEqual({ reason_for_visit: 'fever' });
    });

    it('4. reviewed item export includes expected label', async () => {
      const sessionId = await createConversation(app, '+919222226004');
      await app.inject({
        method: 'POST',
        url: `/v1/conversations/${sessionId}/messages`,
        payload: {
          message_text: 'Random gibberish xyzabc',
          idempotency_key: 'a16_export',
        },
      });

      const [pending] = await sql<{ id: string }[]>`
        SELECT id FROM nlu_review_items
        WHERE clinic_id = ${SEED.CLINIC_ID}
          AND session_id = ${sessionId}
        ORDER BY created_at DESC
        LIMIT 1
      `;

      await app.inject({
        method: 'PATCH',
        url: `/internal/nlu-review/items/${pending!.id}`,
        headers: adminHeaders,
        payload: {
          correct_intent: 'unknown',
          correct_entities_json: {},
        },
      });

      const exportResponse = await app.inject({
        method: 'POST',
        url: '/internal/nlu-review/export',
        headers: adminHeaders,
      });
      expect(exportResponse.statusCode).toBe(201);
      const exportBody = apiSuccessBodySchema.parse(exportResponse.json());
      const cases = (exportBody.data as { cases: Array<Record<string, unknown>> }).cases;
      const exported = cases.find((testCase) => testCase.id === pending!.id);
      expect(exported?.correct_intent).toBe('unknown');
    });
  });

  describe('activation command success path', () => {
    it('passes QA gate check with current mock evaluators', async () => {
      const { gateResult } = await runQaActivationCheck();
      expect(gateResult.passed).toBe(true);
    });
  });
});
