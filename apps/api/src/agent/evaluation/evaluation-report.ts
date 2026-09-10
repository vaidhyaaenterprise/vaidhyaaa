export type LatencyStats = {
  averageMs: number;
  p50Ms: number;
  p95Ms: number;
};

export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)]!;
}

export function computeLatencyStats(latenciesMs: number[]): LatencyStats {
  if (latenciesMs.length === 0) {
    return { averageMs: 0, p50Ms: 0, p95Ms: 0 };
  }
  const total = latenciesMs.reduce((sum, value) => sum + value, 0);
  return {
    averageMs: Math.round(total / latenciesMs.length),
    p50Ms: percentile(latenciesMs, 50),
    p95Ms: percentile(latenciesMs, 95),
  };
}

export function printEvaluationReport(title: string, report: Record<string, unknown>): void {
  console.log(`\n${title}`);
  console.log('─'.repeat(title.length));
  for (const [key, value] of Object.entries(report)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      console.log(`${key}:`);
      for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        console.log(`  ${nestedKey}: ${nestedValue}`);
      }
      continue;
    }
    console.log(`${key}: ${value}`);
  }
}
