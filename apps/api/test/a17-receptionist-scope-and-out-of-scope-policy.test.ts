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

const bookedSlotTimes = new Map<string, string>();

async function bookAppointmentForPhone(
  app: NestFastifyApplication,
  phone: string,
  bookingDate: string,
): Promise<void> {
  const slotTime = await pickEveningSlotTime(app, bookingDate);
  bookedSlotTimes.set(phone, slotTime);
  const sessionId = await createConversation(app, phone);
  await sendMessage(app, sessionId, `${bookingDate} evening appointment venum`, `${phone}_book_1`);
  await sendMessage(app, sessionId, 'Knee pain', `${phone}_book_2`);
  await sendMessage(app, sessionId, slotTime, `${phone}_book_3`);
  await sendMessage(app, sessionId, 'Kumar', `${phone}_book_4`);
  await sendMessage(app, sessionId, 'Seri', `${phone}_book_5`);
}

function bookedSlotTimeForPhone(phone: string): string {
  const slotTime = bookedSlotTimes.get(phone);
  expect(slotTime).toBeTruthy();
  return slotTime!;
}

describe('A17 receptionist scope and out-of-scope policy', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;
  let bookingDate: string;
  let rescheduleDate: string;

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
    const slotGeneration = app.get(SlotGenerationService);

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
    rescheduleDate = findNextBookableDate(TIMEZONE, bookingDate);
    await seedMorningSlotForDate(sql, bookingDate);
  });

  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('1. ASK_DATE + fee question answers fee and asks date again', async () => {
    const sessionId = await createConversation(app, '+919222227001');
    const step1 = await sendMessage(app, sessionId, 'Knee pain appointment venum', 'a17_1a');
    expect(step1.session.current_state).toBe('ASK_DATE');

    const step2 = await sendMessage(app, sessionId, 'Dr Priya fees evlo?', 'a17_1b');
    expect(step2.session.current_flow).toBe('booking');
    expect(step2.session.current_state).toBe('ASK_DATE');
    expect(step2.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(step2.assistant_message.message_text.toLowerCase()).toMatch(/fee|rs|₹/);
    expect(step2.assistant_message.message_text.toLowerCase()).toMatch(/date|naal|day/);
  });

  it('2. ASK_TIME + Parking answers KB and asks time again', async () => {
    const sessionId = await createConversation(app, '+919222227002');
    await sendMessage(app, sessionId, 'Knee pain appointment venum', 'a17_2a');
    const atTime = await sendMessage(app, sessionId, bookingDate, 'a17_2b');
    expect(atTime.session.current_state).toBe('ASK_TIME');

    const step = await sendMessage(app, sessionId, 'Parking irukka?', 'a17_2c');
    expect(step.session.current_flow).toBe('booking');
    expect(step.session.current_state).toBe('ASK_TIME');
    expect(step.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(step.assistant_message.message_text.toLowerCase()).toContain('parking');
    expect(step.assistant_message.message_text.toLowerCase()).toMatch(/morning|afternoon|evening|time/);
  });

  it('3. PROPOSE_SLOTS + Weather redirects scope and repeats slots', async () => {
    const sessionId = await createConversation(app, '+919222227003');
    await sendMessage(app, sessionId, `${bookingDate} evening appointment venum`, 'a17_3a');
    const atSlots = await sendMessage(app, sessionId, 'Knee pain', 'a17_3b');
    expect(atSlots.session.current_state).toBe('PROPOSE_SLOTS');

    const step = await sendMessage(app, sessionId, 'Weather eppadi?', 'a17_3c');
    expect(step.session.current_flow).toBe('booking');
    expect(step.session.current_state).toBe('PROPOSE_SLOTS');
    expect(step.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(step.assistant_message.message_text.toLowerCase()).toMatch(/clinic|appointment|fees|timing/);
    expect(step.assistant_message.message_text.toLowerCase()).toMatch(/slot|choose|select|pm|am/);
  });

  it('4. ASK_PATIENT_NAME + medical advice refuses and asks name again', async () => {
    const slotTime = await pickEveningSlotTime(app, bookingDate);
    const sessionId = await createConversation(app, '+919222227004');
    await sendMessage(app, sessionId, `${bookingDate} evening appointment venum`, 'a17_4a');
    await sendMessage(app, sessionId, 'Knee pain', 'a17_4b');
    const atName = await sendMessage(app, sessionId, slotTime, 'a17_4c');
    expect(atName.session.current_state).toBe('ASK_PATIENT_NAME');

    const step = await sendMessage(app, sessionId, 'Fever-ku enna tablet?', 'a17_4d');
    expect(step.session.current_flow).toBe('booking');
    expect(step.session.current_state).toBe('ASK_PATIENT_NAME');
    expect(step.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(step.assistant_message.message_text.toLowerCase()).toMatch(/medical advice|doctor|consult/);
    expect(step.assistant_message.message_text.toLowerCase()).toMatch(/name|ungal|patient/);
  });

  it('5. PROPOSE_SLOTS + Chest pain triggers emergency, incident, and hold release', async () => {
    const sessionId = await createConversation(app, '+919222227005');
    await sendMessage(app, sessionId, `${bookingDate} evening appointment venum`, 'a17_5a');
    const atSlots = await sendMessage(app, sessionId, 'Knee pain', 'a17_5b');
    expect(atSlots.session.current_state).toBe('PROPOSE_SLOTS');

    const step = await sendMessage(app, sessionId, 'Chest pain', 'a17_5c');
    expect(step.session.status).toBe('escalated');
    expect(step.assistant_message.reply_template_key).toBe('safety.emergency_active_flow');
    expect(step.assistant_message.message_text.toLowerCase()).toMatch(/108|emergency|hospital/);

    const [incident] = await sql`
      SELECT id FROM emergency_incidents
      WHERE source_session_id = ${sessionId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(incident?.id).toBeTruthy();

    const [hold] = await sql`
      SELECT status FROM slot_holds
      WHERE session_id = ${sessionId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (hold) {
      expect(hold.status).toBe('released');
    }
  });

  it('6. held slot + handoff starts and releases hold', async () => {
    const slotTime = await pickEveningSlotTime(app, bookingDate);
    const sessionId = await createConversation(app, '+919222227006');
    await sendMessage(app, sessionId, `${bookingDate} evening appointment venum`, 'a17_6a');
    await sendMessage(app, sessionId, 'Knee pain', 'a17_6b');
    const held = await sendMessage(app, sessionId, slotTime, 'a17_6c');
    expect(held.session.collected_json.hold_id).toBeTruthy();

    const step = await sendMessage(app, sessionId, 'Receptionist kitta pesanum', 'a17_6d');
    expect(step.session.current_flow).toBe('handoff');
    expect(step.assistant_message.reply_template_key).toBe('handoff.started_from_active_flow');

    const [hold] = await sql`
      SELECT status FROM slot_holds
      WHERE session_id = ${sessionId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(hold?.status).toBe('released');
  });

  it('7. CONFIRM_DOCTOR + vendam cancels booking', async () => {
    const slotTime = await pickEveningSlotTime(app, bookingDate);
    const sessionId = await createConversation(app, '+919222227007');
    await sendMessage(app, sessionId, `${bookingDate} evening appointment venum`, 'a17_7a');
    await sendMessage(app, sessionId, 'Knee pain', 'a17_7b');
    await sendMessage(app, sessionId, slotTime, 'a17_7c');
    const atConfirm = await sendMessage(app, sessionId, 'Kumar', 'a17_7d');
    expect(atConfirm.session.current_state).toBe('CONFIRM_DOCTOR');

    const step = await sendMessage(app, sessionId, 'vendam', 'a17_7f');
    expect(step.session.current_flow).toBe('none');
    expect(step.assistant_message.reply_template_key).toBe('booking.flow_cancelled');
  });

  it('8. cancel CONFIRM + vendam does not cancel appointment', async () => {
    const phone = '+919222227008';
    await bookAppointmentForPhone(app, phone, bookingDate);

    const sessionId = await createConversation(app, phone);
    await sendMessage(app, sessionId, 'Appointment cancel pannunga', 'a17_8a');
    const step = await sendMessage(app, sessionId, 'vendam', 'a17_8b');
    expect(step.assistant_message.reply_template_key).toBe('cancel.not_cancelled');

    const [appointment] = await sql`
      SELECT status FROM appointment_requests WHERE patient_phone = ${phone} LIMIT 1
    `;
    expect(appointment?.status).toBe('pending_confirmation');
  });

  it('9. reschedule PROPOSE_NEW_SLOTS + timing answers and resumes slot selection', async () => {
    const phone = '+919222222509';
    await bookAppointmentForPhone(app, phone, bookingDate);

    const sessionId = await createConversation(app, phone);
    const step1 = await sendMessage(app, sessionId, 'Appointment time change panna venum', 'a17_9a');
    expect(step1.session.current_flow).toBe('reschedule');
    expect(step1.assistant_message.reply_template_key).toBe('reschedule.ask_new_date');

    const dateStep = await sendMessage(app, sessionId, rescheduleDate, 'a17_9b');
    expect(dateStep.session.current_flow).toBe('reschedule');

    let slotStep = dateStep;
    if (dateStep.assistant_message.reply_template_key === 'reschedule.ask_new_time') {
      slotStep = await sendMessage(app, sessionId, 'evening', 'a17_9c');
      expect(slotStep.session.current_flow).toBe('reschedule');
    }
    expect(slotStep.assistant_message.reply_template_key).toBe('reschedule.propose_slots');
    expect(slotStep.session.current_state).toBe('PROPOSE_NEW_SLOTS');

    const step = await sendMessage(app, sessionId, 'clinic timing enna?', 'a17_9d');
    expect(step.session.current_flow).toBe('reschedule');
    expect(step.session.current_state).toBe('PROPOSE_NEW_SLOTS');
    expect(step.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(step.assistant_message.message_text.toLowerCase()).toMatch(/timing|open|hour|monday|sunday/);
    expect(step.assistant_message.message_text.toLowerCase()).toMatch(/slot|choose|select|pm|am/);
  });

  it('10. standalone cricket redirects scope with no DB write', async () => {
    const sessionId = await createConversation(app, '+919222227010');

    const step = await sendMessage(app, sessionId, 'Cricket score enna?', 'a17_10a');
    expect(step.assistant_message.reply_template_key).toBe('scope.out_of_scope_redirect');
    expect(step.assistant_message.message_text.toLowerCase()).toMatch(/clinic|appointment/);

    const [appointments] = await sql`
      SELECT count(*)::int AS count FROM appointment_requests
      WHERE source_session_id = ${sessionId}
    `;
    expect(appointments?.count).toBe(0);
  });

  it('11. Eye checkup venum returns unsupported service without booking', async () => {
    const sessionId = await createConversation(app, '+919222227011');
    const step = await sendMessage(app, sessionId, 'Eye checkup venum', 'a17_11a');
    expect(step.assistant_message.reply_template_key).toBe('scope.unsupported_service');
    expect(step.session.current_flow).toBe('none');

    const [appointments] = await sql`
      SELECT count(*)::int AS count FROM appointment_requests
      WHERE source_session_id = ${sessionId}
    `;
    expect(appointments?.count).toBe(0);
  });

  it('12. no hallucination when no KB/fee exists', async () => {
    const sessionId = await createConversation(app, '+919222227012');
    await sendMessage(app, sessionId, 'Knee pain appointment venum', 'a17_12a');
    const step = await sendMessage(app, sessionId, 'MRI scan fee evlo?', 'a17_12b');
    expect(step.assistant_message.reply_template_key).toBe('knowledge.answer');
    expect(step.assistant_message.message_text.toLowerCase()).toMatch(/staff|confirm/);
    expect(step.assistant_message.message_text).not.toMatch(/₹\s*\d/);
    expect(step.assistant_message.message_text.toLowerCase()).not.toMatch(/rs\.?\s*\d/);
  });
});
