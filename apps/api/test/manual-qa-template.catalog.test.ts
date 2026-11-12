import { describe, expect, it } from 'vitest';

import { VAIDYA_MANUAL_QA_TEMPLATE } from '../src/modules/knowledge/manual-qa-template.catalog';

describe('manual knowledge starter template', () => {
  it('preloads exactly five high-value questions per built-in section', () => {
    const counts = new Map<string, number>();
    for (const question of VAIDYA_MANUAL_QA_TEMPLATE) {
      counts.set(question.sectionKey, (counts.get(question.sectionKey) ?? 0) + 1);
    }

    expect(Array.from(counts.keys())).toEqual([
      'visit_appointments',
      'first_visit_documents',
      'tests_reports',
      'payments_insurance',
      'facilities',
      'communication',
      'service_specific',
    ]);
    expect(Array.from(counts.values())).toEqual([5, 5, 5, 5, 5, 5, 5]);
  });
});
