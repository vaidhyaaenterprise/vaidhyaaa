import type { Category, KnowledgeEntry } from './types';

export const KNOWLEDGE_CATEGORIES: Category[] = [
  {
    id: 'visit_policy',
    name: 'Visit Policy',
    description: 'Visit and appointment policies',
  },
  {
    id: 'first_visit_documents',
    name: 'First Visit Documents',
    description: 'Documents required for a first visit',
  },
  {
    id: 'insurance_documents',
    name: 'Insurance Documents',
    description: 'Documents required for insurance',
  },
  {
    id: 'child_visit_documents',
    name: 'Child Visit Documents',
    description: 'Documents required for a child visit',
  },
  {
    id: 'followup_documents',
    name: 'Follow-up Documents',
    description: 'Documents required for a follow-up visit',
  },
  {
    id: 'test_preparation',
    name: 'Test Preparation',
    description: 'Preparation instructions for tests',
  },
  {
    id: 'scan_preparation',
    name: 'Scan Preparation',
    description: 'Preparation instructions for scans',
  },
  {
    id: 'lab_process',
    name: 'Lab Process',
    description: 'Laboratory processes and availability',
  },
  {
    id: 'report_status',
    name: 'Report Status',
    description: 'Report readiness and status',
  },
  {
    id: 'report_delivery',
    name: 'Report Delivery',
    description: 'Report collection and delivery',
  },
  {
    id: 'report_review',
    name: 'Report Review',
    description: 'Reviewing reports with a doctor',
  },
  {
    id: 'payment',
    name: 'Payment',
    description: 'Payment methods and policies',
  },
  {
    id: 'insurance',
    name: 'Insurance',
    description: 'Insurance information',
  },
  {
    id: 'billing',
    name: 'Billing',
    description: 'Billing and receipt information',
  },
  {
    id: 'facility',
    name: 'Facility',
    description: 'Clinic facilities and accessibility',
  },
  {
    id: 'communication',
    name: 'Communication',
    description: 'Clinic contact and communication',
  },
  {
    id: 'service_specific',
    name: 'Service Specific',
    description: 'Information about a specific clinic service',
  },
  {
    id: 'general',
    name: 'General FAQ',
    description: 'General clinic information',
  },
];

const TEMPLATE_SECTION_NAMES: Record<string, string> = {
  visit_appointments: 'Visit & Appointments',
  first_visit_documents: 'First Visit & Documents',
  tests_reports: 'Tests & Reports',
  payments_insurance: 'Payments & Insurance',
  facilities: 'Facilities',
  communication: 'Communication',
  service_specific: 'Service Specific',
};

const TEMPLATE_CATEGORY_SECTIONS: Record<string, string> = {
  visit_policy: 'visit_appointments',
  first_visit_documents: 'first_visit_documents',
  insurance_documents: 'first_visit_documents',
  child_visit_documents: 'first_visit_documents',
  followup_documents: 'first_visit_documents',
  test_preparation: 'tests_reports',
  scan_preparation: 'tests_reports',
  lab_process: 'tests_reports',
  report_status: 'tests_reports',
  report_delivery: 'tests_reports',
  report_review: 'tests_reports',
  payment: 'payments_insurance',
  insurance: 'payments_insurance',
  billing: 'payments_insurance',
  facility: 'facilities',
  communication: 'communication',
  service_specific: 'service_specific',
};

export function formatKnowledgeCategoryName(categoryId: string): string {
  const configuredName = KNOWLEDGE_CATEGORIES.find(
    (category) => category.id === categoryId,
  )?.name;
  if (configuredName) {
    return configuredName;
  }

  const formatted = categoryId
    .trim()
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');

  return formatted || 'General FAQ';
}

export function getKnowledgeCategoryDisplayName(
  entry: Pick<KnowledgeEntry, 'category' | 'sectionKey'>,
  categories: Category[] = KNOWLEDGE_CATEGORIES,
): string {
  const sectionKey =
    entry.sectionKey && TEMPLATE_SECTION_NAMES[entry.sectionKey]
      ? entry.sectionKey
      : TEMPLATE_CATEGORY_SECTIONS[entry.category];

  if (sectionKey) {
    return TEMPLATE_SECTION_NAMES[sectionKey] ?? formatKnowledgeCategoryName(entry.category);
  }

  return (
    categories.find((category) => category.id === entry.category)?.name ??
    formatKnowledgeCategoryName(entry.category)
  );
}
