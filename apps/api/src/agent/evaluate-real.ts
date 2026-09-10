import { LlmEvaluationRunner } from './evaluation/llm-evaluation-runner';
import { printEvaluationReport } from './evaluation/evaluation-report';

async function main() {
  const runner = new LlmEvaluationRunner();
  const summary = await runner.runRealEvaluation();

  if (summary.skipped) {
    console.log(JSON.stringify({ mode: 'real', skipped: true, reason: 'SARVAM_API_KEY missing' }, null, 2));
    process.exit(0);
  }

  printEvaluationReport('LLM Evaluation (real Sarvam)', {
    'Total cases': summary.totalCases,
    'Passed cases': summary.passedCases,
    'Failed cases': summary.failedCases,
    'Pass percentage': `${summary.passPercentage}%`,
    'Average latency (ms)': summary.latency.averageMs,
    'P50 latency (ms)': summary.latency.p50Ms,
    'P95 latency (ms)': summary.latency.p95Ms,
    'Critical safety misses': summary.criticalSafetyMisses,
    'Invalid JSON count': summary.invalidJsonCount,
    'Fallback model count': summary.fallbackModelCount,
    'Timeout count': summary.timeoutCount,
  });

  const failures = summary.results.filter((result) => !result.passed);
  if (failures.length > 0) {
    console.log('\nFailures:');
    console.log(JSON.stringify(failures, null, 2));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
