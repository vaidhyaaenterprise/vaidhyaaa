import {
  attachActiveTask,
  planReceptionistDialogMock,
  type ReceptionistDialogInput,
  type ReceptionistDialogPlan,
} from '@vaidya/shared';

import { loadDialogManagerEvalCases, type DialogManagerEvalCase } from './dialog-manager-eval-loader';

export type DialogManagerEvaluationResult = {
  caseName: string;
  category: string;
  message: string;
  passed: boolean;
  expected: DialogManagerEvalCase['expected'];
  actual?: Partial<ReceptionistDialogPlan>;
};

export type DialogManagerEvaluationReport = {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passPercentage: number;
  categoryPassRates: Record<string, { passed: number; total: number }>;
  results: DialogManagerEvaluationResult[];
  skipped: boolean;
  skipReason?: string;
};

function buildInput(testCase: DialogManagerEvalCase, messageText: string): ReceptionistDialogInput {
  let collected = { ...(testCase.context.collected ?? {}) };
  if (testCase.context.activeTask) {
    collected = attachActiveTask(collected, {
      ...testCase.context.activeTask,
      expectedFields: testCase.context.activeTask.expectedFields ?? [],
    });
  }

  return {
    clinicId: '00000000-0000-0000-0000-000000000001',
    sessionId: '00000000-0000-0000-0000-000000000002',
    messageText,
    languageCode: 'ta_tanglish',
    currentFlow: testCase.context.currentFlow,
    currentState: testCase.context.currentState,
    lastAssistantTemplateKey: testCase.context.lastAssistantTemplateKey ?? null,
    collected,
    activeTask: testCase.context.activeTask
      ? {
          ...testCase.context.activeTask,
          expectedFields: testCase.context.activeTask.expectedFields ?? [],
        }
      : null,
    suspendedTask: null,
    lastCompletedTask: null,
    clinicCapabilities: [],
    clinicContextSummary: {
      clinicName: 'Test Clinic',
      defaultLanguageCode: 'ta_tanglish',
      enabledLanguages: ['ta_tanglish', 'english'],
      activeServices: [],
    },
  };
}

function matchesExpected(plan: ReceptionistDialogPlan, expected: DialogManagerEvalCase['expected']): boolean {
  if (expected.turnType !== undefined && plan.turnType !== expected.turnType) {
    return false;
  }
  if (expected.userMove && plan.userMove !== expected.userMove) {
    return false;
  }
  if (expected.capability !== undefined && plan.capability !== expected.capability) {
    return false;
  }
  if (expected.handler && plan.answerPlan?.handler !== expected.handler) {
    return false;
  }
  if (
    expected.shouldResumeActiveTask !== undefined &&
    plan.taskPlan.shouldResumeActiveTask !== expected.shouldResumeActiveTask
  ) {
    return false;
  }
  return true;
}

export class DialogManagerEvaluationRunner {
  constructor(private readonly cases: DialogManagerEvalCase[] = loadDialogManagerEvalCases()) {}

  runMockEvaluation(): DialogManagerEvaluationReport {
    const results: DialogManagerEvaluationResult[] = [];

    for (const testCase of this.cases) {
      for (const message of testCase.messageVariants) {
        const plan = planReceptionistDialogMock(buildInput(testCase, message));
        const passed = matchesExpected(plan, testCase.expected);
        results.push({
          caseName: testCase.name,
          category: testCase.category,
          message,
          passed,
          expected: testCase.expected,
          actual: {
            turnType: plan.turnType,
            userMove: plan.userMove,
            capability: plan.capability,
            answerPlan: plan.answerPlan ?? null,
            taskPlan: plan.taskPlan,
          },
        });
      }
    }

    const passedCases = results.filter((result) => result.passed).length;
    const categoryPassRates: Record<string, { passed: number; total: number }> = {};
    for (const result of results) {
      const bucket = categoryPassRates[result.category] ?? { passed: 0, total: 0 };
      bucket.total += 1;
      if (result.passed) {
        bucket.passed += 1;
      }
      categoryPassRates[result.category] = bucket;
    }

    return {
      totalCases: results.length,
      passedCases,
      failedCases: results.length - passedCases,
      passPercentage: results.length ? Math.round((passedCases / results.length) * 100) : 100,
      categoryPassRates,
      results,
      skipped: false,
    };
  }

  async runRealEvaluation(env: { SARVAM_API_KEY?: string | null }): Promise<DialogManagerEvaluationReport> {
    if (!env.SARVAM_API_KEY) {
      return {
        totalCases: 0,
        passedCases: 0,
        failedCases: 0,
        passPercentage: 100,
        categoryPassRates: {},
        results: [],
        skipped: true,
        skipReason: 'SARVAM_API_KEY missing',
      };
    }

    const { SarvamReceptionistDialogPlannerAdapter } = await import(
      '../../common/adapters/sarvam-receptionist-dialog-planner.adapter'
    );
    const { parseApiEnv } = await import('@vaidya/config');
    const apiEnv = parseApiEnv(process.env);
    const planner = new SarvamReceptionistDialogPlannerAdapter(apiEnv);
    const results: DialogManagerEvaluationResult[] = [];

    for (const testCase of this.cases) {
      for (const message of testCase.messageVariants) {
        const plan = await planner.plan(buildInput(testCase, message));
        if (!plan) {
          results.push({
            caseName: testCase.name,
            category: testCase.category,
            message,
            passed: false,
            expected: testCase.expected,
            actual: {
              turnType: 'unknown_safe_fallback',
              userMove: 'unknown',
              capability: 'unknown',
              answerPlan: null,
              taskPlan: {
                shouldResumeActiveTask: false,
                shouldSuspendActiveTask: false,
                shouldEndActiveTask: false,
                shouldReleaseActiveHold: false,
              },
            },
          });
          continue;
        }
        const passed = matchesExpected(plan, testCase.expected);
        results.push({
          caseName: testCase.name,
          category: testCase.category,
          message,
          passed,
          expected: testCase.expected,
          actual: {
            turnType: plan.turnType,
            userMove: plan.userMove,
            capability: plan.capability,
            answerPlan: plan.answerPlan ?? null,
            taskPlan: plan.taskPlan,
          },
        });
      }
    }

    const passedCases = results.filter((result) => result.passed).length;
    const categoryPassRates: Record<string, { passed: number; total: number }> = {};
    for (const result of results) {
      const bucket = categoryPassRates[result.category] ?? { passed: 0, total: 0 };
      bucket.total += 1;
      if (result.passed) {
        bucket.passed += 1;
      }
      categoryPassRates[result.category] = bucket;
    }

    return {
      totalCases: results.length,
      passedCases,
      failedCases: results.length - passedCases,
      passPercentage: results.length ? Math.round((passedCases / results.length) * 100) : 100,
      categoryPassRates,
      results,
      skipped: false,
    };
  }
}
