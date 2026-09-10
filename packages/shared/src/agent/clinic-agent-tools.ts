import type { LlmToolDefinition } from './llm-tool-types';

export const CLINIC_AGENT_TOOL_NAMES = [
  'get_clinic_info',
  'search_knowledge_base',
  'check_slot_availability',
  'create_appointment_request',
  'cancel_appointment',
  'reschedule_appointment',
  'request_human_callback',
] as const;

export type ClinicAgentToolName = (typeof CLINIC_AGENT_TOOL_NAMES)[number];

const stringProp = (description: string) => ({
  type: 'string',
  description,
});

const nullableStringProp = (description: string) => ({
  type: ['string', 'null'],
  description,
});

export const CLINIC_AGENT_TOOLS: LlmToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_clinic_info',
      description:
        'Fetch structured clinic facts: fees, timings, location/address, parking, doctor availability, insurance. Use when the patient asks about clinic operations.',
      parameters: {
        type: 'object',
        properties: {
          info_type: {
            type: 'string',
            enum: [
              'fee',
              'timing',
              'location',
              'parking',
              'doctor_availability',
              'insurance',
              'previsit_instruction',
            ],
            description: 'Which clinic fact category to retrieve.',
          },
          doctor_name: nullableStringProp('Doctor name if the question is doctor-specific.'),
          topic: nullableStringProp('Free-text topic for fee or instruction lookups.'),
        },
        required: ['info_type'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge_base',
      description:
        'Search approved clinic knowledge for FAQs, scan prep, documents, reports, and policies. Do not invent facts.',
      parameters: {
        type: 'object',
        properties: {
          query: stringProp('Patient question or topic to search.'),
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_slot_availability',
      description:
        'List available appointment slots for a doctor/service on a date. Call before confirming a time.',
      parameters: {
        type: 'object',
        properties: {
          doctor_name: nullableStringProp('Preferred doctor name.'),
          reason_for_visit: nullableStringProp('Symptom or visit reason for service routing.'),
          preferred_date: stringProp('ISO date YYYY-MM-DD or relative day the patient wants.'),
          time_preference: {
            type: ['string', 'null'],
            enum: ['morning', 'afternoon', 'evening', null],
            description: 'Rough time-of-day preference.',
          },
        },
        required: ['preferred_date'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_appointment_request',
      description:
        'Create a booking request once doctor, reason, date, time/slot, and patient name are known. Never call without required fields.',
      parameters: {
        type: 'object',
        properties: {
          doctor_name: stringProp('Doctor to book with.'),
          reason_for_visit: stringProp('Visit reason or symptom.'),
          preferred_date: stringProp('Appointment date YYYY-MM-DD.'),
          slot_id: stringProp('Chosen slot id from check_slot_availability.'),
          patient_name: stringProp('Patient full name.'),
          patient_phone: nullableStringProp('Patient phone if known.'),
        },
        required: ['doctor_name', 'reason_for_visit', 'preferred_date', 'slot_id', 'patient_name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_appointment',
      description: 'Cancel an existing appointment when the patient clearly asks to cancel.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: nullableStringProp('Known appointment id.'),
          patient_phone: nullableStringProp('Patient phone to look up the visit.'),
          reason: nullableStringProp('Optional cancellation reason.'),
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reschedule_appointment',
      description: 'Move an existing appointment to a new date/time.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: nullableStringProp('Known appointment id.'),
          patient_phone: nullableStringProp('Patient phone to look up the visit.'),
          new_date: nullableStringProp('New preferred date YYYY-MM-DD.'),
          new_slot_id: nullableStringProp('New slot id from check_slot_availability.'),
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_human_callback',
      description: 'Escalate to clinic staff when the patient asks for a human or the issue needs staff follow-up.',
      parameters: {
        type: 'object',
        properties: {
          reason: nullableStringProp('Why the patient wants staff help.'),
          preferred_callback_time: nullableStringProp('When to call back.'),
        },
        additionalProperties: false,
      },
    },
  },
];

export function isClinicAgentToolName(name: string): name is ClinicAgentToolName {
  return (CLINIC_AGENT_TOOL_NAMES as readonly string[]).includes(name);
}
