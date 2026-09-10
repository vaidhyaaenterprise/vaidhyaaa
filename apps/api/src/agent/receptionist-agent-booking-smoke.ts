import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import postgres from 'postgres';

import { parseApiEnv } from '@vaidya/config';
import { addDays, dayOfWeekMon1, formatDateInTimezone } from '@vaidya/db';

import { AppModule } from '../app.module';
import { SlotGenerationService } from '../modules/slots/slot-generation.service';

const TIMEZONE = 'Asia/Kolkata';
const DEFAULT_CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_ORTHO_SERVICE_ID = '00000000-0000-0000-0000-000000000303';
const DEFAULT_DOCTOR_KUMAR_ID = '00000000-0000-0000-0000-000000000203';

type TranscriptTurn = {
  role: 'patient' | 'assistant';
  text: string;
  latencyMs?: number;
  toolsUsed?: string[];
  debug?: Record<string, unknown> | null;
  latencyMetrics?: Record<string, unknown> | null;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { code: string; message: string };
};

function findNextFriday(minOffsetFromToday = 1): string {
  const today = formatDateInTimezone(new Date(), TIMEZONE);
  for (let offset = minOffsetFromToday; offset <= 14; offset += 1) {
    const candidate = addDays(today, offset, TIMEZONE);
    if (dayOfWeekMon1(candidate, TIMEZONE) === 5) {
      return candidate;
    }
  }
  throw new Error('No Friday found in booking smoke horizon');
}

function providerApiKeyMissing(env: ReturnType<typeof parseApiEnv>): string | null {
  if (env.RECEPTIONIST_AGENT_PROVIDER === 'sarvam' && !env.SARVAM_API_KEY) {
    return 'SARVAM_API_KEY missing';
  }
  if (env.RECEPTIONIST_AGENT_PROVIDER === 'openai_compatible' && !env.OPENAI_COMPAT_API_KEY) {
    return 'OPENAI_COMPAT_API_KEY missing';
  }
  if (env.RECEPTIONIST_AGENT_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    return 'ANTHROPIC_API_KEY missing';
  }
  return null;
}

function bookingPatientScript(fridayLabel: string): string[] {
  return [
    `Hi, naan Priya. Dr Kumar paakanum, left knee pain. ${fridayLabel} morning slot venum.`,
    'First available slot please',
    'Yes, please confirm and book it',
  ];
}

async function main(): Promise<void> {
  process.env.CONVERSATION_AGENT_MODE = process.env.CONVERSATION_AGENT_MODE ?? 'agent';
  process.env.RECEPTIONIST_AGENT_PROVIDER = process.env.RECEPTIONIST_AGENT_PROVIDER ?? 'sarvam';
  process.env.PRIMARY_LLM_PROVIDER = process.env.PRIMARY_LLM_PROVIDER ?? 'mock';
  process.env.STATE_ENTITY_EXTRACTOR_PROVIDER = process.env.STATE_ENTITY_EXTRACTOR_PROVIDER ?? 'mock';
  process.env.SERVICE_ROUTER_PROVIDER = process.env.SERVICE_ROUTER_PROVIDER ?? 'mock';
  process.env.QUEUE_MODE = process.env.QUEUE_MODE ?? 'inline';
  delete process.env.REDIS_URL;

  const env = parseApiEnv(process.env);
  const skipReason = providerApiKeyMissing(env);
  if (skipReason) {
    console.log(
      JSON.stringify(
        {
          mode: 'receptionist_agent_booking_smoke',
          skipped: true,
          reason: skipReason,
          provider: env.RECEPTIONIST_AGENT_PROVIDER,
        },
        null,
        2,
      ),
    );
    return;
  }

  const clinicId = process.env.DEV_CLINIC_ID ?? process.env.CLINIC_ID ?? DEFAULT_CLINIC_ID;
  const patientPhone = process.env.PATIENT_PHONE ?? '+919876543210';
  const fridayDate = findNextFriday();
  const fridayLabel = 'Friday';

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('v1');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const sql = postgres(env.DATABASE_URL, { max: 3 });
  const slotGeneration = app.get(SlotGenerationService);

  await sql`
    INSERT INTO doctor_schedules (clinic_id, doctor_id, doctor_service_id, day_of_week, start_time, end_time, active)
    SELECT ds.clinic_id, ds.doctor_id, ds.id, d, '09:00'::time, '13:00'::time, true
    FROM doctor_services ds, generate_series(1,6) d
    WHERE ds.id = ${DEFAULT_ORTHO_SERVICE_ID}
      AND ds.clinic_id = ${clinicId}
    ON CONFLICT DO NOTHING
  `;

  await slotGeneration.generateSlots({
    clinicId,
    doctorId: DEFAULT_DOCTOR_KUMAR_ID,
    clinicServiceId: DEFAULT_ORTHO_SERVICE_ID,
  });

  const createResponse = await app.inject({
    method: 'POST',
    url: '/v1/conversations',
    payload: {
      clinic_id: clinicId,
      channel: 'admin_test',
      patient_phone: patientPhone,
      language_code: 'ta_tanglish',
    },
  });
  if (createResponse.statusCode !== 201) {
    throw new Error(`Failed to create session (${createResponse.statusCode})`);
  }
  const createBody = createResponse.json() as ApiEnvelope<{ session: { id: string } }>;
  const sessionId = createBody.data?.session.id;
  if (!sessionId) {
    throw new Error('Session id missing from create response');
  }

  const transcript: TranscriptTurn[] = [];
  const turnLatencies: number[] = [];

  for (const [index, patientText] of bookingPatientScript(fridayLabel).entries()) {
    transcript.push({ role: 'patient', text: patientText });
    const startedAt = Date.now();
    const response = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${sessionId}/messages`,
      payload: {
        message_text: patientText,
        idempotency_key: `smoke_${sessionId}_${index}_${Date.now()}`,
      },
    });
    const latencyMs = Date.now() - startedAt;
    turnLatencies.push(latencyMs);

    if (response.statusCode !== 201) {
      throw new Error(`Message turn failed (${response.statusCode}): ${response.body}`);
    }

    const body = response.json() as ApiEnvelope<{
      assistant_message: {
        message_text: string;
        debug_json?: Record<string, unknown> | null;
      };
      session: {
        collected_json: Record<string, unknown>;
        current_flow: string;
        current_state: string;
      };
    }>;

    const assistant = body.data?.assistant_message;
    const debug = assistant?.debug_json ?? null;
    const toolsUsed = Array.isArray(debug?.tools_used) ? (debug.tools_used as string[]) : [];
    transcript.push({
      role: 'assistant',
      text: assistant?.message_text ?? '',
      latencyMs,
      toolsUsed,
      debug,
      latencyMetrics: (debug?.latency_metrics as Record<string, unknown> | undefined) ?? null,
    });

    if (body.data?.session.collected_json.appointment_id) {
      break;
    }
  }

  const appointmentId = (
    await sql<{ appointment_id: string | null }[]>`
      SELECT collected_json->>'appointment_id' AS appointment_id
      FROM conversation_sessions
      WHERE id = ${sessionId}
      LIMIT 1
    `
  )[0]?.appointment_id;

  await sql.end();
  await app.close();

  console.log(
    JSON.stringify(
      {
        mode: 'receptionist_agent_booking_smoke',
        skipped: false,
        provider: env.RECEPTIONIST_AGENT_PROVIDER,
        model: env.RECEPTIONIST_AGENT_MODEL,
        turn_budget_ms: env.RECEPTIONIST_AGENT_TURN_BUDGET_MS,
        per_call_timeout_ms: env.RECEPTIONIST_AGENT_TIMEOUT_MS,
        max_tokens: env.RECEPTIONIST_AGENT_MAX_TOKENS,
        max_tool_rounds: env.RECEPTIONIST_AGENT_MAX_TOOL_ROUNDS,
        clinic_id: clinicId,
        session_id: sessionId,
        friday_date: fridayDate,
        appointment_id: appointmentId,
        latency_ms: {
          per_turn: turnLatencies,
          total: turnLatencies.reduce((sum, value) => sum + value, 0),
          p95: turnLatencies.length > 0 ? Math.max(...turnLatencies) : 0,
        },
        transcript,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      mode: 'receptionist_agent_booking_smoke',
      error: error instanceof Error ? error.message : 'unknown_error',
    }),
  );
  process.exit(1);
});
