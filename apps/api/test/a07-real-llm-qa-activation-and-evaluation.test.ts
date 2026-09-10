import { describe, expect, it, vi } from 'vitest';

import { EnvValidationError, parseApiEnv } from '@vaidya/config';
import {
  classifyIntentMock,
  extractStateEntitiesMock,
  isDeterministicStateEntityResult,
  LlmJsonParser,
  parseStateEntityExtractorJson,
  safeStateEntityFallback,
} from '@vaidya/shared';

import { SarvamIntentClassifierAdapter } from '../src/common/adapters/sarvam-intent-classifier.adapter';
import { SarvamStateEntityExtractorAdapter } from '../src/common/adapters/sarvam-state-entity-extractor.adapter';
import { SarvamLlmClient } from '../src/common/llm/sarvam-client';
import { LlmEvaluationRunner } from '../src/agent/evaluation/llm-evaluation-runner';
import { StateEntityExtractorEvaluationRunner } from '../src/agent/evaluation/state-entity-extractor-evaluation-runner';
import { loadStateExtractorGoldenCases } from '../src/agent/evaluation/state-extractor-golden-loader';
import { ActiveStateInterpretationService } from '../src/modules/conversation/active-state-interpretation.service';

const baseClassifierInput = {
  clinicId: '00000000-0000-0000-0000-000000000001',
  currentFlow: 'none',
  currentState: 'IDLE',
  languageCode: 'ta_tanglish',
  knownCollectedFields: {},
};

const sarvamEnv = parseApiEnv({
  NODE_ENV: 'test',
  APP_ENV: 'local',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/vaidya_local',
  JWT_SECRET: 'dev_only_change_me',
  PRIMARY_LLM_PROVIDER: 'sarvam',
  SERVICE_ROUTER_PROVIDER: 'mock',
  STATE_ENTITY_EXTRACTOR_PROVIDER: 'sarvam',
  SARVAM_API_KEY: 'test-key',
});

describe('A07 real LLM QA activation and evaluation', () => {
  describe('1. precondition mock evaluators pass', () => {
    it('mock classifier/router golden set passes', async () => {
      const runner = new LlmEvaluationRunner();
      const summary = await runner.runMockEvaluation();
      expect(summary.failedCases).toBe(0);
      expect(summary.passPercentage).toBeGreaterThanOrEqual(90);
      expect(summary.criticalSafetyMisses).toBe(0);
    });

    it('mock state extractor golden set passes', async () => {
      const runner = new StateEntityExtractorEvaluationRunner();
      const summary = await runner.runMockEvaluation();
      expect(summary.failedCases).toBe(0);
      expect(summary.passPercentage).toBeGreaterThanOrEqual(90);
      expect(summary.inventedSlotIdCount).toBe(0);
    });

    it('loads categorized golden dataset from JSON', () => {
      const cases = loadStateExtractorGoldenCases();
      expect(cases.length).toBeGreaterThanOrEqual(25);
      const categories = new Set(cases.map((testCase) => testCase.category));
      for (const category of [
        'booking_ask_date',
        'booking_ask_time',
        'booking_propose_slots',
        'booking_ask_patient_name',
        'booking_confirm_details',
        'cancel_confirm_request',
        'reschedule_ask_new_date',
        'reschedule_ask_new_time',
        'handoff_collect_reason_name_phone',
        'side_questions_inside_booking',
        'emergency_override_inside_flow',
        'medical_advice_override_inside_flow',
      ]) {
        expect(categories.has(category)).toBe(true);
      }
    });
  });

  describe('2. enable real Sarvam in QA only', () => {
    it('local defaults stay on mock without SARVAM_API_KEY', () => {
      const env = parseApiEnv({
        NODE_ENV: 'test',
        APP_ENV: 'local',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/vaidya_local',
        JWT_SECRET: 'dev_only_change_me',
      });
      expect(env.PRIMARY_LLM_PROVIDER).toBe('mock');
      expect(env.STATE_ENTITY_EXTRACTOR_PROVIDER).toBe('mock');
    });

    it('missing SARVAM_API_KEY fails startup when provider=sarvam', () => {
      expect(() =>
        parseApiEnv({
          NODE_ENV: 'development',
          APP_ENV: 'qa',
          DATABASE_URL:
            'postgresql://postgres.project-ref:password@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require',
          JWT_SECRET: 'dev_only_change_me',
          PRIMARY_LLM_PROVIDER: 'sarvam',
        }),
      ).toThrow(EnvValidationError);
    });

    it('real state extractor eval skips without SARVAM_API_KEY', async () => {
      const previous = process.env.SARVAM_API_KEY;
      delete process.env.SARVAM_API_KEY;
      const runner = new StateEntityExtractorEvaluationRunner();
      const summary = await runner.runRealEvaluation();
      expect(summary.skipped).toBe(true);
      if (previous) {
        process.env.SARVAM_API_KEY = previous;
      }
    });
  });

  describe('3. intent evaluation set', () => {
    const requiredPhrases: Array<[string, string]> = [
      ['Naalaikku evening appointment venum', 'book_appointment'],
      ['Knee pain irukku appointment venum', 'book_appointment'],
      ['Fever irukku doctor paakanum', 'book_appointment'],
      ['Fever-ku enna tablet?', 'medical_advice_request'],
      ['Chest pain irukku appointment venum', 'emergency'],
      ['Receptionist kitta pesanum', 'ask_human_agent'],
      ['Fees evlo?', 'ask_fee'],
      ['Dr Priya fees evlo?', 'ask_fee'],
      ['Sunday open-a?', 'ask_timing'],
      ['Clinic enga irukku?', 'ask_location'],
      ['Dr Priya inniku irukkangala?', 'ask_doctor_availability'],
      ['Scan-ku fasting venuma?', 'ask_previsit_instruction'],
      ['Tooth extraction-ku fasting venuma?', 'ask_previsit_instruction'],
      ['English please', 'language_switch'],
      ['Tamil-la pesunga', 'language_switch'],
      ['Appointment cancel pannunga', 'cancel_appointment'],
      ['Appointment time change panna venum', 'reschedule_appointment'],
    ];

    it.each(requiredPhrases)('classifies "%s" as %s', (messageText, intent) => {
      expect(classifyIntentMock({ ...baseClassifierInput, messageText }).intent).toBe(intent);
    });
  });

  describe('5. JSON reliability', () => {
    const parser = new LlmJsonParser();

    it('handles invalid JSON without throwing', () => {
      expect(parseStateEntityExtractorJson('not json')).toBeNull();
      const fallback = safeStateEntityFallback();
      expect(fallback.recognizedAs).toBe('unknown');
      expect(fallback.needsClarification).toBe(true);
      expect(parser.parseObject('not json').ok).toBe(false);
    });

    it('Sarvam classifier handles invalid JSON gracefully', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'sarvam-30b',
          choices: [{ message: { content: 'not-json' } }],
        }),
      });

      const adapter = new SarvamIntentClassifierAdapter(sarvamEnv);
      (adapter as unknown as { client: SarvamLlmClient }).client = SarvamLlmClient.fromEnv(
        sarvamEnv,
        fetchMock as typeof fetch,
      );

      const result = await adapter.classify({
        ...baseClassifierInput,
        messageText: 'Hello',
      });

      expect(result.intent).toBe('unknown');
      expect(result.needsClarification).toBe(true);
    });

    it('Sarvam state extractor handles invalid JSON gracefully', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'sarvam-30b',
          choices: [{ message: { content: 'not-json' } }],
        }),
      });

      const adapter = new SarvamStateEntityExtractorAdapter(sarvamEnv);
      (adapter as unknown as { client: SarvamLlmClient }).client = SarvamLlmClient.fromEnvForStateExtractor(
        sarvamEnv,
        fetchMock as typeof fetch,
      );

      const result = await adapter.extract({
        clinicId: baseClassifierInput.clinicId,
        sessionId: '00000000-0000-0000-0000-000000000099',
        currentFlow: 'booking',
        currentState: 'ASK_DATE',
        languageCode: 'ta_tanglish',
        messageText: 'some ambiguous phrase',
        timezone: 'Asia/Kolkata',
        referenceDate: '2026-05-16',
        collected: {},
        expectedFields: ['date'],
      });

      expect(result.recognizedAs).toBe('unknown');
      expect(result.needsClarification).toBe(true);
    });
  });

  describe('6. latency monitoring', () => {
    it('logs classification_ms from Sarvam client', async () => {
      const logSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'sarvam-30b',
          usage: { prompt_tokens: 12, completion_tokens: 8 },
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: 'book_appointment',
                  confidence: 0.92,
                  languageCode: 'ta_tanglish',
                  entities: {},
                  safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
                  needsClarification: false,
                }),
              },
            },
          ],
        }),
      });

      const client = SarvamLlmClient.fromEnv(sarvamEnv, fetchMock as typeof fetch);
      await client.chat({
        model: 'sarvam-30b',
        messages: [{ role: 'user', content: 'test' }],
      });

      const latencyLog = logSpy.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes('classification_ms'));
      expect(latencyLog).toBeTruthy();
      expect(latencyLog).toContain('"provider":"sarvam"');

      logSpy.mockRestore();
    });
  });

  describe('7. fallback model behavior', () => {
    it('calls fallback model when primary confidence is low', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            model: 'sarvam-30b',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    intent: 'unknown',
                    confidence: 0.2,
                    languageCode: 'ta_tanglish',
                    entities: {},
                    safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
                    needsClarification: true,
                  }),
                },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            model: 'sarvam-105b',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    intent: 'book_appointment',
                    confidence: 0.91,
                    languageCode: 'ta_tanglish',
                    entities: {},
                    safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
                    needsClarification: false,
                  }),
                },
              },
            ],
          }),
        });

      const adapter = new SarvamIntentClassifierAdapter(sarvamEnv);
      (adapter as unknown as { client: SarvamLlmClient }).client = SarvamLlmClient.fromEnv(
        sarvamEnv,
        fetchMock as typeof fetch,
      );

      const result = await adapter.classify({
        ...baseClassifierInput,
        messageText: 'Naalaikku evening appointment venum',
      });

      expect(result.intent).toBe('book_appointment');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('8. no active-state LLM overuse', () => {
    const deterministicMessages = ['6:30', 'Kumar', 'Seri', 'vendam', 'inniku', 'naalaikku', 'May 16 2026', 'morning', 'evening'];
    const extractorBase = {
      clinicId: baseClassifierInput.clinicId,
      sessionId: '00000000-0000-0000-0000-000000000088',
      currentFlow: 'booking',
      languageCode: 'ta_tanglish',
      timezone: 'Asia/Kolkata',
      referenceDate: '2026-05-16',
      collected: {},
      expectedFields: ['date'],
    };

    it.each(deterministicMessages)('deterministic parser handles "%s" without LLM', (messageText) => {
      const state =
        messageText === '6:30' || messageText === 'morning' || messageText === 'evening'
          ? 'ASK_TIME'
          : messageText === 'Kumar'
            ? 'ASK_PATIENT_NAME'
            : messageText === 'Seri' || messageText === 'vendam'
              ? 'CONFIRM_DETAILS'
              : 'ASK_DATE';

      const result = extractStateEntitiesMock({
        ...extractorBase,
        currentState: state,
        messageText,
        ...(state === 'ASK_TIME' ? { expectedFields: ['timePreference'] } : {}),
        ...(state === 'ASK_PATIENT_NAME' ? { expectedFields: ['patientName'] } : {}),
      });

      expect(isDeterministicStateEntityResult(result)).toBe(true);
    });

    it('ActiveStateInterpretationService always calls extractor with Sarvam provider', async () => {
      const extractSpy = vi.fn().mockResolvedValue({
        recognizedAs: 'date_answer',
        confidence: 0.92,
        entities: { date: '2026-06-17' },
        needsClarification: false,
      });
      const env = parseApiEnv({
        NODE_ENV: 'test',
        APP_ENV: 'local',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/vaidya_test',
        JWT_SECRET: 'test-secret',
        STATE_ENTITY_EXTRACTOR_PROVIDER: 'sarvam',
        SARVAM_API_KEY: 'test-key',
      });

      const service = new ActiveStateInterpretationService(
        { extract: extractSpy } as unknown as import('@vaidya/shared').StateEntityExtractorAdapter,
        { log: vi.fn() } as unknown as import('../src/modules/conversation/active-state-interpretation.service').ActiveStateInterpretationLogger,
        env,
      );

      const interpretation = await service.interpret({
        clinicId: extractorBase.clinicId,
        sessionId: extractorBase.sessionId,
        currentFlow: 'booking',
        currentState: 'ASK_DATE',
        languageCode: 'ta_tanglish',
        messageText: 'inniku',
        timezone: 'Asia/Kolkata',
        collected: {},
      });

      expect(extractSpy).toHaveBeenCalledTimes(1);
      expect(interpretation.debug.deterministic_parser_used).toBe(false);
      expect(interpretation.debug.llm_call_skipped).toBe(false);
      expect(interpretation.result.recognizedAs).toBe('date_answer');
    });
  });

  describe('safety thresholds in golden dataset', () => {
    it('emergency override category passes at 100%', async () => {
      const runner = new StateEntityExtractorEvaluationRunner();
      const summary = await runner.runMockEvaluation();
      const emergency = summary.categoryPassRates.emergency_override_inside_flow;
      expect(emergency?.passed).toBe(emergency?.total);
    });

    it('medical advice override category passes at 100%', async () => {
      const runner = new StateEntityExtractorEvaluationRunner();
      const summary = await runner.runMockEvaluation();
      const medical = summary.categoryPassRates.medical_advice_override_inside_flow;
      expect(medical?.passed).toBe(medical?.total);
    });
  });
});
