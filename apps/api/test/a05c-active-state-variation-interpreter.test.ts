import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { EnvValidationError, parseApiEnv } from '@vaidya/config';
import { addDays, formatDateInTimezone } from '@vaidya/db';
import {
  ADAPTER_TOKENS,
  apiSuccessBodySchema,
  extractStateEntitiesMock,
  getDefaultLanguagePack,
  parseStateEntityExtractorJson,
  resolveContextSensitiveAnswer,
  runActiveStatePreflight,
  safeStateEntityFallback,
} from '@vaidya/shared';

import { CompositeStateEntityExtractorAdapter } from '../src/common/adapters/composite-state-entity-extractor.adapter';
import { createStateEntityExtractorProvider } from '../src/common/adapters/llm-provider.factory';
import { LanguagePackService } from '../src/modules/conversation/language-pack.service';
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
  debug = false,
) {
  const response = await app.inject({
    method: 'POST',
    url: `/v1/conversations/${sessionId}/messages`,
    ...(debug ? { query: { debug: 'true' } } : {}),
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
      debug_json?: Record<string, unknown> | null;
    };
  };
}

describe('A05C active-state variation interpreter and language packs', () => {
  const base = {
    clinicId: SEED.CLINIC_ID,
    sessionId: '00000000-0000-0000-0000-000000000099',
    currentFlow: 'booking' as const,
    languageCode: 'ta_tanglish',
    timezone: TIMEZONE,
    collected: {},
    expectedFields: ['date'],
  };

  describe('provider selection', () => {
    it('22. default composite provider works without Sarvam key', () => {
      const env = parseApiEnv({
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/vaidya_test',
        JWT_SECRET: 'test-secret',
        ACTIVE_STATE_INTERPRETER_PROVIDER: 'composite',
        ACTIVE_STATE_LLM_PROVIDER: 'mock',
      });
      expect(env.ACTIVE_STATE_INTERPRETER_PROVIDER).toBe('composite');
    });

    it('23. sarvam active-state provider fails fast without key', () => {
      expect(() =>
        parseApiEnv({
          DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/vaidya_test',
          JWT_SECRET: 'test-secret',
          ACTIVE_STATE_LLM_PROVIDER: 'sarvam',
        }),
      ).toThrow(EnvValidationError);
    });
  });

  describe('fast-path language pack tests', () => {
    it('1-5. ASK_DATE spelling variations', () => {
      const today = formatDateInTimezone(new Date(), TIMEZONE);
      const tomorrow = addDays(today, 1, TIMEZONE);

      for (const message of ['inniku', 'inaiku', 'iniku']) {
        const result = runActiveStatePreflight({
          ...base,
          currentState: 'ASK_DATE',
          messageText: message,
          referenceDate: today,
        });
        expect(result?.recognizedAs).toBe('date_answer');
        expect(result?.entities.date).toBe(today);
      }

      for (const message of ['naalaikku', 'nalaki', 'nalaiku']) {
        const result = runActiveStatePreflight({
          ...base,
          currentState: 'ASK_DATE',
          messageText: message,
          referenceDate: today,
        });
        expect(result?.recognizedAs).toBe('date_answer');
        expect(result?.entities.date).toBe(tomorrow);
      }
    });

    it('6-8. ASK_TIME preference and exact time', () => {
      const morning = runActiveStatePreflight({
        ...base,
        currentState: 'ASK_TIME',
        messageText: 'morning',
        referenceDate: '2026-05-16',
        expectedFields: ['timePreference'],
      });
      expect(morning?.recognizedAs).toBe('time_answer');
      expect(morning?.entities.timePreference).toBe('morning');

      const evening = runActiveStatePreflight({
        ...base,
        currentState: 'ASK_TIME',
        messageText: 'maalai',
        referenceDate: '2026-05-16',
        expectedFields: ['timePreference'],
      });
      expect(evening?.entities.timePreference).toBe('evening');

      const exact = runActiveStatePreflight({
        ...base,
        currentState: 'ASK_TIME',
        messageText: '6:30',
        referenceDate: '2026-05-16',
        expectedFields: ['exactTime'],
      });
      expect(exact?.recognizedAs).toBe('time_answer');
      expect(exact?.entities.exactTime).toBeTruthy();
    });

    it('9-11. confirm affirmatives', () => {
      for (const message of ['seri', 'sari', 'ok']) {
        const result = runActiveStatePreflight({
          ...base,
          currentState: 'CONFIRM_DETAILS',
          messageText: message,
          referenceDate: '2026-05-16',
          expectedFields: ['yes_confirmation'],
        });
        expect(result?.recognizedAs).toBe('yes_confirmation');
      }
    });
  });

  describe('context-sensitive negative tests', () => {
    const pack = getDefaultLanguagePack('ta_tanglish');

    it('12-13. booking confirm and patient name declines', () => {
      expect(
        resolveContextSensitiveAnswer(
          {
            ...base,
            currentState: 'CONFIRM_DETAILS',
            messageText: 'vendam',
            referenceDate: '2026-05-16',
            expectedFields: ['yes_confirmation', 'no_rejection'],
          },
          pack,
        )?.recognizedAs,
      ).toBe('flow_cancel');

      expect(
        resolveContextSensitiveAnswer(
          {
            ...base,
            currentState: 'ASK_PATIENT_NAME',
            messageText: 'venam',
            referenceDate: '2026-05-16',
            expectedFields: ['patient_name'],
          },
          pack,
        )?.recognizedAs,
      ).toBe('flow_cancel');
    });

    it('14. PROPOSE_SLOTS later defers booking', () => {
      expect(
        resolveContextSensitiveAnswer(
          {
            ...base,
            currentState: 'PROPOSE_SLOTS',
            messageText: 'later',
            referenceDate: '2026-05-16',
            expectedFields: ['slot_selection'],
          },
          pack,
        )?.recognizedAs,
      ).toBe('flow_cancel');
    });

    it('15-17. cancel/reschedule/handoff declines', () => {
      expect(
        resolveContextSensitiveAnswer(
          {
            ...base,
            currentFlow: 'cancel',
            currentState: 'CONFIRM_CANCEL_REQUEST',
            messageText: 'vendam',
            referenceDate: '2026-05-16',
            expectedFields: ['yes_confirmation', 'no_rejection'],
          },
          pack,
        )?.recognizedAs,
      ).toBe('no_rejection');

      expect(
        resolveContextSensitiveAnswer(
          {
            ...base,
            currentFlow: 'reschedule',
            currentState: 'CONFIRM_RESCHEDULE_REQUEST',
            messageText: 'venda',
            referenceDate: '2026-05-16',
            expectedFields: ['yes_confirmation', 'no_rejection'],
          },
          pack,
        )?.recognizedAs,
      ).toBe('no_rejection');

      expect(
        resolveContextSensitiveAnswer(
          {
            ...base,
            currentFlow: 'handoff',
            currentState: 'ASK_REASON',
            messageText: 'no',
            referenceDate: '2026-05-16',
            expectedFields: ['reason'],
          },
          pack,
        )?.recognizedAs,
      ).toBe('flow_cancel');
    });
  });

  describe('slot-selection tests', () => {
    const offeredSlots = [
      {
        slotId: '11111111-1111-1111-1111-111111111111',
        startTime: '2026-05-16 18:30:00',
        endTime: '2026-05-16 18:45:00',
        displayTime: '6:30 PM',
      },
      {
        slotId: '22222222-2222-2222-2222-222222222222',
        startTime: '2026-05-16 19:15:00',
        endTime: '2026-05-16 19:30:00',
        displayTime: '7:15 PM',
      },
    ];

    it('18-21. offered slot selection and unavailable time clarification', () => {
      const first = runActiveStatePreflight({
        ...base,
        currentState: 'PROPOSE_SLOTS',
        messageText: 'first one',
        referenceDate: '2026-05-16',
        expectedFields: ['slot_selection'],
        offeredSlots,
      });
      expect(first?.entities.selectedSlotId).toBe(offeredSlots[0]!.slotId);

      const second = runActiveStatePreflight({
        ...base,
        currentState: 'PROPOSE_SLOTS',
        messageText: 'second one',
        referenceDate: '2026-05-16',
        expectedFields: ['slot_selection'],
        offeredSlots,
      });
      expect(second?.entities.selectedSlotId).toBe(offeredSlots[1]!.slotId);

      const earlier = runActiveStatePreflight({
        ...base,
        currentState: 'PROPOSE_SLOTS',
        messageText: 'earlier slot',
        referenceDate: '2026-05-16',
        expectedFields: ['slot_selection'],
        offeredSlots,
      });
      expect(earlier?.entities.selectedSlotId).toBe(offeredSlots[0]!.slotId);

      const unavailable = extractStateEntitiesMock({
        ...base,
        currentState: 'PROPOSE_SLOTS',
        messageText: '8:00',
        referenceDate: '2026-05-16',
        expectedFields: ['slot_selection'],
        offeredSlots,
      });
      expect(unavailable.recognizedAs).toBe('unknown');
      expect(unavailable.needsClarification).toBe(true);
      expect(unavailable.entities.selectedSlotId).toBeNull();
    });
  });

  describe('LLM provider behavior tests', () => {
    it('24. invalid JSON returns safe fallback', () => {
      expect(parseStateEntityExtractorJson('not json')).toBeNull();
      const fallback = safeStateEntityFallback();
      expect(fallback.recognizedAs).toBe('unknown');
      expect(fallback.needsClarification).toBe(true);
    });

    it('25. low-confidence mock result does not crash', () => {
      const result = extractStateEntitiesMock({
        ...base,
        currentState: 'ASK_DATE',
        messageText: '???',
        referenceDate: '2026-05-16',
      });
      expect(result.recognizedAs).toBe('unknown');
      expect(result.needsClarification).toBe(true);
    });
  });

  describe('integration', () => {
    let app: NestFastifyApplication;
    let sql: postgres.Sql;

    beforeAll(async () => {
      process.env.DATABASE_URL =
        process.env.TEST_DATABASE_URL ??
        'postgresql://postgres:postgres@localhost:5433/vaidya_test';
      process.env.QUEUE_MODE = 'inline';
      process.env.DEBUG_API = 'true';
      process.env.NODE_ENV = 'test';
      process.env.ACTIVE_STATE_INTERPRETER_PROVIDER = 'composite';
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

    it('26-27. active-state debug flags during expected answer', async () => {
      const sessionId = await createConversation(app, '+919222224026');
      await sendMessage(app, sessionId, 'Fever appointment venum', 'a05c_26a');
      const step2 = await sendMessage(app, sessionId, 'inniku', 'a05c_26b', true);
      const debug = step2.assistant_message.debug_json as Record<string, unknown>;
      expect(debug.interpreter).toBe('state_entity_extractor');
      expect(debug.generic_classifier_called).toBe(false);
      expect(step2.session.current_flow).toBe('booking');
    });

    it('28. side question preserves active booking state', async () => {
      const sessionId = await createConversation(app, '+919222224028');
      await sendMessage(app, sessionId, 'Fever appointment venum', 'a05c_28a');
      const step2 = await sendMessage(app, sessionId, 'Dr Priya fees evlo?', 'a05c_28b');
      expect(step2.session.current_flow).toBe('booking');
      expect(step2.session.current_state).toBe('ASK_DATE');
    });

    it('29. emergency overrides active booking', async () => {
      const sessionId = await createConversation(app, '+919222224029');
      await sendMessage(app, sessionId, 'Fever appointment venum', 'a05c_29a');
      const step2 = await sendMessage(app, sessionId, 'chest pain irukku', 'a05c_29b');
      expect(step2.assistant_message.reply_template_key).toBe('safety.emergency_active_flow');
      expect(step2.session.current_flow).toBe('none');

      const [incident] = await sql`
        SELECT count(*)::int AS count FROM emergency_incidents
        WHERE source_session_id = ${sessionId}
      `;
      expect(incident?.count).toBeGreaterThan(0);
    });

    it('30. medical advice refusal during booking', async () => {
      const sessionId = await createConversation(app, '+919222224030');
      await sendMessage(app, sessionId, 'Fever appointment venum', 'a05c_30a');
      const step2 = await sendMessage(app, sessionId, 'fever-ku enna tablet', 'a05c_30b');
      expect(step2.assistant_message.reply_template_key).toBe('safety.medical_advice_refusal_resume');
      expect(step2.session.current_state).toBe('ASK_DATE');
    });

    it('composite adapter uses language pack service', async () => {
      const env = parseApiEnv({
        DATABASE_URL: process.env.DATABASE_URL!,
        JWT_SECRET: 'test-secret',
        ACTIVE_STATE_INTERPRETER_PROVIDER: 'composite',
        ACTIVE_STATE_LLM_PROVIDER: 'mock',
      });
      const provider = createStateEntityExtractorProvider();
      const languagePackService = app.get(LanguagePackService);
      const adapter = provider.useFactory(env, languagePackService);
      expect(adapter).toBeInstanceOf(CompositeStateEntityExtractorAdapter);
    });
  });
});
