import { AgentCapabilityEvaluationRunner } from './evaluation/agent-capability-evaluation-runner';
import { printEvaluationReport } from './evaluation/evaluation-report';

async function main() {
  const runner = new AgentCapabilityEvaluationRunner();
  const summary = await runner.runMockEvaluation();

  const categoryLines = Object.fromEntries(
    Object.entries(summary.categoryPassRates).map(([category, stats]) => [
      category,
      `${stats.passed}/${stats.total} (${stats.passRate}%)`,
    ]),
  );

  printEvaluationReport('Agent Capability Evaluation (mock)', {
    'Total cases': summary.totalCases,
    'Passed cases': summary.passedCases,
    'Failed cases': summary.failedCases,
    'Pass percentage': `${summary.passPercentage}%`,
    'Category pass rates': categoryLines,
  });

  const failures = summary.results.filter((result) => !result.passed);
  if (failures.length > 0) {
    console.log(`\nFailures (${failures.length}):`);
    console.log(JSON.stringify(failures.slice(0, 25), null, 2));
    if (failures.length > 25) {
      console.log(`... and ${failures.length - 25} more`);
    }
  }

  if (process.env.STRICT_EVAL === 'true' && failures.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
