import {
  classifyIntentMock,
  extractStateEntitiesMock,
  routeServiceMock,
  type CapabilityEvaluationCase,
  type CapabilityEvaluationReport,
  type IntentClassifierInput,
  type IntentClassifierResult,
  type ServiceRouterInput,
  type StateEntityExtractorInput,
} from '@vaidya/shared';

import {
  buildReceptionistCapabilityGoldenCases,
  RECEPTIONIST_CAPABILITY_GOLDEN_CASES,
} from './receptionist-capability-golden';

export type CapabilityEvaluationOptions = {
  sample?: boolean;
  maxPerCategory?: number;
};

function baseClassifierInput(partial: Record<string, unknown>): IntentClassifierInput {
  return {
    clinicId: '00000000-0000-0000-0000-000000000001',
    messageText: String(partial.messageText ?? ''),
    currentFlow: 'none',
    currentState: 'IDLE',
    languageCode: String(partial.languageCode ?? 'ta_tanglish'),
    knownCollectedFields: {},
  };
}

function baseStateInput(testCase: CapabilityEvaluationCase): StateEntityExtractorInput {
  return {
    clinicId: '00000000-0000-0000-0000-000000000001',
    sessionId: '00000000-0000-0000-0000-000000000099',
    currentFlow: String(testCase.currentFlow ?? 'booking'),
    currentState: String(testCase.currentState ?? 'ASK_DATE'),
    languageCode: 'ta_tanglish',
    messageText: String(testCase.messageText ?? testCase.input.messageText ?? ''),
    timezone: 'Asia/Kolkata',
    referenceDate: testCase.referenceDate ?? '2026-05-16',
    collected: {},
    expectedFields: [],
    ...(testCase.offeredSlots ? { offeredSlots: testCase.offeredSlots } : {}),
  };
}

export function selectCapabilityCases(
  cases: CapabilityEvaluationCase[],
  options: CapabilityEvaluationOptions = {},
): CapabilityEvaluationCase[] {
  if (!options.sample) {
    return cases;
  }

  const maxPerCategory = options.maxPerCategory ?? 3;
  const grouped = new Map<string, CapabilityEvaluationCase[]>();
  for (const testCase of cases) {
    const bucket = grouped.get(testCase.category) ?? [];
    bucket.push(testCase);
    grouped.set(testCase.category, bucket);
  }

  const selected: CapabilityEvaluationCase[] = [];
  for (const bucket of grouped.values()) {
    selected.push(...bucket.slice(0, maxPerCategory));
  }
  return selected;
}

export class AgentCapabilityEvaluationRunner {
  async runMockEvaluation(
    options: CapabilityEvaluationOptions = {},
  ): Promise<CapabilityEvaluationReport> {
    const cases = selectCapabilityCases(RECEPTIONIST_CAPABILITY_GOLDEN_CASES, options);
    const categoryPassRates: CapabilityEvaluationReport['categoryPassRates'] = {};
    const results: CapabilityEvaluationReport['results'] = [];

    for (const testCase of cases) {
      let passed = false;
      let expected: string | boolean | undefined;
      let actual: string | boolean | undefined;

      if (testCase.kind === 'classifier') {
        const result: IntentClassifierResult = classifyIntentMock(
          baseClassifierInput(testCase.input),
        );
        expected = testCase.expectedIntent;
        actual = result.intent;
        passed = result.intent === testCase.expectedIntent;
      } else if (testCase.kind === 'router') {
        const result = routeServiceMock(testCase.input as unknown as ServiceRouterInput);
        expected = testCase.expectedMatched;
        actual = result.matched;
        passed =
          result.matched === testCase.expectedMatched &&
          (testCase.expectedServiceKey ? result.serviceKey === testCase.expectedServiceKey : true);
      } else {
        const result = extractStateEntitiesMock(baseStateInput(testCase));
        expected = testCase.expectedRecognizedAs;
        actual = result.recognizedAs;
        passed = result.recognizedAs === testCase.expectedRecognizedAs;
      }

      results.push({
        id: testCase.id,
        category: testCase.category,
        kind: testCase.kind,
        passed,
        ...(expected !== undefined ? { expected } : {}),
        ...(actual !== undefined ? { actual } : {}),
      });

      const bucket = categoryPassRates[testCase.category] ?? { passed: 0, total: 0, passRate: 0 };
      bucket.total += 1;
      if (passed) {
        bucket.passed += 1;
      }
      bucket.passRate =
        bucket.total === 0 ? 0 : Math.round((bucket.passed / bucket.total) * 1000) / 10;
      categoryPassRates[testCase.category] = bucket;
    }

    const passedCases = results.filter((result) => result.passed).length;
    const totalCases = results.length;

    return {
      totalCases,
      passedCases,
      failedCases: totalCases - passedCases,
      passPercentage: totalCases === 0 ? 0 : Math.round((passedCases / totalCases) * 1000) / 10,
      categoryPassRates,
      results,
      skipped: false,
    };
  }
}

export function countCasesByCategory(
  cases: CapabilityEvaluationCase[] = buildReceptionistCapabilityGoldenCases(),
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const testCase of cases) {
    counts[testCase.category] = (counts[testCase.category] ?? 0) + 1;
  }
  return counts;
}
