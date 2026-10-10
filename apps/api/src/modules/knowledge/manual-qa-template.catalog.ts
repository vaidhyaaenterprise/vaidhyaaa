export const VAIDYA_MANUAL_TEMPLATE_SOURCE = 'Vaidya Clinic Knowledge Base Q&A Template';

export type ManualQaTemplateQuestion = {
  sectionKey: string;
  sectionTitle: string;
  question: string;
  category: string;
  sourceNotes?: string;
  serviceNameRequired?: boolean;
};

/** Exactly five high-value starter questions per built-in section. */
export const VAIDYA_MANUAL_QA_TEMPLATE: ManualQaTemplateQuestion[] = [
  {
    sectionKey: 'visit_appointments',
    sectionTitle: 'Visit & Appointments',
    question: 'Do I need an appointment, or can I walk in?',
    category: 'visit_policy',
  },
  {
    sectionKey: 'visit_appointments',
    sectionTitle: 'Visit & Appointments',
    question: 'How early should I come before my appointment?',
    category: 'visit_policy',
  },
  {
    sectionKey: 'visit_appointments',
    sectionTitle: 'Visit & Appointments',
    question: 'What should I do if I am late for my appointment?',
    category: 'visit_policy',
  },
  {
    sectionKey: 'visit_appointments',
    sectionTitle: 'Visit & Appointments',
    question: 'Can I come for follow-up directly, or should I book an appointment?',
    category: 'visit_policy',
  },
  {
    sectionKey: 'visit_appointments',
    sectionTitle: 'Visit & Appointments',
    question: 'Can I get a same-day appointment if slots are available?',
    category: 'visit_policy',
  },

  {
    sectionKey: 'first_visit_documents',
    sectionTitle: 'First Visit & Documents',
    question: 'What should I bring for my first visit?',
    category: 'first_visit_documents',
  },
  {
    sectionKey: 'first_visit_documents',
    sectionTitle: 'First Visit & Documents',
    question: 'Should I bring previous reports?',
    category: 'first_visit_documents',
  },
  {
    sectionKey: 'first_visit_documents',
    sectionTitle: 'First Visit & Documents',
    question: 'Should I bring my current medicines list?',
    category: 'first_visit_documents',
  },
  {
    sectionKey: 'first_visit_documents',
    sectionTitle: 'First Visit & Documents',
    question: 'Is ID proof required?',
    category: 'first_visit_documents',
  },
  {
    sectionKey: 'first_visit_documents',
    sectionTitle: 'First Visit & Documents',
    question: 'Should I bring insurance card or policy details?',
    category: 'insurance_documents',
  },

  {
    sectionKey: 'tests_reports',
    sectionTitle: 'Tests & Reports',
    question: 'Does any blood test require fasting?',
    category: 'test_preparation',
  },
  {
    sectionKey: 'tests_reports',
    sectionTitle: 'Tests & Reports',
    question: 'For scan / ultrasound, is fasting required?',
    category: 'scan_preparation',
  },
  {
    sectionKey: 'tests_reports',
    sectionTitle: 'Tests & Reports',
    question: 'Do I need an appointment for lab sample collection?',
    category: 'lab_process',
  },
  {
    sectionKey: 'tests_reports',
    sectionTitle: 'Tests & Reports',
    question: 'How long will reports take?',
    category: 'report_status',
  },
  {
    sectionKey: 'tests_reports',
    sectionTitle: 'Tests & Reports',
    question: 'How will I receive reports?',
    category: 'report_delivery',
  },

  {
    sectionKey: 'payments_insurance',
    sectionTitle: 'Payments & Insurance',
    question: 'What payment modes are accepted?',
    category: 'payment',
  },
  {
    sectionKey: 'payments_insurance',
    sectionTitle: 'Payments & Insurance',
    question: 'Is insurance accepted?',
    category: 'insurance',
  },
  {
    sectionKey: 'payments_insurance',
    sectionTitle: 'Payments & Insurance',
    question: 'Is cashless insurance available?',
    category: 'insurance',
  },
  {
    sectionKey: 'payments_insurance',
    sectionTitle: 'Payments & Insurance',
    question: 'Which insurance providers / TPA are accepted?',
    category: 'insurance',
  },
  {
    sectionKey: 'payments_insurance',
    sectionTitle: 'Payments & Insurance',
    question: 'Will I get a bill or receipt?',
    category: 'billing',
  },

  {
    sectionKey: 'facilities',
    sectionTitle: 'Facilities',
    question: 'Is parking available?',
    category: 'facility',
  },
  {
    sectionKey: 'facilities',
    sectionTitle: 'Facilities',
    question: 'Is wheelchair access available?',
    category: 'facility',
  },
  {
    sectionKey: 'facilities',
    sectionTitle: 'Facilities',
    question: 'Is lift available?',
    category: 'facility',
  },
  {
    sectionKey: 'facilities',
    sectionTitle: 'Facilities',
    question: 'Is a waiting area available?',
    category: 'facility',
  },
  {
    sectionKey: 'facilities',
    sectionTitle: 'Facilities',
    question: 'Is restroom available?',
    category: 'facility',
  },

  {
    sectionKey: 'communication',
    sectionTitle: 'Communication',
    question: 'Can I get reports by WhatsApp?',
    category: 'communication',
  },
  {
    sectionKey: 'communication',
    sectionTitle: 'Communication',
    question: 'Can I get reports by email?',
    category: 'communication',
  },
  {
    sectionKey: 'communication',
    sectionTitle: 'Communication',
    question: 'Can clinic staff call me back for report or insurance questions?',
    category: 'communication',
  },
  {
    sectionKey: 'communication',
    sectionTitle: 'Communication',
    question: 'Can I send reports before visiting?',
    category: 'communication',
  },
  {
    sectionKey: 'communication',
    sectionTitle: 'Communication',
    question: 'Can I share photos or documents before visit?',
    category: 'communication',
  },

  {
    sectionKey: 'service_specific',
    sectionTitle: 'Service Specific',
    question: 'For this service, what should patients bring before the visit?',
    category: 'service_specific',
    serviceNameRequired: true,
  },
  {
    sectionKey: 'service_specific',
    sectionTitle: 'Service Specific',
    question: 'For this service, is any preparation needed before coming?',
    category: 'service_specific',
    serviceNameRequired: true,
  },
  {
    sectionKey: 'service_specific',
    sectionTitle: 'Service Specific',
    question: 'For this service, how long does the visit usually take?',
    category: 'service_specific',
    serviceNameRequired: true,
  },
  {
    sectionKey: 'service_specific',
    sectionTitle: 'Service Specific',
    question: 'For this service, are reports or previous prescriptions required?',
    category: 'service_specific',
    serviceNameRequired: true,
  },
  {
    sectionKey: 'service_specific',
    sectionTitle: 'Service Specific',
    question: 'For this service, when will reports/results be available?',
    category: 'service_specific',
    serviceNameRequired: true,
  },
];
