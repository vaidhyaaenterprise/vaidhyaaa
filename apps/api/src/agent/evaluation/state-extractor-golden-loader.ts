import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { StateEntityExtractorInput } from '@vaidya/shared';

export type StateExtractorGoldenExpected = {
  recognizedAs: string;
  entities?: Record<string, string | null>;
  needsClarification?: boolean;
};

export type StateExtractorGoldenCase = {
  id: string;
  category: string;
  currentFlow: string;
  currentState: string;
  messageText: string;
  referenceDate?: string;
  timezone?: string;
  collected?: Record<string, unknown>;
  offeredSlots?: StateEntityExtractorInput['offeredSlots'];
  expected?: StateExtractorGoldenExpected;
  safetyPreempted?: 'emergency' | 'medical_advice';
};

const GOLDEN_PATH = join(__dirname, '../../../testdata/state-entity-extractor-golden.json');

export function loadStateExtractorGoldenCases(): StateExtractorGoldenCase[] {
  const raw = readFileSync(GOLDEN_PATH, 'utf8');
  return JSON.parse(raw) as StateExtractorGoldenCase[];
}
