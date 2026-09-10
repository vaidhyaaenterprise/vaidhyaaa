import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import postgres from 'postgres';
import { expect } from 'vitest';

import { addDays, dayOfWeekMon1, formatDateInTimezone } from '@vaidya/db';
import { apiSuccessBodySchema } from '@vaidya/shared';

import { AppModule } from '../../src/app.module';
import { RECEPTIONIST_AGENT_LLM_PORT } from '../../src/modules/conversation/receptionist-agent.types';
import { SlotGenerationService } from '../../src/modules/slots/slot-generation.service';
import { prepareTestDatabase } from '../db-setup';
import { SEED } from '../test-constants';
import { createScenarioAgentLlmMock } from './scenario-agent-llm-mock';

export const TIMEZONE = 'Asia/Kolkata';

export type AgentMessageResult = {
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
    debug_json?: Record<string, unknown> | null;
  };
};

export function findNextFriday(minOffsetFromToday = 1): string {
  const today = formatDateInTimezone(new Date(), TIMEZONE);
  for (let offset = minOffsetFromToday; offset <= 14; offset += 1) {
    const candidate = addDays(today, offset, TIMEZONE);
    if (dayOfWeekMon1(candidate, TIMEZONE) === 5) {
      return candidate;
    }
  }
  throw new Error('No Friday found in test horizon');
}

export async function createAgentRegressionApp(fridayDate: string): Promise<{
  app: NestFastifyApplication;
  sql: ReturnType<typeof postgres>;
}> {
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
  process.env.KNOWLEDGE_VECTOR_MIN_SCORE = '0.5';

  await prepareTestDatabase();

  const llmChat = createScenarioAgentLlmMock({ fridayDate });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(RECEPTIONIST_AGENT_LLM_PORT)
    .useValue({ chat: llmChat })
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('v1');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const sql = postgres(process.env.DATABASE_URL, { max: 5 });
  const slotGeneration = app.get(SlotGenerationService);

  await sql`
    INSERT INTO doctor_schedules (clinic_id, doctor_id, doctor_service_id, day_of_week, start_time, end_time, active)
    SELECT ds.clinic_id, ds.doctor_id, ds.id, d, '09:00'::time, '13:00'::time, true
    FROM doctor_services ds, generate_series(1,6) d
    WHERE ds.id = '00000000-0000-0000-0000-000000000403'
      AND ds.clinic_id = ${SEED.CLINIC_ID}
    ON CONFLICT DO NOTHING
  `;

  await slotGeneration.generateSlots({
    clinicId: SEED.CLINIC_ID,
    doctorId: SEED.DOCTOR_KUMAR_ID,
    clinicServiceId: SEED.ORTHO_SERVICE_ID,
  });

  return { app, sql };
}

export async function createConversation(app: NestFastifyApplication, phone: string) {
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

export async function sendMessage(
  app: NestFastifyApplication,
  sessionId: string,
  messageText: string,
  idempotencyKey: string,
): Promise<AgentMessageResult> {
  const response = await app.inject({
    method: 'POST',
    url: `/v1/conversations/${sessionId}/messages`,
    payload: { message_text: messageText, idempotency_key: idempotencyKey },
  });
  expect(response.statusCode).toBe(201);
  return apiSuccessBodySchema.parse(response.json()).data as AgentMessageResult;
}

export function toolsUsed(result: AgentMessageResult): string[] {
  const debug = result.assistant_message.debug_json ?? {};
  const tools = debug.tools_used;
  return Array.isArray(tools) ? (tools as string[]) : [];
}
