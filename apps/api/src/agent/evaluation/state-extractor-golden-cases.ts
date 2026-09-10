import { loadStateExtractorGoldenCases } from './state-extractor-golden-loader';

export type StateExtractorGoldenCase = ReturnType<typeof loadStateExtractorGoldenCases>[number];

export const STATE_EXTRACTOR_GOLDEN_CASES: StateExtractorGoldenCase[] = loadStateExtractorGoldenCases();
