import postgres from 'postgres';
import { addDays, formatDateInTimezone } from '@vaidya/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { apiSuccessBodySchema } from '@vaidya/shared';

import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { SEED } from './test-constants';
import { SlotGenerationService } from '../src/modules/slots/slot-generation.service';
import { ReceptionistAgentToolsService } from '../src/modules/conversation/receptionist-agent-tools';

const TIMEZONE = 'Asia/Kolkata';

function findBookableDate(minOffsetFromToday = 1): string {
  const today = formatDateInTimezone(new Date(), TIMEZONE);
  for (let offset = minOffsetFromToday; offset <= 14; offset += 1) {
    const candidate = addDays(today, offset, TIMEZONE);
    const day = new Date(`${candidate}T12:00:00`).getDay();
    if (day >= 1 && day <= 6) {
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

describe('A23 receptionist agent tools', () => {
  let app: NestFastifyApplication;
  let sql: ReturnType<typeof postgres>;
  let tools: ReceptionistAgentToolsService;
  const phone = '+919222229950';
  const bookingDate = findBookableDate();

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5433/vaidya_test';
    process.env.QUEUE_MODE = 'inline';
    delete process.env.REDIS_URL;
    process.env.PRIMARY_LLM_PROVIDER = 'mock';
    process.env.SERVICE_ROUTER_PROVIDER = 'mock';

    await prepareTestDatabase();
    app = await createTestApp();
    tools = app.get(ReceptionistAgentToolsService);
    const slotGeneration = app.get(SlotGenerationService);
    await slotGeneration.generateSlots({
      clinicId: SEED.CLINIC_ID,
      doctorId: SEED.DOCTOR_KUMAR_ID,
      clinicServiceId: SEED.ORTHO_SERVICE_ID,
    });
    sql = postgres(process.env.DATABASE_URL, { max: 5 });
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
  });

  it('check_slot_availability returns real Kumar slots for seeded clinic', async () => {
    const sessionId = await createConversation(app, phone);
    const result = await tools.execute(
      'check_slot_availability',
      {
        doctorName: 'Kumar',
        reasonForVisit: 'knee pain',
        date: bookingDate,
        timePreference: 'evening',
      },
      {
        clinicId: SEED.CLINIC_ID,
        sessionId,
        collected: {},
        patientPhone: phone,
      },
    );

    expect(Array.isArray(result.slots)).toBe(true);
    expect((result.slots as unknown[]).length).toBeGreaterThan(0);
    const firstSlot = (result.slots as Array<Record<string, string>>)[0]!;
    expect(firstSlot.slotId).toBeTruthy();
    expect(firstSlot.doctorName?.toLowerCase()).toContain('kumar');
    expect(firstSlot.dateDisplay).toBe(bookingDate);
    expect(firstSlot.time).toMatch(/\d{1,2}:\d{2}/);
  });

  it('create_appointment_request creates an appointment row from a real slot', async () => {
    const sessionId = await createConversation(app, `${phone}1`);
    const availability = await tools.execute(
      'check_slot_availability',
      {
        doctorName: 'Kumar',
        reasonForVisit: 'knee pain',
        date: bookingDate,
        timePreference: 'evening',
      },
      {
        clinicId: SEED.CLINIC_ID,
        sessionId,
        collected: {},
        patientPhone: `${phone}1`,
      },
    );

    const slot = (availability.slots as Array<Record<string, string>>)[0];
    expect(slot?.slotId).toBeTruthy();

    const created = await tools.execute(
      'create_appointment_request',
      {
        patientName: 'Priya',
        phone: `${phone}1`,
        doctorName: 'Kumar',
        reasonForVisit: 'knee pain',
        date: bookingDate,
        slotId: slot!.slotId,
      },
      {
        clinicId: SEED.CLINIC_ID,
        sessionId,
        collected: {},
        patientPhone: `${phone}1`,
      },
    );

    expect(created.error).toBeUndefined();
    expect(created.appointmentId).toBeTruthy();
    expect(['pending', 'confirmed']).toContain(created.status);

    const rows = await sql<{ id: string; status: string }[]>`
      select id, status
      from appointment_requests
      where clinic_id = ${SEED.CLINIC_ID}
        and id = ${created.appointmentId as string}
      limit 1
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBeTruthy();
  });
});
