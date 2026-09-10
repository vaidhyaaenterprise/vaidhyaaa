export const VAIDYA_MANUAL_TEMPLATE_SOURCE =
  'Vaidya Clinic Knowledge Base Q&A Template';

export type ManualQaTemplateQuestion = {
  sectionKey: string;
  sectionTitle: string;
  question: string;
  category: string;
  sourceNotes?: string;
  serviceNameRequired?: boolean;
};

export const VAIDYA_MANUAL_QA_TEMPLATE: ManualQaTemplateQuestion[] = [
  {
    sectionKey: 'visit_appointments',
    sectionTitle: 'Visit & Appointments',
    question: 'Do I need an appointment, or can I walk in?',
    category: 'visit_policy',
    sourceNotes: 'Only fill if this is not already configured in Vaidya UI.',
  },
  {
    sectionKey: 'visit_appointments',
    sectionTitle: 'Visit & Appointments',
    question: 'How early should I come before my appointment?',
    category: 'visit_policy',
    sourceNotes: 'Only fill if this is not already configured in Vaidya UI.',
  },
  {
    sectionKey: 'visit_appointments',
    sectionTitle: 'Visit & Appointments',
    question: 'What should I do if I am late for my appointment?',
    category: 'visit_policy',
    sourceNotes: 'Only fill if this is not already configured in Vaidya UI.',
  },
  {
    sectionKey: 'visit_appointments',
    sectionTitle: 'Visit & Appointments',
    question: 'Can I come for follow-up directly, or should I book an appointment?',
    category: 'visit_policy',
    sourceNotes:
      'Do not ask for or store follow-up fee in this Q&A section. Only fill if this is not already configured in Vaidya UI.',
  },
  {
    sectionKey: 'visit_appointments',
    sectionTitle: 'Visit & Appointments',
    question: 'Can one family member or attendant come with the patient?',
    category: 'visit_policy',
    sourceNotes: 'Only fill if this is not already configured in Vaidya UI.',
  },
  {
    sectionKey: 'visit_appointments',
    sectionTitle: 'Visit & Appointments',
    question: 'Can I get same-day appointment if slots are available?',
    category: 'visit_policy',
    sourceNotes: 'Only fill if this is not already configured in Vaidya UI.',
  },
  {
    sectionKey: 'visit_appointments',
    sectionTitle: 'Visit & Appointments',
    question: 'Do I need to call before coming for a test, scan, or procedure?',
    category: 'visit_policy',
    sourceNotes: 'Only fill if this is not already configured in Vaidya UI.',
  },
  {
    sectionKey: 'visit_appointments',
    sectionTitle: 'Visit & Appointments',
    question: 'Can reports from another hospital or doctor be reviewed here?',
    category: 'visit_policy',
    sourceNotes: 'Only fill if this is not already configured in Vaidya UI.',
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
    sourceNotes: 'Do not advise stopping or starting medicines.',
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
    sectionKey: 'first_visit_documents',
    sectionTitle: 'First Visit & Documents',
    question: 'Is a referral letter required?',
    category: 'first_visit_documents',
  },
  {
    sectionKey: 'first_visit_documents',
    sectionTitle: 'First Visit & Documents',
    question:
      'For a child patient, should parents bring vaccination card or previous records?',
    category: 'child_visit_documents',
    sourceNotes: 'Leave blank if not applicable.',
  },
  {
    sectionKey: 'first_visit_documents',
    sectionTitle: 'First Visit & Documents',
    question: 'For follow-up visit, what documents should I bring?',
    category: 'followup_documents',
  },

  {
    sectionKey: 'tests_reports',
    sectionTitle: 'Tests & Reports',
    question: 'Does any blood test require fasting?',
    category: 'test_preparation',
    sourceNotes: 'If it depends on test type, say clinic staff will confirm.',
  },
  {
    sectionKey: 'tests_reports',
    sectionTitle: 'Tests & Reports',
    question: 'For blood sugar / lipid profile test, is fasting required?',
    category: 'test_preparation',
    sourceNotes: 'Leave blank if not applicable.',
  },
  {
    sectionKey: 'tests_reports',
    sectionTitle: 'Tests & Reports',
    question: 'For scan / ultrasound, is fasting required?',
    category: 'scan_preparation',
    sourceNotes:
      'Mention exact scan type only if the clinic has an approved rule.',
  },
  {
    sectionKey: 'tests_reports',
    sectionTitle: 'Tests & Reports',
    question: 'Can I drink water before the scan or test?',
    category: 'scan_preparation',
  },
  {
    sectionKey: 'tests_reports',
    sectionTitle: 'Tests & Reports',
    question: 'Is any preparation needed for ECG / ECHO / X-ray?',
    category: 'test_preparation',
    sourceNotes: 'Leave blank if not applicable.',
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
    sourceNotes:
      'Possible examples include in-person collection, WhatsApp, or email if allowed by the clinic.',
  },
  {
    sectionKey: 'tests_reports',
    sectionTitle: 'Tests & Reports',
    question: 'Can someone else collect my report?',
    category: 'report_delivery',
  },
  {
    sectionKey: 'tests_reports',
    sectionTitle: 'Tests & Reports',
    question: 'Should I book an appointment for report review?',
    category: 'report_review',
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
    question: 'Is UPI accepted?',
    category: 'payment',
  },
  {
    sectionKey: 'payments_insurance',
    sectionTitle: 'Payments & Insurance',
    question: 'Are card payments accepted?',
    category: 'payment',
  },
  {
    sectionKey: 'payments_insurance',
    sectionTitle: 'Payments & Insurance',
    question: 'Is cash accepted?',
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
    sourceNotes:
      'If it depends on insurer/procedure, instruct staff to confirm.',
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
    sectionKey: 'payments_insurance',
    sectionTitle: 'Payments & Insurance',
    question: 'Can I get GST invoice?',
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
    question: 'Is two-wheeler parking available?',
    category: 'facility',
  },
  {
    sectionKey: 'facilities',
    sectionTitle: 'Facilities',
    question: 'Is car parking available?',
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
    question: 'Is the clinic suitable for elderly patients?',
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
    sectionKey: 'facilities',
    sectionTitle: 'Facilities',
    question: 'Is drinking water available?',
    category: 'facility',
  },
  {
    sectionKey: 'facilities',
    sectionTitle: 'Facilities',
    question: 'Can children wait inside the clinic?',
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
    sourceNotes: 'Only store the clinic policy. Do not describe the Vaidya handoff flow.',
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
    sourceNotes: 'Do not give diagnosis advice.',
  },
  {
    sectionKey: 'communication',
    sectionTitle: 'Communication',
    question: 'Will the clinic remind me before appointment?',
    category: 'communication',
    sourceNotes: 'Fill only if the clinic has this policy.',
  },

  {
    sectionKey: 'service_specific',
    sectionTitle: 'Service Specific',
    question: 'For <this> service, what should patients bring before visit?',
    category: 'service_specific',
    sourceNotes: 'Allow the administrator to specify the service name.',
    serviceNameRequired: true,
  },
  {
    sectionKey: 'service_specific',
    sectionTitle: 'Service Specific',
    question: 'For this service, is any preparation needed before coming?',
    category: 'service_specific',
    sourceNotes:
      'Examples include diagnostics, dental, eye, fertility, or physiotherapy.',
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
    question: 'For this service, can patient eat before coming?',
    category: 'service_specific',
    sourceNotes: 'Only allow a non-medical instruction approved by the clinic.',
    serviceNameRequired: true,
  },
  {
    sectionKey: 'service_specific',
    sectionTitle: 'Service Specific',
    question: 'For this service, should patient come with attendant?',
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
