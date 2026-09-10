import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import {
  apiSuccessBodySchema,
  classifyIntentMock,
  resolveCapabilityForIntent,
} from '@vaidya/shared';

import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { SEED } from './test-constants';

const TIMEZONE = 'Asia/Kolkata';

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

async function sendMessage(
  app: NestFastifyApplication,
  sessionId: string,
  messageText: string,
  idempotencyKey: string,
) {
  const response = await app.inject({
    method: 'POST',
    url: `/v1/conversations/${sessionId}/messages`,
    payload: { message_text: messageText, idempotency_key: idempotencyKey },
  });
  expect(response.statusCode).toBe(201);
  return apiSuccessBodySchema.parse(response.json()).data as {
    session: {
      id: string;
      current_flow: string;
      current_state: string;
      collected_json: Record<string, unknown>;
      status: string;
    };
    assistant_message: {
      reply_template_key: string | null;
      message_text: string;
      debug_json?: Record<string, unknown>;
    };
  };
}

function expectCapability(messageText: string, expectedIntent: string) {
  const classification = classifyIntentMock({
    clinicId: SEED.CLINIC_ID,
    sessionId: '00000000-0000-0000-0000-000000000099',
    messageText,
    currentFlow: 'none',
    currentState: 'IDLE',
    languageCode: 'ta_tanglish',
    knownCollectedFields: {},
  });
  expect(classification.intent).toBe(expectedIntent);
  return resolveCapabilityForIntent(classification.intent);
}

describe('A13 receptionist capability registry and orchestration', () => {
  describe('capability registry unit cases', () => {
    it('1. Fees evlo? maps to ask_fee source=structured_db', () => {
      const capability = expectCapability('Fees evlo?', 'ask_fee');
      expect(capability.key).toBe('ask_fee');
      expect(capability.sourceOfTruth).toBe('structured_db');
      expect(capability.resumeActiveFlowAfterAnswer).toBe(true);
    });

    it('2. Sunday open-a? maps to ask_timing source=structured_db', () => {
      const capability = expectCapability('Sunday open-a?', 'ask_timing');
      expect(capability.key).toBe('ask_timing');
      expect(capability.sourceOfTruth).toBe('structured_db');
    });

    it('3. Parking irukka? maps to ask_previsit_instruction source=approved_knowledge', () => {
      const capability = expectCapability('Parking irukka?', 'ask_previsit_instruction');
      expect(capability.key).toBe('ask_previsit_instruction');
      expect(capability.sourceOfTruth).toBe('approved_knowledge');
    });

    it('4. Receptionist kitta pesanum maps to ask_human_agent creates callback_request', () => {
      const capability = expectCapability('Receptionist kitta pesanum', 'ask_human_agent');
      expect(capability.key).toBe('ask_human_agent');
      expect(capability.sourceOfTruth).toBe('callback');
      expect(capability.createsBackendAction).toBe('callback_request');
      expect(capability.endsActiveFlow).toBe(true);
    });

    it('5. Chest pain maps emergency creates emergency_incident', () => {
      const capability = expectCapability('Chest pain', 'emergency');
      expect(capability.key).toBe('emergency');
      expect(capability.sourceOfTruth).toBe('fixed_template');
      expect(capability.createsBackendAction).toBe('emergency_incident');
      expect(capability.endsActiveFlow).toBe(true);
    });

    it('6. Fever-ku enna tablet maps medical_advice_request fixed_template', () => {
      const capability = expectCapability('Fever-ku enna tablet', 'medical_advice_request');
      expect(capability.key).toBe('medical_advice_request');
      expect(capability.sourceOfTruth).toBe('fixed_template');
      expect(capability.templateKey).toBe('safety.medical_advice_refusal');
    });

    it('7. Cricket score maps out_of_scope fixed_template', () => {
      const capability = expectCapability('Cricket score', 'out_of_scope');
      expect(capability.key).toBe('out_of_scope');
      expect(capability.sourceOfTruth).toBe('fixed_template');
      expect(capability.templateKey).toBe('unknown.clarify');
    });
  });

  describe('orchestration integration cases', () => {
    let app: NestFastifyApplication;
    let sql: postgres.Sql;

    beforeAll(async () => {
      process.env.DATABASE_URL =
        process.env.TEST_DATABASE_URL ??
        'postgresql://postgres:postgres@localhost:5433/vaidya_test';
      process.env.QUEUE_MODE = 'inline';
      delete process.env.REDIS_URL;

      await prepareTestDatabase();
      app = await createTestApp();
      sql = postgres(process.env.DATABASE_URL, { max: 5 });
    });

    afterAll(async () => {
      await sql.end();
      await app.close();
    });

    it('8. during booking, fee capability answers and resumes', async () => {
      const sessionId = await createConversation(app, '+919222224001');
      await sendMessage(app, sessionId, 'Fever appointment venum', 'a13_8a');
      const step2 = await sendMessage(app, sessionId, 'Fees evlo?', 'a13_8b');

      expect(step2.session.current_flow).toBe('booking');
      expect(step2.session.current_state).toBe('ASK_DATE');
      expect(step2.assistant_message.message_text.toLowerCase()).toMatch(/fee|rs|₹/);
      expect(step2.assistant_message.message_text.toLowerCase()).toContain('date');
    });

    it('9. during booking, human capability ends booking and starts handoff', async () => {
      const sessionId = await createConversation(app, '+919222224002');
      await sendMessage(app, sessionId, 'Fever appointment venum', 'a13_9a');
      const step2 = await sendMessage(app, sessionId, 'Receptionist kitta pesanum', 'a13_9b');

      expect(step2.session.current_flow).toBe('handoff');
      expect(step2.assistant_message.reply_template_key).toBe('handoff.ask_reason');
    });

    it('10. during booking, emergency ends unsafe continuation', async () => {
      const sessionId = await createConversation(app, '+919222224003');
      await sendMessage(app, sessionId, 'Fever appointment venum', 'a13_10a');
      const step2 = await sendMessage(app, sessionId, 'Chest pain irukku', 'a13_10b');

      expect(step2.assistant_message.reply_template_key).toBe('safety.emergency_active_flow');
      expect(step2.session.current_flow).toBe('none');
      expect(step2.session.current_state).toBe('IDLE');

      const [incident] = await sql`
        SELECT count(*)::int AS count FROM emergency_incidents
        WHERE source_session_id = ${sessionId}
      `;
      expect(incident?.count).toBeGreaterThan(0);
    });
  });
});
