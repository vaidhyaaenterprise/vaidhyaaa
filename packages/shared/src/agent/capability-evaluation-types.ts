export type CapabilityEvaluationKind = 'classifier' | 'router' | 'state_extractor';

export type CapabilityEvaluationCase = {
  id: string;
  category: string;
  kind: CapabilityEvaluationKind;
  input: Record<string, unknown>;
  expectedIntent?: string;
  expectedMatched?: boolean;
  expectedServiceKey?: string;
  expectedRecognizedAs?: string;
  currentFlow?: string;
  currentState?: string;
  messageText?: string;
  referenceDate?: string;
  offeredSlots?: Array<{
    slotId: string;
    startTime: string;
    endTime: string;
    displayTime: string;
  }>;
  notes?: string;
};

export type CapabilityCategoryStats = {
  passed: number;
  total: number;
  passRate: number;
};

export type CapabilityEvaluationReport = {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passPercentage: number;
  categoryPassRates: Record<string, CapabilityCategoryStats>;
  results: Array<{
    id: string;
    category: string;
    kind: CapabilityEvaluationKind;
    passed: boolean;
    expected?: string | boolean;
    actual?: string | boolean;
  }>;
  skipped: boolean;
};
