import type { LlmEvaluationCase } from '@vaidya/shared';

export const CLASSIFIER_GOLDEN_CASES: LlmEvaluationCase[] = [
  {
    id: 'book_evening',
    kind: 'classifier',
    input: { messageText: 'Naalaikku evening appointment venum', languageCode: 'ta_tanglish' },
    expectedIntent: 'book_appointment',
  },
  {
    id: 'book_doctor',
    kind: 'classifier',
    input: { messageText: 'Doctor-a paakanum', languageCode: 'ta_tanglish' },
    expectedIntent: 'book_appointment',
  },
  {
    id: 'book_token',
    kind: 'classifier',
    input: { messageText: 'Token edukka venum', languageCode: 'ta_tanglish' },
    expectedIntent: 'book_appointment',
  },
  {
    id: 'cancel',
    kind: 'classifier',
    input: { messageText: 'Appointment cancel pannunga', languageCode: 'ta_tanglish' },
    expectedIntent: 'cancel_appointment',
  },
  {
    id: 'reschedule',
    kind: 'classifier',
    input: { messageText: 'Appointment time change panna venum', languageCode: 'ta_tanglish' },
    expectedIntent: 'reschedule_appointment',
  },
  {
    id: 'fee',
    kind: 'classifier',
    input: { messageText: 'Fees evlo?', languageCode: 'ta_tanglish' },
    expectedIntent: 'ask_fee',
  },
  {
    id: 'fee_doctor',
    kind: 'classifier',
    input: { messageText: 'Dr Priya fees evlo?', languageCode: 'ta_tanglish' },
    expectedIntent: 'ask_fee',
  },
  {
    id: 'timing',
    kind: 'classifier',
    input: { messageText: 'Sunday open-a?', languageCode: 'ta_tanglish' },
    expectedIntent: 'ask_timing',
  },
  {
    id: 'location',
    kind: 'classifier',
    input: { messageText: 'Clinic enga irukku?', languageCode: 'ta_tanglish' },
    expectedIntent: 'ask_location',
  },
  {
    id: 'availability',
    kind: 'classifier',
    input: { messageText: 'Dr Priya inniku irukkangala?', languageCode: 'ta_tanglish' },
    expectedIntent: 'ask_doctor_availability',
  },
  {
    id: 'previsit_scan',
    kind: 'classifier',
    input: { messageText: 'Scan-ku fasting venuma?', languageCode: 'ta_tanglish' },
    expectedIntent: 'ask_previsit_instruction',
  },
  {
    id: 'previsit_parking',
    kind: 'classifier',
    input: { messageText: 'Parking irukka?', languageCode: 'ta_tanglish' },
    expectedIntent: 'ask_previsit_instruction',
  },
  {
    id: 'insurance',
    kind: 'classifier',
    input: { messageText: 'Insurance accept pannuveengala?', languageCode: 'ta_tanglish' },
    expectedIntent: 'ask_insurance',
  },
  {
    id: 'handoff',
    kind: 'classifier',
    input: { messageText: 'Receptionist kitta pesanum', languageCode: 'ta_tanglish' },
    expectedIntent: 'ask_human_agent',
  },
  {
    id: 'emergency_plain',
    kind: 'classifier',
    input: { messageText: 'Chest pain irukku', languageCode: 'ta_tanglish' },
    expectedIntent: 'emergency',
  },
  {
    id: 'emergency_with_booking',
    kind: 'classifier',
    input: { messageText: 'Chest pain irukku appointment venum', languageCode: 'ta_tanglish' },
    expectedIntent: 'emergency',
  },
  {
    id: 'medical_advice',
    kind: 'classifier',
    input: { messageText: 'Fever-ku enna tablet?', languageCode: 'ta_tanglish' },
    expectedIntent: 'medical_advice_request',
  },
  {
    id: 'language_switch',
    kind: 'classifier',
    input: { messageText: 'English please', languageCode: 'ta_tanglish' },
    expectedIntent: 'language_switch',
  },
  {
    id: 'unknown_gibberish',
    kind: 'classifier',
    input: { messageText: 'Random gibberish xyzabc', languageCode: 'ta_tanglish' },
    expectedIntent: 'unknown',
  },
  {
    id: 'unknown_out_of_scope',
    kind: 'classifier',
    input: { messageText: 'Weather enna today', languageCode: 'ta_tanglish' },
    expectedIntent: 'out_of_scope',
  },
  {
    id: 'previsit_tooth',
    kind: 'classifier',
    input: { messageText: 'Tooth extraction-ku fasting venuma?', languageCode: 'ta_tanglish' },
    expectedIntent: 'ask_previsit_instruction',
  },
];

export const ROUTER_GOLDEN_CASES: LlmEvaluationCase[] = [
  {
    id: 'knee_ortho_match',
    kind: 'router',
    input: {
      clinicId: 'clinic-a',
      reasonForVisit: 'knee pain',
      activeClinicServices: [
        {
          id: 'svc-ortho',
          serviceKey: 'orthopedics',
          serviceName: 'Orthopedics',
          handlesJson: { symptoms: ['knee pain', 'joint pain'] },
          doesNotHandleJson: {},
          redFlagsJson: {},
          routingExamplesJson: { examples: ['knee pain appointment'] },
        },
      ],
    },
    expectedMatched: true,
    expectedServiceKey: 'orthopedics',
  },
  {
    id: 'tooth_clinic_a_unsupported',
    kind: 'router',
    input: {
      clinicId: 'clinic-a',
      reasonForVisit: 'tooth pain',
      activeClinicServices: [
        {
          id: 'svc-ortho',
          serviceKey: 'orthopedics',
          serviceName: 'Orthopedics',
          handlesJson: { symptoms: ['knee pain'] },
          doesNotHandleJson: {},
          redFlagsJson: {},
          routingExamplesJson: {},
        },
      ],
    },
    expectedMatched: false,
  },
];
