import { printEvaluationReport } from './evaluation/evaluation-report';
import { runQaActivationCheck } from './qa-activation';

async function main() {
  if (process.env.QA_GATE_FORCE_FAIL === 'true') {
    console.error('QA gate failed. Real LLM providers must remain on mock.');
    process.exit(1);
  }

  const { capabilityReport, gateResult } = await runQaActivationCheck();

  printEvaluationReport('QA Gate — Capability Evaluation (mock)', {
    'Total cases': capabilityReport.totalCases,
    'Pass percentage': `${capabilityReport.passPercentage}%`,
    'Category pass rates': Object.fromEntries(
      Object.entries(capabilityReport.categoryPassRates).map(([category, stats]) => [
        category,
        `${stats.passed}/${stats.total} (${stats.passRate}%)`,
      ]),
    ),
  });

  printEvaluationReport('QA Gate — Activation Check', {
    passed: gateResult.passed,
    gates: gateResult.gates,
    failures: gateResult.failures,
  });

  if (!gateResult.passed) {
    console.error('QA gate failed. Real LLM providers must remain on mock.');
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        activated: false,
        message:
          'QA gates passed. Set PRIMARY_LLM_PROVIDER=sarvam (and related providers) in QA only after real evaluation also passes.',
        recommended_env: {
          PRIMARY_LLM_PROVIDER: 'sarvam',
          SERVICE_ROUTER_PROVIDER: 'sarvam',
          STATE_ENTITY_EXTRACTOR_PROVIDER: 'sarvam',
          ACTIVE_STATE_LLM_PROVIDER: 'sarvam',
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
