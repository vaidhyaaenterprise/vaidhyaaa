import {
  detectMessageSafety,
  extractStateEntitiesMock,
  type StateEntityExtractorInput,
  type StateEntityExtractorResult,
} from '@vaidya/shared';

import {
  loadStateExtractorGoldenCases,
  type StateExtractorGoldenCase,
  type StateExtractorGoldenExpected,
} from './state-extractor-golden-loader';
import { computeLatencyStats } from './evaluation-report';

export type StateExtractorEvaluationResult = {
  id: string;
  category: string;
  passed: boolean;
  expected?: string;
  actual?: string;
  latencyMs?: number;
  inventedSlotId?: boolean;
  safetyPreempted?: boolean;
};

export type StateExtractorEvaluationReport = {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passPercentage: number;
  latency: ReturnType<typeof computeLatencyStats>;
  failuresByCategory: Record<string, number>;
  invalidJsonCount: number;
  fallbackModelCount: number;
  timeoutCount: number;
  inventedSlotIdCount: number;
  genericClassifierMistakenlyCalledCount: number;
  categoryPassRates: Record<string, { passed: number; total: number }>;
  results: StateExtractorEvaluationResult[];
  skipped: boolean;
};

export type StateExtractorEvalMetrics = {
  invalidJsonCount: number;
  fallbackModelCount: number;
  timeoutCount: number;
};

function baseInput(
  testCase: StateExtractorGoldenCase,
): StateEntityExtractorInput {
  return {
    clinicId: '00000000-0000-0000-0000-000000000001',
    sessionId: '00000000-0000-0000-0000-000000000002',
    currentFlow: testCase.currentFlow,
    currentState: testCase.currentState,
    languageCode: 'ta_tanglish',
    messageText: testCase.messageText,
    timezone: testCase.timezone ?? 'Asia/Kolkata',
    referenceDate: testCase.referenceDate ?? '2026-05-16',
    collected: testCase.collected ?? {},
    expectedFields: [],
    ...(testCase.offeredSlots ? { offeredSlots: testCase.offeredSlots } : {}),
  };
}

function hasInventedSlotId(
  result: StateEntityExtractorResult,
  offeredSlots?: StateEntityExtractorInput['offeredSlots'],
): boolean {
  const slotId = result.entities.selectedSlotId;
  if (!slotId) {
    return false;
  }
  if (!offeredSlots?.length) {
    return true;
  }
  return !offeredSlots.some((slot) => slot.slotId === slotId);
}

function matchesExpected(
  actual: StateEntityExtractorResult,
  expected: StateExtractorGoldenExpected,
): boolean {
  if (actual.recognizedAs !== expected.recognizedAs) {
    return false;
  }
  if (
    expected.needsClarification !== undefined &&
    actual.needsClarification !== expected.needsClarification
  ) {
    return false;
  }
  if (expected.entities) {
    for (const [key, value] of Object.entries(expected.entities)) {
      const actualValue = actual.entities[key as keyof typeof actual.entities];
      if (actualValue !== value) {
        return false;
      }
    }
  }
  return true;
}

function evaluateSafetyPreempted(testCase: StateExtractorGoldenCase): boolean {
  const safety = detectMessageSafety(testCase.messageText);
  if (testCase.safetyPreempted === 'emergency') {
    return safety.isEmergency;
  }
  if (testCase.safetyPreempted === 'medical_advice') {
    return safety.isMedicalAdviceRequest;
  }
  return false;
}

export class StateEntityExtractorEvaluationRunner {
  constructor(
    private readonly cases: StateExtractorGoldenCase[] = loadStateExtractorGoldenCases(),
  ) {}

  async evaluateWithExtractor(
    extract: (input: StateEntityExtractorInput) => Promise<StateEntityExtractorResult>,
    metrics: StateExtractorEvalMetrics = {
      invalidJsonCount: 0,
      fallbackModelCount: 0,
      timeoutCount: 0,
    },
  ): Promise<StateExtractorEvaluationReport> {
    const results: StateExtractorEvaluationResult[] = [];
    const latenciesMs: number[] = [];
    const failuresByCategory: Record<string, number> = {};
    const categoryPassRates: Record<string, { passed: number; total: number }> = {};
    let inventedSlotIdCount = 0;

    for (const testCase of this.cases) {
      const categoryStats = categoryPassRates[testCase.category] ?? { passed: 0, total: 0 };
      categoryStats.total += 1;
      categoryPassRates[testCase.category] = categoryStats;

      if (testCase.safetyPreempted) {
        const passed = evaluateSafetyPreempted(testCase);
        if (!passed) {
          failuresByCategory[testCase.category] = (failuresByCategory[testCase.category] ?? 0) + 1;
        } else {
          categoryStats.passed += 1;
        }
        results.push({
          id: testCase.id,
          category: testCase.category,
          passed,
          safetyPreempted: true,
          expected: testCase.safetyPreempted,
          actual: passed ? testCase.safetyPreempted : 'missed',
        });
        continue;
      }

      const started = Date.now();
      const actual = await extract(baseInput(testCase));
      const latencyMs = Date.now() - started;
      latenciesMs.push(latencyMs);

      const inventedSlotId = hasInventedSlotId(actual, testCase.offeredSlots);
      if (inventedSlotId) {
        inventedSlotIdCount += 1;
      }

      const passed =
        !!testCase.expected &&
        matchesExpected(actual, testCase.expected) &&
        !inventedSlotId;

      if (!passed) {
        failuresByCategory[testCase.category] = (failuresByCategory[testCase.category] ?? 0) + 1;
      } else {
        categoryStats.passed += 1;
      }

      results.push({
        id: testCase.id,
        category: testCase.category,
        passed,
        ...(testCase.expected?.recognizedAs ? { expected: testCase.expected.recognizedAs } : {}),
        actual: actual.recognizedAs,
        latencyMs,
        ...(inventedSlotId ? { inventedSlotId: true } : {}),
      });
    }

    const passedCases = results.filter((result) => result.passed).length;
    const totalCases = results.length;

    return {
      totalCases,
      passedCases,
      failedCases: totalCases - passedCases,
      passPercentage: totalCases === 0 ? 0 : Math.round((passedCases / totalCases) * 1000) / 10,
      latency: computeLatencyStats(latenciesMs),
      failuresByCategory,
      invalidJsonCount: metrics.invalidJsonCount,
      fallbackModelCount: metrics.fallbackModelCount,
      timeoutCount: metrics.timeoutCount,
      inventedSlotIdCount,
      genericClassifierMistakenlyCalledCount: 0,
      categoryPassRates,
      results,
      skipped: false,
    };
  }

  runMockEvaluation() {
    return this.evaluateWithExtractor(async (input) => extractStateEntitiesMock(input));
  }

  async runRealEvaluation(): Promise<StateExtractorEvaluationReport> {
    if (!process.env.SARVAM_API_KEY) {
      return {
        totalCases: 0,
        passedCases: 0,
        failedCases: 0,
        passPercentage: 0,
        latency: computeLatencyStats([]),
        failuresByCategory: {},
        invalidJsonCount: 0,
        fallbackModelCount: 0,
        timeoutCount: 0,
        inventedSlotIdCount: 0,
        genericClassifierMistakenlyCalledCount: 0,
        categoryPassRates: {},
        results: [],
        skipped: true,
      };
    }

    const { parseApiEnv } = await import('@vaidya/config');
    const { SarvamStateEntityExtractorAdapter } = await import(
      '../../common/adapters/sarvam-state-entity-extractor.adapter'
    );

    const metrics: StateExtractorEvalMetrics = {
      invalidJsonCount: 0,
      fallbackModelCount: 0,
      timeoutCount: 0,
    };

    const env = parseApiEnv(process.env);
    const adapter = new SarvamStateEntityExtractorAdapter(env);
    return this.evaluateWithExtractor((input) => adapter.extract(input), metrics);
  }
}

export { STATE_EXTRACTOR_GOLDEN_CASES } from './state-extractor-golden-cases';
