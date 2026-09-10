import postgres from 'postgres';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { addDays, formatDateInTimezone } from '@vaidya/db';
import { apiSuccessBodySchema, type LlmChatMessage, type LlmChatRequest } from '@vaidya/shared';

import { AppModule } from '../src/app.module';
import {
  RECEPTIONIST_AGENT_LLM_PORT,
  type ReceptionistAgentLlmPort,
} from '../src/modules/conversation/receptionist-agent.types';
import { SlotGenerationService } from '../src/modules/slots/slot-generation.service';
import { prepareTestDatabase } from './db-setup';
import { SEED } from './test-constants';

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

function parseTurnPayload(messages: LlmChatMessage[]): Record<string, unknown> | null {
  const userMessages = messages.filter((message) => message.role === 'user');
  const latest = userMessages[userMessages.length - 1];
  if (!latest?.content || typeof latest.content !== 'string') {
    return null;
  }
  try {
    return JSON.parse(latest.content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractSlotIdFromPayload(payload: Record<string, unknown> | null): string | null {
  const collected = payload?.collected as Record<string, unknown> | undefined;
  const proposed = collected?.proposed_slots as Array<{ slot_id?: string }> | undefined;
  return proposed?.[0]?.slot_id ?? null;
}

function extractToolResult(
  messages: LlmChatMessage[],
  toolName: string,
): Record<string, unknown> | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'tool' || message.name !== toolName) {
      continue;
    }
    if (typeof message.content !== 'string') {
      continue;
    }
    try {
      return JSON.parse(message.content) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function createRichBookingAgentLlmMock(
  bookingDate: string,
  patientPhone: string,
): ReceptionistAgentLlmPort['chat'] {
  const patientTurns = new Set<string>();

  return vi.fn<ReceptionistAgentLlmPort['chat']>(async (request: LlmChatRequest) => {
    const payload = parseTurnPayload(request.messages);
    const patientMessage = String(payload?.patient_message ?? '');
    const isNewPatientTurn = patientMessage.length > 0 && !patientTurns.has(patientMessage);
    if (isNewPatientTurn) {
      patientTurns.add(patientMessage);
    }

    const assistantToolRounds = request.messages.filter(
      (message: LlmChatMessage) =>
        message.role === 'assistant' && (message.tool_calls?.length ?? 0) > 0,
    ).length;

    if (patientMessage.toLowerCase().includes('knee pain')) {
      if (assistantToolRounds === 0) {
        return {
          model: 'mock-agent',
          content: '',
          toolCalls: [
            {
              id: 'call_update_state',
              type: 'function' as const,
              function: {
                name: 'update_booking_state',
                arguments: JSON.stringify({
                  fields: {
                    reason_for_visit: 'knee pain',
                    doctor_name: 'Dr Kumar',
                    preferred_date: bookingDate,
                    time_preference: 'evening',
                    patient_name: 'Priya',
                    patient_phone: '9876543210',
                  },
                }),
              },
            },
            {
              id: 'call_check_slots',
              type: 'function' as const,
              function: {
                name: 'check_slot_availability',
                arguments: JSON.stringify({
                  doctorName: 'Kumar',
                  reasonForVisit: 'knee pain',
                  date: bookingDate,
                  timePreference: 'evening',
                }),
              },
            },
          ],
          finishReason: 'tool_calls',
        };
      }

      return {
        model: 'mock-agent',
        content:
          'Priya, Dr Kumar-ku tomorrow evening slots available. First slot 6:30 PM, second 7:00 PM. Edha slot choose panreenga?',
        finishReason: 'stop',
      };
    }

    if (/confirm|yes|first|6:30|sari/i.test(patientMessage)) {
      if (assistantToolRounds === 0) {
        const slotId = extractSlotIdFromPayload(payload);
        if (!slotId) {
          throw new Error('Expected slot id from collected.proposed_slots');
        }
        return {
          model: 'mock-agent',
          content: '',
          toolCalls: [
            {
              id: 'call_create_appt',
              type: 'function' as const,
              function: {
                name: 'create_appointment_request',
                arguments: JSON.stringify({
                  patientName: 'Priya',
                  phone: patientPhone,
                  doctorName: 'Kumar',
                  reasonForVisit: 'knee pain',
                  date: bookingDate,
                  slotId,
                  confirmedByPatient: true,
                }),
              },
            },
          ],
          finishReason: 'tool_calls',
        };
      }

      const createResult = extractToolResult(request.messages, 'create_appointment_request');
      if (createResult?.error) {
        throw new Error(`create_appointment_request failed: ${JSON.stringify(createResult)}`);
      }

      return {
        model: 'mock-agent',
        content: 'Done Priya! Dr Kumar appointment confirmed for tomorrow evening.',
        finishReason: 'stop',
      };
    }

    return {
      model: 'mock-agent',
      content: 'Please tell me which slot you prefer.',
      finishReason: 'stop',
    };
  });
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
      current_flow: string;
      current_state: string;
      collected_json: Record<string, unknown>;
      status: string;
    };
    assistant_message: {
      message_text: string;
      reply_template_key: string | null;
      intent?: string | null;
    };
  };
}

describe('A25 agent orchestrator booking integration', () => {
  let app: NestFastifyApplication;
  let sql: ReturnType<typeof postgres>;
  let phone = '';
  const bookingDate = findBookableDate();

  beforeAll(async () => {
    phone = `+9198765${String(Date.now()).slice(-5)}`;
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5433/vaidya_test';
    process.env.QUEUE_MODE = 'inline';
    delete process.env.REDIS_URL;
    process.env.PRIMARY_LLM_PROVIDER = 'mock';
    process.env.STATE_ENTITY_EXTRACTOR_PROVIDER = 'mock';
    process.env.SERVICE_ROUTER_PROVIDER = 'mock';
    process.env.CONVERSATION_AGENT_MODE = 'agent';
    process.env.RECEPTIONIST_AGENT_PROVIDER = 'sarvam';
    process.env.SARVAM_API_KEY = 'sk-test';
    process.env.DEBUG_API = 'true';

    await prepareTestDatabase();

    const llmChat = createRichBookingAgentLlmMock(bookingDate, phone);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RECEPTIONIST_AGENT_LLM_PORT)
      .useValue({ chat: llmChat })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const slotGeneration = app.get(SlotGenerationService);
    await slotGeneration.generateSlots({
      clinicId: SEED.CLINIC_ID,
      doctorId: SEED.DOCTOR_KUMAR_ID,
      clinicServiceId: SEED.ORTHO_SERVICE_ID,
    });
    sql = postgres(process.env.DATABASE_URL, { max: 5 });
  });

  afterAll(async () => {
    delete process.env.CONVERSATION_AGENT_MODE;
    delete process.env.RECEPTIONIST_AGENT_PROVIDER;
    delete process.env.SARVAM_API_KEY;
    await app.close();
    await sql.end({ timeout: 5 });
  });

  it('uses agent free text without re-asking known booking fields, then creates appointment on confirm', async () => {
    const sessionId = await createConversation(app, phone);

    const first = await sendMessage(
      app,
      sessionId,
      "Hi, I need to book with Dr Kumar tomorrow evening for knee pain, I'm Priya, number 9876543210",
      'a25-rich-booking-1',
    );

    const firstReply = first.assistant_message.message_text.toLowerCase();
    expect(firstReply).toMatch(/slot|6:30|7:00|choose|confirm/);
    expect(firstReply).not.toMatch(/patient name|your name|enna problem|which doctor|reason/);
    expect(first.session.collected_json.patient_name).toBe('Priya');
    expect(first.session.collected_json.reason_for_visit).toBe('knee pain');
    expect(first.session.collected_json.doctor_name).toMatch(/kumar/i);
    expect((first.session.collected_json.proposed_slots as unknown[] | undefined)?.length).toBeGreaterThan(0);

    const second = await sendMessage(app, sessionId, 'First slot please, confirm', 'a25-rich-booking-2');

    expect(second.assistant_message.message_text.toLowerCase()).toMatch(/confirm|booked|appointment/);

    const appointments = await sql<{ id: string; patient_name: string; reason_for_visit: string }[]>`
      SELECT id, patient_name, reason_for_visit
      FROM appointment_requests
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND source_session_id = ${sessionId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(appointments.length).toBe(1);
    expect(appointments[0]?.patient_name).toBe('Priya');
    expect(appointments[0]?.reason_for_visit).toBe('knee pain');
    expect(second.session.collected_json.appointment_id).toBe(appointments[0]?.id);
  });
});
