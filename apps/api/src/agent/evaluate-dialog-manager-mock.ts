import { DialogManagerEvaluationRunner } from './evaluation/dialog-manager-evaluation-runner';
import { printEvaluationReport } from './evaluation/evaluation-report';

async function main() {
  const runner = new DialogManagerEvaluationRunner();
  const summary = runner.runMockEvaluation();

  const categoryLines = Object.fromEntries(
    Object.entries(summary.categoryPassRates).map(([category, stats]) => [
      category,
      `${stats.passed}/${stats.total}`,
    ]),
  );

  printEvaluationReport('Dialog Manager Evaluation (mock)', {
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
  }

  if (process.env.STRICT_EVAL === 'true' && failures.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
