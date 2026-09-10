import { AgentCapabilityEvaluationRunner } from './evaluation/agent-capability-evaluation-runner';
import { printEvaluationReport } from './evaluation/evaluation-report';

async function main() {
  const runner = new AgentCapabilityEvaluationRunner();
  const summary = await runner.runMockEvaluation({ sample: true, maxPerCategory: 3 });

  const categoryLines = Object.fromEntries(
    Object.entries(summary.categoryPassRates).map(([category, stats]) => [
      category,
      `${stats.passed}/${stats.total} (${stats.passRate}%)`,
    ]),
  );

  printEvaluationReport('Agent Capability Evaluation (sample/mock)', {
    'Total cases': summary.totalCases,
    'Passed cases': summary.passedCases,
    'Failed cases': summary.failedCases,
    'Pass percentage': `${summary.passPercentage}%`,
    'Category pass rates': categoryLines,
  });

  if (process.env.STRICT_EVAL === 'true' && summary.failedCases > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
