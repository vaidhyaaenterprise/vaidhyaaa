import { parseApiEnv } from '@vaidya/config';

import { DialogManagerEvaluationRunner } from './evaluation/dialog-manager-evaluation-runner';
import { printEvaluationReport } from './evaluation/evaluation-report';

async function main() {
  const env = parseApiEnv(process.env);
  const runner = new DialogManagerEvaluationRunner();
  const summary = await runner.runRealEvaluation({ SARVAM_API_KEY: env.SARVAM_API_KEY ?? null });

  if (summary.skipped) {
    console.log(`Skipping real dialog manager evaluation: ${summary.skipReason}`);
    return;
  }

  const categoryLines = Object.fromEntries(
    Object.entries(summary.categoryPassRates).map(([category, stats]) => [
      category,
      `${stats.passed}/${stats.total}`,
    ]),
  );

  printEvaluationReport('Dialog Manager Evaluation (real)', {
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
