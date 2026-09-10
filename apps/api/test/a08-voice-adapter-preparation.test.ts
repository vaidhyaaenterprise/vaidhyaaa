import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import { parseApiEnv } from '@vaidya/config';
import {
  ADAPTER_TOKENS,
  apiSuccessBodySchema,
  VOICE_RUNTIME_DEFAULTS,
} from '@vaidya/shared';

import {
  MockSttProvider,
  MockTelephonyProvider,
  MockTtsProvider,
} from '../src/common/adapters/mock-adapters';

import { MockVoiceAdapter } from '../src/common/adapters/mock-voice-adapter';
import { CallRecordingStorageService } from '../src/modules/voice/call-recording-storage.service';
import { VoiceAnsweringPolicyService } from '../src/modules/voice/voice-answering-policy.service';
import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { SEED } from './test-constants';

const PROVIDER_NUMBER = '+914400000100';
const FALLBACK_PHONE = '+919840000000';

async function upsertTelephony(sql: postgres.Sql) {
  await sql`
    INSERT INTO clinic_telephony_settings (
      clinic_id, provider, provider_number, fallback_phone, recording_enabled, active
    )
    VALUES (
      ${SEED.CLINIC_ID}, 'mock', ${PROVIDER_NUMBER}, ${FALLBACK_PHONE}, true, true
    )
    ON CONFLICT (clinic_id, provider, provider_number) DO UPDATE
    SET fallback_phone = EXCLUDED.fallback_phone, active = true
  `;
}

async function setClinicVoiceSettings(
  sql: postgres.Sql,
  values: {
    agent_enabled: boolean;
    answering_mode: string;
    fallback_phone?: string;
  },
) {
  await sql`
    UPDATE clinic_settings
    SET
      agent_enabled = ${values.agent_enabled},
      answering_mode = ${values.answering_mode},
      fallback_phone = ${values.fallback_phone ?? FALLBACK_PHONE}
    WHERE clinic_id = ${SEED.CLINIC_ID}
  `;
}

describe('A08 voice adapter preparation', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5433/vaidya_test';
    process.env.QUEUE_MODE = 'inline';
    process.env.NODE_ENV = 'test';
    delete process.env.REDIS_URL;

    await prepareTestDatabase();
    app = await createTestApp();
    sql = postgres(process.env.DATABASE_URL, { max: 5 });
    await upsertTelephony(sql);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (sql) {
      await sql.end({ timeout: 5 });
    }
  });

  describe('1. provider interfaces', () => {
    it('registers mock telephony, STT, TTS, voice adapter, and recording storage', () => {
      expect(app.get(ADAPTER_TOKENS.TelephonyProvider)).toBeInstanceOf(MockTelephonyProvider);
      expect(app.get(ADAPTER_TOKENS.SttProvider)).toBeInstanceOf(MockSttProvider);
      expect(app.get(ADAPTER_TOKENS.TtsProvider)).toBeInstanceOf(MockTtsProvider);
      expect(app.get(ADAPTER_TOKENS.VoiceAdapter)).toBeInstanceOf(MockVoiceAdapter);
      expect(app.get(ADAPTER_TOKENS.CallRecordingStorage)).toBeInstanceOf(CallRecordingStorageService);
    });

    it('defaults voice providers to mock without external API keys', () => {
      const env = parseApiEnv({
        NODE_ENV: 'test',
        APP_ENV: 'local',
        DATABASE_URL: process.env.DATABASE_URL!,
        JWT_SECRET: 'test-secret',
      });
      expect(env.STT_PROVIDER).toBe('mock');
      expect(env.TTS_PROVIDER).toBe('mock');
      expect(env.TELEPHONY_PROVIDER).toBe('mock');
    });
  });

  describe('7. timeout/failure placeholders', () => {
    it('exposes voice runtime constants and env overrides', () => {
      expect(VOICE_RUNTIME_DEFAULTS.silence_timeout_seconds).toBe(5);
      expect(VOICE_RUNTIME_DEFAULTS.no_speech_retry_count).toBe(2);
      expect(VOICE_RUNTIME_DEFAULTS.max_call_duration_seconds).toBe(300);
      expect(VOICE_RUNTIME_DEFAULTS.stt_low_confidence_threshold).toBe(0.55);
      expect(VOICE_RUNTIME_DEFAULTS.llm_timeout_ms).toBe(5000);
      expect(VOICE_RUNTIME_DEFAULTS.tts_timeout_ms).toBe(8000);

      const env = parseApiEnv({
        NODE_ENV: 'test',
        APP_ENV: 'local',
        DATABASE_URL: process.env.DATABASE_URL!,
        JWT_SECRET: 'test-secret',
        VOICE_SILENCE_TIMEOUT_SECONDS: '7',
        VOICE_NO_SPEECH_RETRY_COUNT: '3',
        VOICE_MAX_CALL_DURATION_SECONDS: '240',
        VOICE_STT_LOW_CONFIDENCE_THRESHOLD: '0.6',
        VOICE_TTS_TIMEOUT_MS: '5000',
      });

      expect(env.VOICE_SILENCE_TIMEOUT_SECONDS).toBe(7);
      expect(env.VOICE_NO_SPEECH_RETRY_COUNT).toBe(3);
      expect(env.VOICE_MAX_CALL_DURATION_SECONDS).toBe(240);
      expect(env.VOICE_STT_LOW_CONFIDENCE_THRESHOLD).toBe(0.6);
      expect(env.VOICE_TTS_TIMEOUT_MS).toBe(5000);
      expect(env.LLM_TIMEOUT_MS).toBe(20000);
      expect(env.LLM_FAST_TIMEOUT_MS).toBe(5000);
      expect(env.LLM_LATENCY_MODE).toBe('auto');
    });
  });

  describe('2. agent off behavior', () => {
    it('forwards incoming call when agent_enabled=false', async () => {
      await setClinicVoiceSettings(sql, {
        agent_enabled: false,
        answering_mode: 'always_on',
      });

      const forwardSpy = vi.spyOn(app.get(ADAPTER_TOKENS.TelephonyProvider), 'forwardCall');

      const response = await app.inject({
        method: 'POST',
        url: '/v1/voice/calls/incoming',
        payload: {
          provider: 'mock',
          provider_call_id: 'a08_agent_off_1',
          provider_number: PROVIDER_NUMBER,
          caller_phone: '+919888880001',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = apiSuccessBodySchema.parse(response.json());
      const data = body.data as {
        action: string;
        forward_to: string;
        session_id: string | null;
        call_id: string;
      };

      expect(data.action).toBe('forward');
      expect(data.forward_to).toBe(FALLBACK_PHONE);
      expect(data.session_id).toBeNull();
      expect(forwardSpy).toHaveBeenCalled();

      const [call] = await sql`
        SELECT outcome, session_id FROM calls WHERE id = ${data.call_id}
      `;
      expect(call?.outcome).toBe('forwarded');
      expect(call?.session_id).toBeNull();

      const sessions = await sql`
        SELECT count(*)::int AS count
        FROM conversation_sessions
        WHERE patient_phone = '+919888880001' AND channel = 'voice_call'
      `;
      expect(sessions[0]?.count).toBe(0);

      forwardSpy.mockRestore();
    });
  });

  describe('3. answering modes', () => {
    const policy = () => app.get(VoiceAnsweringPolicyService);

    it('always_on answers when agent is enabled', async () => {
      await setClinicVoiceSettings(sql, { agent_enabled: true, answering_mode: 'always_on' });
      const decision = await policy().evaluate({
        clinicId: SEED.CLINIC_ID,
        agentEnabled: true,
        answeringMode: 'always_on',
        fallbackPhone: FALLBACK_PHONE,
      });
      expect(decision.shouldAnswer).toBe(true);
    });

    it('off mode forwards', async () => {
      const decision = await policy().evaluate({
        clinicId: SEED.CLINIC_ID,
        agentEnabled: true,
        answeringMode: 'off',
        fallbackPhone: FALLBACK_PHONE,
      });
      expect(decision.shouldAnswer).toBe(false);
      expect(decision.reason).toBe('answering_mode_off');
    });

    it('overflow_after_n_rings answers only after provider overflow forward', async () => {
      const blocked = await policy().evaluate({
        clinicId: SEED.CLINIC_ID,
        agentEnabled: true,
        answeringMode: 'overflow_after_n_rings',
        fallbackPhone: FALLBACK_PHONE,
        overflowForwarded: false,
      });
      expect(blocked.shouldAnswer).toBe(false);

      const allowed = await policy().evaluate({
        clinicId: SEED.CLINIC_ID,
        agentEnabled: true,
        answeringMode: 'overflow_after_n_rings',
        fallbackPhone: FALLBACK_PHONE,
        overflowForwarded: true,
      });
      expect(allowed.shouldAnswer).toBe(true);
    });

    it('after_hours_only and holiday_only modes are evaluated from clinic schedule', async () => {
      const afterHours = await policy().evaluate({
        clinicId: SEED.CLINIC_ID,
        agentEnabled: true,
        answeringMode: 'after_hours_only',
        fallbackPhone: FALLBACK_PHONE,
      });
      expect(typeof afterHours.shouldAnswer).toBe('boolean');

      await sql`
        DELETE FROM clinic_holidays
        WHERE clinic_id = ${SEED.CLINIC_ID}
          AND holiday_date = CURRENT_DATE
      `;
      await sql`
        INSERT INTO clinic_holidays (clinic_id, holiday_date, is_full_day, active, reason)
        VALUES (${SEED.CLINIC_ID}, CURRENT_DATE, true, true, 'A08 test holiday')
      `;

      const holidayOnly = await policy().evaluate({
        clinicId: SEED.CLINIC_ID,
        agentEnabled: true,
        answeringMode: 'holiday_only',
        fallbackPhone: FALLBACK_PHONE,
      });
      expect(holidayOnly.shouldAnswer).toBe(true);
    });
  });

  describe('milestone incoming + lifecycle', () => {
    it('2. agent_enabled=true creates call and conversation session', async () => {
      await setClinicVoiceSettings(sql, { agent_enabled: true, answering_mode: 'always_on' });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/voice/calls/incoming',
        payload: {
          provider: 'mock',
          provider_call_id: 'a08_answer_1',
          provider_number: PROVIDER_NUMBER,
          caller_phone: '+919888880002',
        },
      });

      expect(response.statusCode).toBe(201);
      const data = apiSuccessBodySchema.parse(response.json()).data as {
        action: string;
        call_id: string;
        session_id: string;
        greeting_text: string;
      };

      expect(data.action).toBe('answer');
      expect(data.greeting_text.length).toBeGreaterThan(0);

      const [call] = await sql`
        SELECT outcome, session_id, transcript_expires_at
        FROM calls WHERE id = ${data.call_id}
      `;
      expect(call?.outcome).toBe('answered');
      expect(call?.session_id).toBe(data.session_id);
      expect(call?.transcript_expires_at).toBeTruthy();

      const [session] = await sql`
        SELECT channel FROM conversation_sessions WHERE id = ${data.session_id}
      `;
      expect(session?.channel).toBe('voice_call');
    });

    it('3. transcript turn reuses text-core conversation service', async () => {
      await setClinicVoiceSettings(sql, { agent_enabled: true, answering_mode: 'always_on' });

      const incoming = await app.inject({
        method: 'POST',
        url: '/v1/voice/calls/incoming',
        payload: {
          provider: 'mock',
          provider_call_id: 'a08_transcript_1',
          provider_number: PROVIDER_NUMBER,
          caller_phone: '+919888880003',
        },
      });
      const { call_id: callId, session_id: sessionId } = apiSuccessBodySchema.parse(incoming.json())
        .data as { call_id: string; session_id: string };

      const turn = await app.inject({
        method: 'POST',
        url: `/v1/voice/calls/${callId}/transcript-turn`,
        payload: {
          transcript_text: 'Fever appointment venum',
          speaker: 'patient',
          idempotency_key: 'a08_voice_turn_1',
        },
      });

      expect(turn.statusCode).toBe(201);
      const turnData = apiSuccessBodySchema.parse(turn.json()).data as {
        patient_message: { message_text: string };
        assistant_message: { message_text: string };
      };
      expect(turnData.patient_message.message_text).toBe('Fever appointment venum');
      expect(turnData.assistant_message.message_text.length).toBeGreaterThan(0);

      const messages = await sql`
        SELECT sender, message_text
        FROM conversation_messages
        WHERE session_id = ${sessionId}
        ORDER BY created_at ASC
      `;
      expect(messages.length).toBeGreaterThanOrEqual(2);
      expect(messages.some((row) => row.sender === 'patient')).toBe(true);
      expect(messages.some((row) => row.sender === 'assistant')).toBe(true);

      const transcripts = await sql`
        SELECT speaker, transcript_text FROM call_transcripts WHERE call_id = ${callId}
      `;
      expect(transcripts).toHaveLength(1);
      expect(transcripts[0]?.transcript_text).toBe('Fever appointment venum');
    });

    it('4. emergency transcript links emergency incident to call', async () => {
      await setClinicVoiceSettings(sql, { agent_enabled: true, answering_mode: 'always_on' });

      const incoming = await app.inject({
        method: 'POST',
        url: '/v1/voice/calls/incoming',
        payload: {
          provider: 'mock',
          provider_call_id: 'a08_emergency_1',
          provider_number: PROVIDER_NUMBER,
          caller_phone: '+919888880004',
        },
      });
      const { call_id: callId, session_id: sessionId } = apiSuccessBodySchema.parse(incoming.json())
        .data as { call_id: string; session_id: string };

      const turn = await app.inject({
        method: 'POST',
        url: `/v1/voice/calls/${callId}/transcript-turn`,
        payload: {
          transcript_text: 'chest pain irukku',
          speaker: 'patient',
          idempotency_key: 'a08_voice_emergency_1',
        },
      });

      expect(turn.statusCode).toBe(201);
      const assistant = (
        apiSuccessBodySchema.parse(turn.json()).data as {
          assistant_message: { reply_template_key: string | null };
        }
      ).assistant_message;
      expect(assistant.reply_template_key).toBe('safety.emergency');

      const [incident] = await sql`
        SELECT source_call_id, source_session_id
        FROM emergency_incidents
        WHERE source_session_id = ${sessionId}
        ORDER BY created_at DESC
        LIMIT 1
      `;
      expect(incident?.source_call_id).toBe(callId);
    });

    it('5. recording-ready stores metadata outside Postgres with expiry', async () => {
      await setClinicVoiceSettings(sql, { agent_enabled: true, answering_mode: 'always_on' });

      const incoming = await app.inject({
        method: 'POST',
        url: '/v1/voice/calls/incoming',
        payload: {
          provider: 'mock',
          provider_call_id: 'a08_recording_1',
          provider_number: PROVIDER_NUMBER,
          caller_phone: '+919888880005',
        },
      });
      const { call_id: callId } = apiSuccessBodySchema.parse(incoming.json()).data as { call_id: string };

      const recording = await app.inject({
        method: 'POST',
        url: `/v1/voice/calls/${callId}/recording-ready`,
        payload: {
          storage_key: 'call-recording.mp3',
          content_type: 'audio/mpeg',
          size_bytes: 4096,
        },
      });

      expect(recording.statusCode).toBe(201);
      const recordingData = apiSuccessBodySchema.parse(recording.json()).data as {
        recording_storage_key: string;
        recording_url: string;
        recording_expires_at: string;
      };

      expect(recordingData.recording_storage_key).toContain('recordings/');
      expect(recordingData.recording_url).toContain('mock-storage.local');

      const [call] = await sql`
        SELECT recording_storage_key, recording_expires_at, recording_url
        FROM calls WHERE id = ${callId}
      `;
      expect(call?.recording_storage_key).toBe(recordingData.recording_storage_key);
      expect(call?.recording_url).toBeTruthy();
      expect(call?.recording_expires_at).toBeTruthy();

      const startedAt = new Date((await sql`SELECT started_at FROM calls WHERE id = ${callId}`)[0]!.started_at);
      const expiresAt = new Date(call!.recording_expires_at!);
      const diffDays = (expiresAt.getTime() - startedAt.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThanOrEqual(9.9);
      expect(diffDays).toBeLessThanOrEqual(10.1);
    });

    it('6. call ended event updates duration and outcome', async () => {
      await setClinicVoiceSettings(sql, { agent_enabled: true, answering_mode: 'always_on' });

      const incoming = await app.inject({
        method: 'POST',
        url: '/v1/voice/calls/incoming',
        payload: {
          provider: 'mock',
          provider_call_id: 'a08_end_1',
          provider_number: PROVIDER_NUMBER,
          caller_phone: '+919888880006',
        },
      });
      const { call_id: callId } = apiSuccessBodySchema.parse(incoming.json()).data as { call_id: string };

      const ended = await app.inject({
        method: 'POST',
        url: `/v1/voice/calls/${callId}/events`,
        payload: {
          event_type: 'call_ended',
          outcome: 'completed',
          duration_seconds: 95,
          summary: 'Booking started',
        },
      });

      expect(ended.statusCode).toBe(201);

      const [call] = await sql`
        SELECT outcome, duration_seconds, ended_at, summary
        FROM calls WHERE id = ${callId}
      `;
      expect(call?.outcome).toBe('completed');
      expect(call?.duration_seconds).toBe(95);
      expect(call?.ended_at).toBeTruthy();
      expect(call?.summary).toBe('Booking started');
    });

    it('rejects low STT confidence without invoking text-core', async () => {
      await setClinicVoiceSettings(sql, { agent_enabled: true, answering_mode: 'always_on' });

      const incoming = await app.inject({
        method: 'POST',
        url: '/v1/voice/calls/incoming',
        payload: {
          provider: 'mock',
          provider_call_id: 'a08_low_stt_1',
          provider_number: PROVIDER_NUMBER,
          caller_phone: '+919888880007',
        },
      });
      const { call_id: callId, session_id: sessionId } = apiSuccessBodySchema.parse(incoming.json())
        .data as { call_id: string; session_id: string };

      const beforeCount = await sql`
        SELECT count(*)::int AS count FROM conversation_messages WHERE session_id = ${sessionId}
      `;

      const turn = await app.inject({
        method: 'POST',
        url: `/v1/voice/calls/${callId}/transcript-turn`,
        payload: {
          transcript_text: 'unclear mumble',
          stt_confidence: 0.2,
        },
      });

      const turnData = apiSuccessBodySchema.parse(turn.json()).data as { action: string };
      expect(turnData.action).toBe('repeat_prompt');

      const afterCount = await sql`
        SELECT count(*)::int AS count FROM conversation_messages WHERE session_id = ${sessionId}
      `;
      expect(afterCount[0]?.count).toBe(beforeCount[0]?.count);
    });
  });

  describe('6. transcript retention', () => {
    it('sets transcript_expires_at using 30-day clinic policy', async () => {
      await setClinicVoiceSettings(sql, { agent_enabled: true, answering_mode: 'always_on' });
      await sql`
        UPDATE clinic_settings
        SET transcript_retention_days = 30
        WHERE clinic_id = ${SEED.CLINIC_ID}
      `;

      const incoming = await app.inject({
        method: 'POST',
        url: '/v1/voice/calls/incoming',
        payload: {
          provider: 'mock',
          provider_call_id: 'a08_retention_1',
          provider_number: PROVIDER_NUMBER,
          caller_phone: '+919888880008',
        },
      });
      const { call_id: callId } = apiSuccessBodySchema.parse(incoming.json()).data as { call_id: string };

      const [call] = await sql`
        SELECT started_at, transcript_expires_at FROM calls WHERE id = ${callId}
      `;
      const startedAt = new Date(call!.started_at!);
      const expiresAt = new Date(call!.transcript_expires_at!);
      const diffDays = (expiresAt.getTime() - startedAt.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThanOrEqual(29.9);
      expect(diffDays).toBeLessThanOrEqual(30.1);
    });
  });
});
