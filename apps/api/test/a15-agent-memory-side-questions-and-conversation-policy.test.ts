import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { addDays, combineDateAndTime, dayOfWeekMon1, formatClinicLocalTimestamp, formatDateInTimezone } from '@vaidya/db';
import { apiSuccessBodySchema } from '@vaidya/shared';

import { SlotGenerationService } from '../src/modules/slots/slot-generation.service';
import { SlotService } from '../src/modules/slots/slot.service';
import { slotHour } from '../src/modules/booking/booking-field-extractor';

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

function findNextBookableDate(timezone: string, afterDate: string): string {
  for (let offset = 1; offset <= 14; offset += 1) {
    const candidate = addDays(afterDate, offset, timezone);
    const dayOfWeek = dayOfWeekMon1(candidate, timezone);
    if (dayOfWeek >= 1 && dayOfWeek <= 6) {
      return candidate;
    }
  }
  throw new Error('No alternate bookable weekday found in test horizon');
}

async function seedMorningSlotForDate(
  sql: postgres.Sql,
  date: string,
): Promise<void> {
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

async function pickEveningSlotTime(
  app: NestFastifyApplication,
  bookingDate: string,
): Promise<string> {
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

describe('A15 agent memory, side questions, and conversation policy', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;
  let slotGeneration: SlotGenerationService;
  let bookingDate: string;
  let alternateDate: string;

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
    slotGeneration = app.get(SlotGenerationService);

    await slotGeneration.generateSlots({
      clinicId: SEED.CLINIC_ID,
      doctorId: SEED.DOCTOR_PRIYA_ID,
      clinicServiceId: SEED.GENERAL_SERVICE_ID,
    });
    await slotGeneration.generateSlots({
      clinicId: SEED.CLINIC_ID,
      doctorId: SEED.DOCTOR_KUMAR_ID,
      clinicServiceId: SEED.ORTHO_SERVICE_ID,
    });

    bookingDate = findBookableDate(TIMEZONE, 1);
    alternateDate = findNextBookableDate(TIMEZONE, bookingDate);
    await seedMorningSlotForDate(sql, bookingDate);
  });

  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('1. side fee question preserves collected doctor and date', async () => {
    const sessionId = await createConversation(app, '+919222225001');
    await sendMessage(app, sessionId, `${bookingDate} evening appointment venum`, 'a15_1a');
    const step2 = await sendMessage(app, sessionId, 'Knee pain', 'a15_1b');
    expect(step2.session.collected_json.doctor_id).toBeTruthy();
    expect(step2.session.collected_json.preferred_date).toBe(bookingDate);

    const before = { ...step2.session.collected_json };
    const step3 = await sendMessage(app, sessionId, 'Dr Priya fees evlo?', 'a15_1c');
    expect(step3.session.current_flow).toBe('booking');
    expect(step3.assistant_message.message_text.toLowerCase()).toMatch(/fee|rs|₹/);
    expect(step3.session.collected_json.doctor_id).toBe(before.doctor_id);
    expect(step3.session.collected_json.preferred_date).toBe(before.preferred_date);
    expect(step3.session.collected_json.active_prompt).toBeTruthy();
  });

  it('2. ASK_TIME + Sunday open-a answers timing and asks time again', async () => {
    const sessionId = await createConversation(app, '+919222225002');
    await sendMessage(app, sessionId, 'Knee pain appointment venum', 'a15_2a');
    const step2 = await sendMessage(app, sessionId, bookingDate, 'a15_2b');
    expect(step2.session.current_state).toBe('ASK_TIME');

    const step3 = await sendMessage(app, sessionId, 'Sunday open-a?', 'a15_2c');
    expect(step3.session.current_flow).toBe('booking');
    expect(step3.session.current_state).toBe('ASK_TIME');
    expect(step3.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(step3.assistant_message.message_text.toLowerCase()).toMatch(/sunday|closed|timing|open/);
    expect(step3.assistant_message.message_text.toLowerCase()).toMatch(/morning|afternoon|evening|time/);
  });

  it('3. PROPOSE_SLOTS + Parking answers KB and repeats slot choices', async () => {
    const sessionId = await createConversation(app, '+919222225003');
    await sendMessage(app, sessionId, `${bookingDate} evening appointment venum`, 'a15_3a');
    const atSlots = await sendMessage(app, sessionId, 'Knee pain', 'a15_3b');
    expect(atSlots.session.current_state).toBe('PROPOSE_SLOTS');

    const step = await sendMessage(app, sessionId, 'Parking irukka?', 'a15_3d');
    expect(step.session.current_flow).toBe('booking');
    expect(step.session.current_state).toBe('PROPOSE_SLOTS');
    expect(step.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(step.assistant_message.message_text.toLowerCase()).toContain('parking');
    expect(step.assistant_message.message_text.toLowerCase()).toMatch(/slot|choose|select|pm|am/);
  });

  it('4. ASK_PATIENT_NAME + Clinic enga answers location and asks name again', async () => {
    const slotTime = await pickEveningSlotTime(app, bookingDate);
    const sessionId = await createConversation(app, '+919222225004');
    await sendMessage(app, sessionId, `${bookingDate} evening appointment venum`, 'a15_4a');
    await sendMessage(app, sessionId, 'Knee pain', 'a15_4b');
    const atName = await sendMessage(app, sessionId, slotTime, 'a15_4c');
    expect(atName.session.current_state).toBe('ASK_PATIENT_NAME');

    const step = await sendMessage(app, sessionId, 'Clinic enga irukku?', 'a15_4d');
    expect(step.session.current_flow).toBe('booking');
    expect(step.session.current_state).toBe('ASK_PATIENT_NAME');
    expect(step.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(step.assistant_message.message_text.toLowerCase()).toMatch(/address|location|chennai|irukku/);
    expect(step.assistant_message.message_text.toLowerCase()).toMatch(/name|ungal|patient/);
  });

  it('5. held slot + receptionist releases hold and starts handoff', async () => {
    const slotTime = await pickEveningSlotTime(app, bookingDate);
    const sessionId = await createConversation(app, '+919222225005');
    await sendMessage(app, sessionId, `${bookingDate} evening appointment venum`, 'a15_5a');
    await sendMessage(app, sessionId, 'Knee pain', 'a15_5b');
    const held = await sendMessage(app, sessionId, slotTime, 'a15_5c');
    expect(held.session.collected_json.hold_id).toBeTruthy();

    const step = await sendMessage(app, sessionId, 'Receptionist kitta pesanum', 'a15_5d');
    expect(step.session.current_flow).toBe('handoff');
    expect(['handoff.ask_reason', 'handoff.started_from_active_flow']).toContain(
      step.assistant_message.reply_template_key,
    );

    const [hold] = await sql`
      SELECT status FROM slot_holds
      WHERE session_id = ${sessionId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(hold?.status).toBe('released');
  });

  it('6. held slot + vendam releases hold and ends booking', async () => {
    const slotTime = await pickEveningSlotTime(app, bookingDate);
    const sessionId = await createConversation(app, '+919222225006');
    await sendMessage(app, sessionId, `${bookingDate} evening appointment venum`, 'a15_6a');
    await sendMessage(app, sessionId, 'Knee pain', 'a15_6b');
    const held = await sendMessage(app, sessionId, slotTime, 'a15_6c');
    expect(held.session.collected_json.hold_id).toBeTruthy();

    const step = await sendMessage(app, sessionId, 'vendam', 'a15_6d');
    expect(step.session.current_flow).toBe('none');
    expect(step.assistant_message.reply_template_key).toBe('booking.flow_cancelled');

    const [hold] = await sql`
      SELECT status FROM slot_holds
      WHERE session_id = ${sessionId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(hold?.status).toBe('released');
  });

  it('7. date correction after PROPOSE_SLOTS clears hold and recomputes slots', async () => {
    const sessionId = await createConversation(app, '+919222225007');
    await sendMessage(app, sessionId, `${bookingDate} evening appointment venum`, 'a15_7a');
    const atSlots = await sendMessage(app, sessionId, 'Knee pain', 'a15_7b');
    expect(atSlots.session.current_state).toBe('PROPOSE_SLOTS');
    const initialSlots = atSlots.session.collected_json.proposed_slots;

    const corrected = await sendMessage(app, sessionId, alternateDate, 'a15_7d');
    expect(corrected.session.collected_json.preferred_date).toBe(alternateDate);
    expect(corrected.session.collected_json.hold_id).toBeUndefined();
    expect(corrected.session.collected_json.selected_slot_id).toBeUndefined();
    if (Array.isArray(initialSlots) && initialSlots.length > 0) {
      expect(corrected.session.collected_json.proposed_slots).not.toEqual(initialSlots);
    }
  });

  it('8. no duplicate appointment after side question and confirmation', async () => {
    const slotTime = await pickEveningSlotTime(app, bookingDate);
    const sessionId = await createConversation(app, '+919222225008');
    await sendMessage(app, sessionId, `${bookingDate} evening appointment venum`, 'a15_8a');
    await sendMessage(app, sessionId, 'Knee pain', 'a15_8b');
    await sendMessage(app, sessionId, 'Parking irukka?', 'a15_8c');
    await sendMessage(app, sessionId, slotTime, 'a15_8d');
    await sendMessage(app, sessionId, 'Kumar', 'a15_8e');
    const confirm1 = await sendMessage(app, sessionId, 'Seri', 'a15_8f');
    expect(confirm1.assistant_message.reply_template_key).toBe('booking.created_pending');

    const [countAfterFirst] = await sql`
      SELECT count(*)::int AS count FROM appointment_requests
      WHERE source_session_id = ${sessionId}
    `;
    expect(countAfterFirst?.count).toBe(1);

    const confirm2 = await sendMessage(app, sessionId, 'Seri', 'a15_8g');
    expect(confirm2.assistant_message.reply_template_key).toBe('booking.offer_help');

    const [countAfterSecond] = await sql`
      SELECT count(*)::int AS count FROM appointment_requests
      WHERE source_session_id = ${sessionId}
    `;
    expect(countAfterSecond?.count).toBe(1);
  });
});
