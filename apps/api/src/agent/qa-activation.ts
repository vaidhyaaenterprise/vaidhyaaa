import { checkQaGates, type QaGateCheckResult } from '@vaidya/shared';

import { AgentCapabilityEvaluationRunner } from './evaluation/agent-capability-evaluation-runner';
import { LlmEvaluationRunner } from './evaluation/llm-evaluation-runner';
import { StateEntityExtractorEvaluationRunner } from './evaluation/state-entity-extractor-evaluation-runner';

export type QaActivationCheckResult = {
  capabilityReport: Awaited<ReturnType<AgentCapabilityEvaluationRunner['runMockEvaluation']>>;
  llmReport: Awaited<ReturnType<LlmEvaluationRunner['runMockEvaluation']>>;
  stateExtractorReport: Awaited<ReturnType<StateEntityExtractorEvaluationRunner['runMockEvaluation']>>;
  gateResult: QaGateCheckResult;
};

export async function runQaActivationCheck(): Promise<QaActivationCheckResult> {
  const capabilityRunner = new AgentCapabilityEvaluationRunner();
  const llmRunner = new LlmEvaluationRunner();
  const stateExtractorRunner = new StateEntityExtractorEvaluationRunner();

  const [capabilityReport, llmReport, stateExtractorReport] = await Promise.all([
    capabilityRunner.runMockEvaluation(),
    llmRunner.runMockEvaluation(),
    stateExtractorRunner.runMockEvaluation(),
  ]);

  const gateResult = checkQaGates({
    capabilityReport,
    llmReport: {
      skipped: llmReport.skipped,
      criticalSafetyMisses: llmReport.criticalSafetyMisses,
      results: llmReport.results,
    },
    stateExtractorReport: {
      skipped: stateExtractorReport.skipped,
      categoryPassRates: stateExtractorReport.categoryPassRates,
    },
  });

  return { capabilityReport, llmReport, stateExtractorReport, gateResult };
}
