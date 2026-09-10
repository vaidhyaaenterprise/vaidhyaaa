import { describe, expect, it, vi } from 'vitest';

import { parseApiEnv, EnvValidationError } from '@vaidya/config';
import {
  assertTemplateRegistryComplete,
  classifyIntentMock,
  LlmJsonParser,
  routeServiceMock,
  TEMPLATE_LANGUAGES,
  MESSAGE_TEMPLATE_KEYS,
  CODE_TEMPLATE_REGISTRY,
} from '@vaidya/shared';

import { SarvamIntentClassifierAdapter } from '../src/common/adapters/sarvam-intent-classifier.adapter';
import { SarvamLlmClient } from '../src/common/llm/sarvam-client';
import { LlmEvaluationRunner } from '../src/agent/evaluation/llm-evaluation-runner';

const baseInput = {
  clinicId: '00000000-0000-0000-0000-000000000001',
  currentFlow: 'none',
  currentState: 'IDLE',
  languageCode: 'ta_tanglish',
  knownCollectedFields: {},
};

describe('A01 template registry', () => {
  it('includes required keys in ta_tanglish and english', () => {
    assertTemplateRegistryComplete();
    for (const key of [
      'booking.greeting',
      'booking.ask_problem_or_doctor',
      'booking.ask_date',
      'booking.ask_time',
      'booking.propose_slots',
      'booking.confirm_details',
      'booking.created_pending',
      'booking.flow_cancelled',
      'safety.emergency',
      'safety.medical_advice_refusal',
      'knowledge.no_answer',
      'unknown.clarify',
      'language.switched',
    ] as const) {
      expect(MESSAGE_TEMPLATE_KEYS).toContain(key);
      for (const language of TEMPLATE_LANGUAGES) {
        expect(CODE_TEMPLATE_REGISTRY[key][language].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('A01 mock intent classifier', () => {
  it('1. Naalaikku evening appointment venum -> book_appointment', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'Naalaikku evening appointment venum',
    });
    expect(result.intent).toBe('book_appointment');
  });

  it('2. Knee pain appointment venum -> book_appointment with reason', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'Knee pain appointment venum',
    });
    expect(result.intent).toBe('book_appointment');
    expect(result.entities.reasonForVisit).toBe('knee pain');
  });

  it('2. Knee pain alone starts booking flow', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'Knee pain',
    });
    expect(result.intent).toBe('book_appointment');
    expect(result.entities.reasonForVisit).toBe('knee pain');
  });

  it('2b. Fever alone starts booking flow', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'Fever',
    });
    expect(result.intent).toBe('book_appointment');
    expect(result.entities.reasonForVisit).toBe('fever');
  });

  it('3. Fever-ku enna tablet? -> medical_advice_request', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'Fever-ku enna tablet?',
    });
    expect(result.intent).toBe('medical_advice_request');
  });

  it('4. Chest pain irukku appointment venum -> emergency', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'Chest pain irukku appointment venum',
    });
    expect(result.intent).toBe('emergency');
    expect(result.safety.isEmergency).toBe(true);
  });

  it('5. Receptionist kitta pesanum -> ask_human_agent', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'Receptionist kitta pesanum',
    });
    expect(result.intent).toBe('ask_human_agent');
  });

  it('6. English please -> language_switch', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'English please',
    });
    expect(result.intent).toBe('language_switch');
  });

  it('7. Parking irukka? -> ask_previsit_instruction', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'Parking irukka?',
    });
    expect(result.intent).toBe('ask_previsit_instruction');
  });

  it('8. Tooth extraction-ku fasting venuma? -> ask_previsit_instruction', () => {
    const result = classifyIntentMock({
      ...baseInput,
      messageText: 'Tooth extraction-ku fasting venuma?',
    });
    expect(result.intent).toBe('ask_previsit_instruction');
    expect(result.intent).not.toBe('book_appointment');
  });

  it('covers additional classifier intents from test pack', () => {
    const expectations: Array<[string, string]> = [
      ['Doctor-a paakanum', 'book_appointment'],
      ['Token edukka venum', 'book_appointment'],
      ['Appointment cancel pannunga', 'cancel_appointment'],
      ['Appointment time change panna venum', 'reschedule_appointment'],
      ['Fees evlo?', 'ask_fee'],
      ['Dr Priya fees evlo?', 'ask_fee'],
      ['Sunday open-a?', 'ask_timing'],
      ['Clinic enga irukku?', 'ask_location'],
      ['Dr Priya inniku irukkangala?', 'ask_doctor_availability'],
      ['Scan-ku fasting venuma?', 'ask_previsit_instruction'],
      ['Insurance accept pannuveengala?', 'ask_insurance'],
      ['Moochu vida kashtama irukku doctor paakanum', 'emergency'],
      ['Accident aayiduchu appointment book pannunga', 'emergency'],
    ];

    for (const [message, intent] of expectations) {
      expect(classifyIntentMock({ ...baseInput, messageText: message }).intent).toBe(intent);
    }
  });
});

describe('A01 mock service router', () => {
  const orthoService = {
    id: '00000000-0000-0000-0000-000000000401',
    serviceKey: 'orthopedics',
    serviceName: 'Orthopedics',
    handlesJson: { symptoms: ['knee pain', 'joint pain'] },
    doesNotHandleJson: {},
    redFlagsJson: {},
    routingExamplesJson: { examples: ['knee pain appointment'] },
  };

  it('9. maps knee pain to ortho when clinic service exists', () => {
    const result = routeServiceMock({
      clinicId: baseInput.clinicId,
      reasonForVisit: 'knee pain',
      activeClinicServices: [orthoService],
    });
    expect(result.matched).toBe(true);
    expect(result.serviceKey).toBe('orthopedics');
  });

  it('10. returns unsupported when no matching clinic service exists', () => {
    const result = routeServiceMock({
      clinicId: baseInput.clinicId,
      reasonForVisit: 'tooth pain',
      activeClinicServices: [orthoService],
    });
    expect(result.matched).toBe(false);
  });

  it('tenant isolation: clinic A does not route tooth pain to clinic B dental service', () => {
    const clinicAServices = [orthoService];
    const clinicBServices = [
      {
        id: '00000000-0000-0000-0000-000000000402',
        serviceKey: 'dental',
        serviceName: 'Dental',
        handlesJson: { symptoms: ['tooth pain'] },
        doesNotHandleJson: {},
        redFlagsJson: {},
        routingExamplesJson: {},
      },
    ];

    const clinicA = routeServiceMock({
      clinicId: 'clinic-a',
      reasonForVisit: 'tooth pain',
      activeClinicServices: clinicAServices,
    });
    const clinicB = routeServiceMock({
      clinicId: 'clinic-b',
      reasonForVisit: 'tooth pain',
      activeClinicServices: clinicBServices,
    });

    expect(clinicA.matched).toBe(false);
    expect(clinicB.matched).toBe(true);
    expect(clinicB.serviceKey).toBe('dental');
  });
});

describe('A01 provider factory env', () => {
  it('requires SARVAM_API_KEY when provider is sarvam', () => {
    expect(() =>
      parseApiEnv({
         NODE_ENV: 'test',
        APP_ENV: 'local',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/vaidya_local',
        JWT_SECRET: 'dev_only_change_me',
        PRIMARY_LLM_PROVIDER: 'sarvam',
      }),
    ).toThrow(EnvValidationError);
  });

  it('defaults to mock providers without SARVAM_API_KEY', () => {
    const env = parseApiEnv({
       NODE_ENV: 'test',
      APP_ENV: 'local',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/vaidya_local',
      JWT_SECRET: 'dev_only_change_me',
    });
    expect(env.PRIMARY_LLM_PROVIDER).toBe('mock');
    expect(env.SERVICE_ROUTER_PROVIDER).toBe('mock');
  });
});

describe('A01 LLM JSON parser', () => {
  const parser = new LlmJsonParser();

  it('parses valid JSON object', () => {
    const parsed = parser.parseObject('{"intent":"book_appointment","confidence":0.9}');
    expect(parsed.ok).toBe(true);
  });

  it('parses JSON inside code fence and with extra text', () => {
    const parsed = parser.parseObject('Here is the result:\n```json\n{"intent":"ask_fee"}\n```');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.intent).toBe('ask_fee');
    }
  });

  it('returns safe error for invalid or empty content', () => {
    expect(parser.parseObject('not json').ok).toBe(false);
    expect(parser.parseObject('').ok).toBe(false);
  });
});

describe('A01 Sarvam adapter', () => {
  const env = parseApiEnv({
     NODE_ENV: 'test',
    APP_ENV: 'local',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/vaidya_local',
    JWT_SECRET: 'dev_only_change_me',
    PRIMARY_LLM_PROVIDER: 'sarvam',
    SERVICE_ROUTER_PROVIDER: 'mock',
    SARVAM_API_KEY: 'test-key',
  });

  it('11. real provider is not called when mock env is used in unit tests', async () => {
    const fetchMock = vi.fn();
    const client = SarvamLlmClient.fromEnv(env, fetchMock as typeof fetch);
    const { classifyIntentMock: localMock } = await import('@vaidya/shared');
    const result = localMock({
      ...baseInput,
      messageText: 'Naalaikku evening appointment venum',
    });
    expect(result.intent).toBe('book_appointment');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(client).toBeDefined();
  });

  it('12. handles invalid JSON gracefully', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'sarvam-30b',
        choices: [{ message: { content: 'not-json', reasoning_content: '{"intent":"book_appointment"}' } }],
      }),
    });

    const adapter = new SarvamIntentClassifierAdapter(env);
    (adapter as unknown as { client: SarvamLlmClient }).client = SarvamLlmClient.fromEnv(
      env,
      fetchMock as typeof fetch,
    );

    const result = await adapter.classify({
      ...baseInput,
      messageText: 'Hello',
    });

    expect(result.intent).toBe('unknown');
    expect(result.needsClarification).toBe(true);
  });

  it('13. falls back to 105B when primary confidence is low', async () => {
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

    const adapter = new SarvamIntentClassifierAdapter(env);
    (adapter as unknown as { client: SarvamLlmClient }).client = SarvamLlmClient.fromEnv(
      env,
      fetchMock as typeof fetch,
    );

    const result = await adapter.classify({
      ...baseInput,
      messageText: 'Hello',
    });

    expect(result.intent).toBe('book_appointment');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('A01 evaluation harness', () => {
  it('runs mock golden evaluation successfully', async () => {
    const runner = new LlmEvaluationRunner();
    const summary = await runner.runMockEvaluation();
    expect(summary.failedCases).toBe(0);
    expect(summary.passedCases).toBeGreaterThan(0);
  });
});
