import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import {
  addDays,
  combineDateAndTime,
  dayOfWeekMon1,
  formatClinicLocalTimestamp,
  formatDateInTimezone,
} from '@vaidya/db';
import { apiSuccessBodySchema } from '@vaidya/shared';

import { SlotGenerationService } from '../src/modules/slots/slot-generation.service';
import { SlotService } from '../src/modules/slots/slot.service';
import { slotHour } from '../src/modules/booking/booking-field-extractor';

import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { devAuthHeaders, SEED } from './test-constants';

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

async function seedMorningSlotForDate(sql: postgres.Sql, date: string): Promise<void> {
  const morningStart = combineDateAndTime(date, '10:00:00', TIMEZONE);
  const morningEnd = combineDateAndTime(date, '10:30:00', TIMEZONE);
  await sql`
    INSERT INTO appointment_slots (
      clinic_id, doctor_id, clinic_service_id, start_time, end_time, capacity_total, status
    )
    VALUES (
      ${SEED.CLINIC_ID},
      ${SEED.DOCTOR_KUMAR_ID},
      ${SEED.ORTHO_SERVICE_ID},
      ${formatClinicLocalTimestamp(morningStart, TIMEZONE)},
      ${formatClinicLocalTimestamp(morningEnd, TIMEZONE)},
      1,
      'open'
    )
  `;
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
    assistant_message: { reply_template_key: string | null; message_text: string };
  };
}

async function pickEveningSlotTime(app: NestFastifyApplication, bookingDate: string): Promise<string> {
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
  const timePart = eveningSlots[0]!.start_time.includes(' ')
    ? (eveningSlots[0]!.start_time.split(' ')[1] ?? eveningSlots[0]!.start_time)
    : eveningSlots[0]!.start_time;
  return timePart.slice(0, 5);
}

async function addLanguagePackWords(
  app: NestFastifyApplication,
  headers: Record<string, string>,
  languageCode: string,
  field: string,
  words: string[],
) {
  const response = await app.inject({
    method: 'PATCH',
    url: `/internal/language-variation/language-packs/${languageCode}/words`,
    headers,
    payload: { field, words },
  });
  expect(response.statusCode).toBe(200);
  const body = apiSuccessBodySchema.parse(response.json());
  return (body.data as { pack: Record<string, string[]> }).pack;
}

async function reachConfirmDoctor(
  app: NestFastifyApplication,
  phone: string,
  bookingDate: string,
  prefix: string,
) {
  const slotTime = await pickEveningSlotTime(app, bookingDate);
  const sessionId = await createConversation(app, phone);
  await sendMessage(app, sessionId, `${bookingDate} evening appointment venum`, `${prefix}a`);
  await sendMessage(app, sessionId, 'Knee pain', `${prefix}b`);
  await sendMessage(app, sessionId, slotTime, `${prefix}c`);
  const atConfirm = await sendMessage(app, sessionId, 'Kumar', `${prefix}d`);
  expect(atConfirm.session.current_state).toBe('CONFIRM_DOCTOR');
  return { sessionId, slotTime };
}

describe('A18 language variation library and review loop', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;
  let bookingDate: string;
  let platformHeaders: Record<string, string>;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5433/vaidya_test';
    process.env.QUEUE_MODE = 'inline';
    process.env.NODE_ENV = 'test';
    process.env.ACTIVE_STATE_INTERPRETER_PROVIDER = 'composite';
    process.env.ACTIVE_STATE_LLM_PROVIDER = 'mock';
    delete process.env.REDIS_URL;

    await prepareTestDatabase();
    app = await createTestApp();
    sql = postgres(process.env.DATABASE_URL, { max: 5 });
    platformHeaders = devAuthHeaders({
      userId: SEED.PLATFORM_ADMIN_ID,
      role: 'platform_admin',
    });

    const slotGeneration = app.get(SlotGenerationService);
    await slotGeneration.generateSlots({
      clinicId: SEED.CLINIC_ID,
      doctorId: SEED.DOCTOR_KUMAR_ID,
      clinicServiceId: SEED.ORTHO_SERVICE_ID,
    });

    bookingDate = findBookableDate(TIMEZONE, 1);
    await seedMorningSlotForDate(sql, bookingDate);
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
    await app.close();
  });

  it('1. vendaam in no_words cancels booking at CONFIRM_DOCTOR', async () => {
    await addLanguagePackWords(app, platformHeaders, 'ta_tanglish', 'no_words', ['vendaam']);

    const { sessionId } = await reachConfirmDoctor(app, '+919222228001', bookingDate, 'a18_1');
    const step = await sendMessage(app, sessionId, 'vendaam', 'a18_1e');

    expect(step.session.current_flow).toBe('none');
    expect(step.assistant_message.reply_template_key).toBe('booking.flow_cancelled');
  });

  it('2. saringa in yes_words confirms doctor selection', async () => {
    await addLanguagePackWords(app, platformHeaders, 'ta_tanglish', 'yes_words', ['saringa']);

    const { sessionId } = await reachConfirmDoctor(app, '+919222228002', bookingDate, 'a18_2');
    const step = await sendMessage(app, sessionId, 'saringa', 'a18_2e');

    expect(step.session.current_flow).toBe('booking');
    expect(step.session.current_state).not.toBe('CONFIRM_DOCTOR');
    expect(step.session.collected_json.doctor_id).toBeTruthy();
  });

  it('3. nalikki in tomorrow_words parses ASK_DATE as tomorrow', async () => {
    await addLanguagePackWords(app, platformHeaders, 'ta_tanglish', 'tomorrow_words', ['nalikki']);

    const tomorrow = addDays(formatDateInTimezone(new Date(), TIMEZONE), 1, TIMEZONE);
    const sessionId = await createConversation(app, '+919222228003');
    const step1 = await sendMessage(app, sessionId, 'Fever appointment venum', 'a18_3a');
    expect(step1.session.current_state).toBe('ASK_DATE');

    const step2 = await sendMessage(app, sessionId, 'nalikki', 'a18_3b');
    expect(step2.session.current_flow).toBe('booking');
    expect(step2.session.current_state).not.toBe('ASK_DATE');
    expect(step2.session.collected_json.preferred_date).toBe(tomorrow);
  });

  it('4. reviewed example export includes context_flow and context_state', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/internal/language-variation/reviewed-examples',
      headers: platformHeaders,
      payload: {
        language_code: 'ta_tanglish',
        message_text_redacted: 'vendaam',
        context_flow: 'booking',
        context_state: 'CONFIRM_DOCTOR',
        expected_recognized_as: 'flow_cancel',
        expected_entities_json: {},
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = apiSuccessBodySchema.parse(createResponse.json()).data as {
      example: { id: string };
    };

    const exportResponse = await app.inject({
      method: 'POST',
      url: '/internal/language-variation/reviewed-examples/export',
      headers: platformHeaders,
    });
    expect(exportResponse.statusCode).toBe(201);
    const exportBody = apiSuccessBodySchema.parse(exportResponse.json());
    const cases = (exportBody.data as { cases: Array<Record<string, unknown>> }).cases;
    const exported = cases.find((testCase) => testCase.id === created.example.id);

    expect(exported?.context_flow).toBe('booking');
    expect(exported?.context_state).toBe('CONFIRM_DOCTOR');
    expect(exported?.message_text_redacted).toBe('vendaam');
  });

  it('5. long arbitrary sentence is not added to language pack automatically', async () => {
    const longSentence =
      'I want to book an appointment tomorrow evening for knee pain with Dr Kumar please';

    const createResponse = await app.inject({
      method: 'POST',
      url: '/internal/language-variation/reviewed-examples',
      headers: platformHeaders,
      payload: {
        language_code: 'ta_tanglish',
        message_text_redacted: longSentence,
        context_flow: 'booking',
        context_state: 'ASK_DATE',
        expected_recognized_as: 'date_answer',
        expected_intent: 'book_appointment',
        expected_entities_json: { dateKind: 'tomorrow' },
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = apiSuccessBodySchema.parse(createResponse.json()).data as {
      example: { id: string };
    };

    const proposeResponse = await app.inject({
      method: 'POST',
      url: '/internal/language-variation/language-packs/propose-from-reviewed-examples',
      headers: platformHeaders,
    });
    expect(proposeResponse.statusCode).toBe(201);
    const proposeBody = apiSuccessBodySchema.parse(proposeResponse.json()).data as {
      dry_run: boolean;
      proposals: Array<{ source_example_id: string; word: string }>;
      rejected: Array<{ id: string; reason: string }>;
    };

    expect(proposeBody.dry_run).toBe(true);
    expect(
      proposeBody.proposals.some((proposal) => proposal.source_example_id === created.example.id),
    ).toBe(false);
    expect(
      proposeBody.rejected.some(
        (entry) => entry.id === created.example.id && entry.reason === 'ineligible_token',
      ),
    ).toBe(true);
  });

  it('6. language-pack entry changes parser behavior without BookingMachine rewrite', async () => {
    const packResponse = await app.inject({
      method: 'GET',
      url: '/internal/language-variation/language-packs/ta_tanglish',
      headers: platformHeaders,
    });
    expect(packResponse.statusCode).toBe(200);
    const pack = apiSuccessBodySchema.parse(packResponse.json()).data as {
      pack: { no_words: string[]; yes_words: string[]; tomorrow_words: string[] };
    };

    expect(pack.pack.no_words).toContain('vendaam');
    expect(pack.pack.yes_words).toContain('saringa');
    expect(pack.pack.tomorrow_words).toContain('nalikki');

    const { sessionId } = await reachConfirmDoctor(app, '+919222228006', bookingDate, 'a18_6');
    const step = await sendMessage(app, sessionId, 'vendaam', 'a18_6e');
    expect(step.session.current_state).toBe('IDLE');
    expect(step.assistant_message.reply_template_key).toBe('booking.flow_cancelled');
  });

  it('7. new language can be inserted without state-machine rewrite', async () => {
    const languageCode = 'a18_test_lang';

    const createResponse = await app.inject({
      method: 'POST',
      url: '/internal/language-variation/language-packs',
      headers: platformHeaders,
      payload: {
        language_code: languageCode,
        display_name: 'A18 Test Language',
        yes_words: ['haa'],
        no_words: ['illa'],
        tomorrow_words: ['naale'],
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = apiSuccessBodySchema.parse(createResponse.json()).data as {
      pack: { language_code: string; yes_words: string[]; no_words: string[]; tomorrow_words: string[] };
    };
    expect(created.pack.language_code).toBe(languageCode);
    expect(created.pack.yes_words).toContain('haa');

    const [languageRow] = await sql<{ language_code: string }[]>`
      SELECT language_code FROM supported_languages WHERE language_code = ${languageCode}
    `;
    expect(languageRow?.language_code).toBe(languageCode);

    const [packRow] = await sql<{ language_code: string; yes_words_json: string[] }[]>`
      SELECT language_code, yes_words_json FROM language_packs WHERE language_code = ${languageCode}
    `;
    expect(packRow?.language_code).toBe(languageCode);
    expect(packRow?.yes_words_json).toContain('haa');

    const getResponse = await app.inject({
      method: 'GET',
      url: `/internal/language-variation/language-packs/${languageCode}`,
      headers: platformHeaders,
    });
    expect(getResponse.statusCode).toBe(200);
    const fetched = apiSuccessBodySchema.parse(getResponse.json()).data as {
      pack: { tomorrow_words: string[] };
    };
    expect(fetched.pack.tomorrow_words).toContain('naale');
  });
});
