import { describe, expect, it } from 'vitest';

import {
  formatKnowledgeCategoryName,
  getKnowledgeCategoryDisplayName,
  KNOWLEDGE_CATEGORIES,
} from './knowledge-categories';

describe('knowledge category display', () => {
  it.each([
    ['visit_appointments', 'visit_policy', 'Visit & Appointments'],
    ['first_visit_documents', 'insurance_documents', 'First Visit & Documents'],
    ['tests_reports', 'scan_preparation', 'Tests & Reports'],
    ['payments_insurance', 'billing', 'Payments & Insurance'],
    ['facilities', 'facility', 'Facilities'],
    ['communication', 'communication', 'Communication'],
    ['service_specific', 'service_specific', 'Service Specific'],
  ])('uses the template title for %s', (sectionKey, category, expected) => {
    expect(getKnowledgeCategoryDisplayName({ sectionKey, category })).toBe(expected);
  });

  it('keeps every template category key available exactly once for editing', () => {
    const categoryIds = KNOWLEDGE_CATEGORIES.map((category) => category.id);

    expect(new Set(categoryIds).size).toBe(categoryIds.length);
    expect(categoryIds).toEqual(
      expect.arrayContaining([
        'visit_policy',
        'first_visit_documents',
        'insurance_documents',
        'child_visit_documents',
        'followup_documents',
        'test_preparation',
        'scan_preparation',
        'lab_process',
        'report_status',
        'report_delivery',
        'report_review',
        'payment',
        'insurance',
        'billing',
        'facility',
        'communication',
        'service_specific',
      ]),
    );
  });

  it('formats an unknown custom category instead of exposing its storage key', () => {
    expect(formatKnowledgeCategoryName('after_hours_policy')).toBe('After Hours Policy');
  });
});
