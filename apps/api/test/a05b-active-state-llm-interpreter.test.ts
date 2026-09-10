import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { EnvValidationError, parseApiEnv } from '@vaidya/config';
import { addDays, dayOfWeekMon1, formatDateInTimezone } from '@vaidya/db';
import {
  ADAPTER_TOKENS,
  apiSuccessBodySchema,
  extractStateEntitiesMock,
  LlmJsonParser,
  parseStateEntityExtractorJson,
  safeStateEntityFallback,
} from '@vaidya/shared';

import { ActiveStateInterpretationService } from '../src/modules/conversation/active-state-interpretation.service';
import { MockStateEntityExtractorAdapter } from '../src/common/adapters/mock-state-entity-extractor.adapter';
import { createStateEntityExtractorProvider } from '../src/common/adapters/llm-provider.factory';
import { slotHour } from '../src/modules/booking/booking-field-extractor';
import { SlotGenerationService } from '../src/modules/slots/slot-generation.service';
import { SlotService } from '../src/modules/slots/slot.service';
import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { SEED } from './test-constants';

const TIMEZONE = 'Asia/Kolkata';

function findBookableDate(timezone: string, minOffsetFromToday = 1): string {
  const today = formatDateInTimezone(new Date(), timezone);
  for (let offset = minOffsetFromToday; offset <= 14; offset += 1) {
    const candidate = addDays(today, offset, timezone);
    const dayOfWeek = dayOfWeekMon1(candidate, timezone);
    if (dayOfWeek >= 1 && dayOfWeek <= 6) {
      return candidate;
    }
  }
  throw new Error('No bookable weekday found in test horizon');
}

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
    assistant_message: { reply_template_key: string | null; message_text: string; debug_json?: Record<string, unknown> | null };
  };
}

describe('A05B active-state LLM interpreter', () => {
  describe('provider selection', () => {
    it('1. default provider is mock when interpreter provider is mock', () => {
      const env = parseApiEnv({
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/vaidya_test',
        JWT_SECRET: 'test-secret',
        ACTIVE_STATE_INTERPRETER_PROVIDER: 'mock',
        STATE_ENTITY_EXTRACTOR_PROVIDER: 'mock',
      });
      const provider = createStateEntityExtractorProvider();
      const adapter = provider.useFactory(env, {
        getPack: async () => ({ languageCode: 'ta_tanglish', yesWords: [], noWords: [], cancelWords: [], todayWords: [], tomorrowWords: [], timePreferenceWords: { morning: [], afternoon: [], evening: [] }, laterWords: [] }),
      } as never);
      expect(adapter).toBeInstanceOf(MockStateEntityExtractorAdapter);
    });

    it('3. invalid provider fails fast', () => {
      expect(() =>
        parseApiEnv({
          DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/vaidya_test',
          JWT_SECRET: 'test-secret',
          STATE_ENTITY_EXTRACTOR_PROVIDER: 'random',
        }),
      ).toThrow(EnvValidationError);
    });
  });

  describe('strict JSON parsing', () => {
    it('4. valid JSON accepted', () => {
      const parsed = parseStateEntityExtractorJson(
        JSON.stringify({
          recognizedAs: 'date_answer',
          confidence: 0.92,
          entities: { date: '2026-05-16' },
          needsClarification: false,
        }),
      );
      expect(parsed?.recognizedAs).toBe('date_answer');
      expect(parsed?.entities.date).toBe('2026-05-16');
    });

    it('5. code fenced JSON accepted', () => {
      const parsed = parseStateEntityExtractorJson(
        '```json\n{"recognizedAs":"yes_confirmation","confidence":0.95,"entities":{},"needsClarification":false}\n```',
      );
      expect(parsed?.recognizedAs).toBe('yes_confirmation');
    });

    it('6. invalid JSON returns safe fallback', () => {
      expect(parseStateEntityExtractorJson('not json')).toBeNull();
      const fallback = safeStateEntityFallback();
      expect(fallback.recognizedAs).toBe('unknown');
      expect(fallback.needsClarification).toBe(true);
      expect(new LlmJsonParser().parseObject('not json').ok).toBe(false);
    });
  });

  describe('mock extractor unit cases', () => {
    const base = {
      clinicId: SEED.CLINIC_ID,
      sessionId: '00000000-0000-0000-0000-000000000099',
      currentFlow: 'booking',
      languageCode: 'ta_tanglish',
      timezone: TIMEZONE,
      collected: {},
      expectedFields: ['date'],
    };

    it('7-8. ASK_DATE relative dates', () => {
      const today = formatDateInTimezone(new Date(), TIMEZONE);
      const tomorrow = addDays(today, 1, TIMEZONE);

      for (const message of ['inniku', 'today', 'inaiku iruka']) {
        const result = extractStateEntitiesMock({
          ...base,
          currentState: 'ASK_DATE',
          messageText: message,
          referenceDate: today,
        });
        expect(result.recognizedAs).toBe('date_answer');
        expect(result.entities.date).toBe(today);
      }

      for (const message of ['naalaikku', 'nalaki', 'tomorrow']) {
        const result = extractStateEntitiesMock({
          ...base,
          currentState: 'ASK_DATE',
          messageText: message,
          referenceDate: today,
        });
        expect(result.recognizedAs).toBe('date_answer');
        expect(result.entities.date).toBe(tomorrow);
      }
    });

    it('9. explicit date parsing', () => {
      for (const message of ['May 16 2026', '16 May', '2026-05-16']) {
        const result = extractStateEntitiesMock({
          ...base,
          currentState: 'ASK_DATE',
          messageText: message,
          referenceDate: '2026-05-10',
        });
        expect(result.entities.date).toBe('2026-05-16');
      }
    });

    it('11-12. ASK_TIME variants', () => {
      const timeBase = { ...base, currentState: 'ASK_TIME', referenceDate: '2026-05-16' };
      for (const message of ['morning', 'after noon', 'evening', 'eve', 'maalai']) {
        const result = extractStateEntitiesMock({ ...timeBase, messageText: message });
        expect(result.recognizedAs).toBe('time_answer');
        expect(result.entities.timePreference).toBeTruthy();
      }

      for (const message of ['6:30', '6.30', 'six thirty', '6 arai', '18:30']) {
        const result = extractStateEntitiesMock({ ...timeBase, messageText: message });
        expect(result.recognizedAs).toBe('time_answer');
        expect(result.entities.exactTime).toBeTruthy();
      }
    });

    it('13-15. PROPOSE_SLOTS selection', () => {
      const slots = [
        {
          slotId: 'slot_630',
          startTime: '2026-05-16 18:30:00',
          endTime: '2026-05-16 18:45:00',
          displayTime: '6:30 PM',
        },
        {
          slotId: 'slot_715',
          startTime: '2026-05-16 19:15:00',
          endTime: '2026-05-16 19:30:00',
          displayTime: '7:15 PM',
        },
      ];

      for (const message of ['6:30', 'first one', 'earlier slot']) {
        const result = extractStateEntitiesMock({
          ...base,
          currentState: 'PROPOSE_SLOTS',
          messageText: message,
          referenceDate: '2026-05-16',
          offeredSlots: slots,
        });
        expect(result.recognizedAs).toBe('slot_selection');
        expect(result.entities.selectedSlotId).toBe('slot_630');
      }

      const second = extractStateEntitiesMock({
        ...base,
        currentState: 'PROPOSE_SLOTS',
        messageText: 'second slot',
        referenceDate: '2026-05-16',
        offeredSlots: slots,
      });
      expect(second.entities.selectedSlotId).toBe('slot_715');

      const invalid = extractStateEntitiesMock({
        ...base,
        currentState: 'PROPOSE_SLOTS',
        messageText: '8 PM',
        referenceDate: '2026-05-16',
        offeredSlots: slots,
      });
      expect(invalid.needsClarification).toBe(true);
      expect(invalid.entities.selectedSlotId).toBeNull();
    });

    it('16-17. patient name and flow cancel', () => {
      for (const message of ['Kumar', 'Naan Meena', 'My name is Ravi']) {
        const result = extractStateEntitiesMock({
          ...base,
          currentState: 'ASK_PATIENT_NAME',
          messageText: message,
          referenceDate: '2026-05-16',
        });
        expect(result.recognizedAs).toBe('patient_name');
        expect(result.entities.patientName).toBeTruthy();
      }

      for (const message of ['vendam', 'venam', 'venda', 'no', 'later']) {
        const result = extractStateEntitiesMock({
          ...base,
          currentState: 'ASK_PATIENT_NAME',
          messageText: message,
          referenceDate: '2026-05-16',
        });
        expect(result.recognizedAs).toBe('flow_cancel');
      }
    });

    it('18-19. confirm yes/no', () => {
      for (const message of ['seri', 'ok', 'confirm', 'book pannunga', 'aama', 'Aama']) {
        const result = extractStateEntitiesMock({
          ...base,
          currentState: 'CONFIRM_DETAILS',
          messageText: message,
          referenceDate: '2026-05-16',
        });
        expect(result.recognizedAs).toBe('yes_confirmation');
      }

      for (const message of ['vendam', 'no', 'cancel', 'later']) {
        const result = extractStateEntitiesMock({
          ...base,
          currentState: 'CONFIRM_DETAILS',
          messageText: message,
          referenceDate: '2026-05-16',
        });
        expect(result.recognizedAs).toBe('flow_cancel');
      }
    });

    it('20-22. side questions', () => {
      const sideBase = { ...base, currentState: 'ASK_DATE', referenceDate: '2026-05-16' };
      const fee = extractStateEntitiesMock({
        ...sideBase,
        messageText: 'Dr Priya fees evlo?',
      });
      expect(fee.recognizedAs).toBe('side_question');
      expect(fee.entities.sideQuestionIntent).toBe('ask_fee');

      const parking = extractStateEntitiesMock({
        ...sideBase,
        messageText: 'Parking irukka?',
      });
      expect(parking.entities.sideQuestionIntent).toBe('ask_previsit_instruction');

      const timing = extractStateEntitiesMock({
        ...sideBase,
        messageText: 'Sunday open-a?',
      });
      expect(timing.entities.sideQuestionIntent).toBe('ask_timing');
    });
  });

  describe('integration', () => {
    let app: NestFastifyApplication;
    let sql: postgres.Sql;
    let bookingDate: string;

    beforeAll(async () => {
      process.env.DATABASE_URL =
        process.env.TEST_DATABASE_URL ??
        'postgresql://postgres:postgres@localhost:5433/vaidya_test';
      process.env.QUEUE_MODE = 'inline';
      process.env.DEBUG_API = 'true';
      process.env.NODE_ENV = 'test';
      process.env.STATE_ENTITY_EXTRACTOR_PROVIDER = 'mock';
      process.env.ACTIVE_STATE_INTERPRETER_PROVIDER = 'mock';
      delete process.env.REDIS_URL;

      await prepareTestDatabase();
      app = await createTestApp();
      sql = postgres(process.env.DATABASE_URL, { max: 5 });
      bookingDate = findBookableDate(TIMEZONE, 1);

      const slotGeneration = app.get(SlotGenerationService);
      await slotGeneration.generateSlots({
        clinicId: SEED.CLINIC_ID,
        doctorId: SEED.DOCTOR_KUMAR_ID,
        clinicServiceId: SEED.ORTHO_SERVICE_ID,
      });
      await sql`
        UPDATE appointment_slots
        SET capacity_total = 10
        WHERE clinic_id = ${SEED.CLINIC_ID}
      `;
    });

    afterAll(async () => {
      await app.close();
      await sql.end({ timeout: 5 });
    });

    it('7. ASK_DATE inniku advances booking via active-state extractor', async () => {
      const extractSpy = vi.spyOn(
        app.get(ADAPTER_TOKENS.StateEntityExtractorAdapter),
        'extract',
      );

      const sessionId = await createConversation(app, '+919222223001');
      const step1 = await sendMessage(app, sessionId, 'Fever appointment venum', 'a05b_7a');
      expect(step1.session.current_state).toBe('ASK_DATE');

      extractSpy.mockClear();

      const step2 = await sendMessage(app, sessionId, 'inniku', 'a05b_7b', true);
      expect(extractSpy).toHaveBeenCalled();
      expect(step2.session.current_flow).toBe('booking');
      expect(step2.session.current_state).not.toBe('ASK_DATE');
      expect(step2.assistant_message.debug_json?.interpreter).toBe('state_entity_extractor');
      expect(step2.assistant_message.debug_json?.generic_classifier_called).toBe(false);

      extractSpy.mockRestore();
    });

    it('20. fee side question during ASK_DATE resumes booking prompt', async () => {
      const sessionId = await createConversation(app, '+919222223020');
      await sendMessage(app, sessionId, 'Fever appointment venum', 'a05b_20a');
      const step2 = await sendMessage(app, sessionId, 'Dr Priya fees evlo?', 'a05b_20b');
      expect(step2.session.current_flow).toBe('booking');
      expect(step2.session.current_state).toBe('ASK_DATE');
      expect(step2.assistant_message.reply_template_key).toBe('knowledge.answer');
      expect(step2.assistant_message.message_text.toLowerCase()).toMatch(/fee|rs|₹/);
      expect(step2.assistant_message.message_text).toContain('date');
    });

    it('29. emergency overrides active booking', async () => {
      const sessionId = await createConversation(app, '+919222223029');
      await sendMessage(app, sessionId, 'Fever appointment venum', 'a05b_29a');
      const step2 = await sendMessage(app, sessionId, 'chest pain irukku', 'a05b_29b');
      expect(step2.assistant_message.reply_template_key).toBe('safety.emergency_active_flow');
      expect(step2.session.current_flow).toBe('none');
      expect(step2.session.current_state).toBe('IDLE');

      const [incident] = await sql`
        SELECT count(*)::int AS count FROM emergency_incidents
        WHERE source_session_id = ${sessionId}
      `;
      expect(incident?.count).toBeGreaterThan(0);
    });

    it('30. medical advice overrides active booking', async () => {
      const sessionId = await createConversation(app, '+919222223030');
      await sendMessage(app, sessionId, 'Fever appointment venum', 'a05b_30a');
      const step2 = await sendMessage(app, sessionId, 'fever-ku enna tablet?', 'a05b_30b');
      expect(step2.assistant_message.reply_template_key).toBe('safety.medical_advice_refusal_resume');
      expect(step2.session.current_state).toBe('ASK_DATE');
    });

    it('32. idle flow still uses generic classifier', async () => {
      const classifySpy = vi.spyOn(
        app.get(ADAPTER_TOKENS.IntentClassifierAdapter),
        'classify',
      );
      const extractSpy = vi.spyOn(
        app.get(ADAPTER_TOKENS.StateEntityExtractorAdapter),
        'extract',
      );

      const sessionId = await createConversation(app, '+919222223032');
      await sendMessage(app, sessionId, 'Vanakkam', 'a05b_32');

      expect(classifySpy).toHaveBeenCalled();
      expect(extractSpy).not.toHaveBeenCalled();

      classifySpy.mockRestore();
      extractSpy.mockRestore();
    });

    it('23-24. cancel confirm uses classifier interrupt check and state extractor', async () => {
      const phone = '+919222223023';
      const slotService = app.get(SlotService);
      const slots = await slotService.findAvailableSlots(
        SEED.CLINIC_ID,
        SEED.DOCTOR_KUMAR_ID,
        SEED.ORTHO_SERVICE_ID,
      );
      const eveningSlots = slots
        .filter((slot) => slot.start_time.startsWith(bookingDate) && slotHour(slot.start_time) >= 17)
        .sort((left, right) => left.start_time.localeCompare(right.start_time));
      expect(eveningSlots.length).toBeGreaterThan(0);
      const slotTime = eveningSlots[0]!.start_time.includes(' ')
        ? eveningSlots[0]!.start_time.split(' ')[1]!.slice(0, 5)
        : eveningSlots[0]!.start_time.slice(11, 16);

      const bookSession = await createConversation(app, phone);
      await sendMessage(
        app,
        bookSession,
        `${bookingDate} evening appointment venum`,
        'a05b_23_book_1',
      );
      await sendMessage(app, bookSession, 'Knee pain', 'a05b_23_book_2');
      const propose = await sendMessage(app, bookSession, slotTime, 'a05b_23_book_3');
      expect(propose.assistant_message.reply_template_key).toBe('booking.ask_patient_name');
      await sendMessage(app, bookSession, 'Kumar', 'a05b_23_book_4');
      await sendMessage(app, bookSession, 'Seri', 'a05b_23_book_5');

      const sessionId = await createConversation(app, phone);
      await sendMessage(app, sessionId, 'Appointment cancel pannunga', 'a05b_23_cancel_1');

      const interpretSpy = vi.spyOn(
        app.get(ActiveStateInterpretationService),
        'interpret',
      );
      const classifySpy = vi.spyOn(
        app.get(ADAPTER_TOKENS.IntentClassifierAdapter),
        'classify',
      );
      classifySpy.mockClear();

      const confirm = await sendMessage(app, sessionId, 'seri', 'a05b_23_cancel_2');
      expect(interpretSpy).toHaveBeenCalled();
      expect(confirm.assistant_message.reply_template_key).toBe('cancel.completed');

      interpretSpy.mockRestore();
      classifySpy.mockRestore();
    });
  });
});
