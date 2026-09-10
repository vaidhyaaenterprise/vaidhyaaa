import type { MessageTemplateKey } from '../templates/index';

export type CapabilitySourceOfTruth =
  | 'structured_db'
  | 'approved_knowledge'
  | 'state_machine'
  | 'fixed_template'
  | 'callback';

export type CapabilityBackendAction =
  | 'none'
  | 'callback_request'
  | 'emergency_incident'
  | 'appointment_action_request';

export type ReceptionistCapabilityKey =
  | 'book_appointment'
  | 'cancel_appointment'
  | 'reschedule_appointment'
  | 'ask_fee'
  | 'ask_timing'
  | 'ask_location'
  | 'ask_doctor_availability'
  | 'ask_previsit_instruction'
  | 'ask_insurance'
  | 'ask_human_agent'
  | 'emergency'
  | 'medical_advice_request'
  | 'language_switch'
  | 'greeting_smalltalk'
  | 'unsupported_service'
  | 'out_of_scope'
  | 'unknown';

export type ReceptionistCapability = {
  key: ReceptionistCapabilityKey;
  sourceOfTruth: CapabilitySourceOfTruth;
  allowedDuringActiveFlow: boolean;
  resumeActiveFlowAfterAnswer: boolean;
  endsActiveFlow: boolean;
  createsBackendAction: CapabilityBackendAction;
  templateKey: MessageTemplateKey;
};

export const RECEPTIONIST_CAPABILITY_REGISTRY: Record<
  ReceptionistCapabilityKey,
  ReceptionistCapability
> = {
  book_appointment: {
    key: 'book_appointment',
    sourceOfTruth: 'state_machine',
    allowedDuringActiveFlow: false,
    resumeActiveFlowAfterAnswer: false,
    endsActiveFlow: false,
    createsBackendAction: 'appointment_action_request',
    templateKey: 'booking.greeting',
  },
  cancel_appointment: {
    key: 'cancel_appointment',
    sourceOfTruth: 'state_machine',
    allowedDuringActiveFlow: true,
    resumeActiveFlowAfterAnswer: false,
    endsActiveFlow: true,
    createsBackendAction: 'appointment_action_request',
    templateKey: 'cancel.confirm',
  },
  reschedule_appointment: {
    key: 'reschedule_appointment',
    sourceOfTruth: 'state_machine',
    allowedDuringActiveFlow: true,
    resumeActiveFlowAfterAnswer: false,
    endsActiveFlow: true,
    createsBackendAction: 'appointment_action_request',
    templateKey: 'reschedule.ask_new_date',
  },
  ask_fee: {
    key: 'ask_fee',
    sourceOfTruth: 'structured_db',
    allowedDuringActiveFlow: true,
    resumeActiveFlowAfterAnswer: true,
    endsActiveFlow: false,
    createsBackendAction: 'none',
    templateKey: 'fee.answer',
  },
  ask_timing: {
    key: 'ask_timing',
    sourceOfTruth: 'structured_db',
    allowedDuringActiveFlow: true,
    resumeActiveFlowAfterAnswer: true,
    endsActiveFlow: false,
    createsBackendAction: 'none',
    templateKey: 'timing.answer',
  },
  ask_location: {
    key: 'ask_location',
    sourceOfTruth: 'structured_db',
    allowedDuringActiveFlow: true,
    resumeActiveFlowAfterAnswer: true,
    endsActiveFlow: false,
    createsBackendAction: 'none',
    templateKey: 'location.answer',
  },
  ask_doctor_availability: {
    key: 'ask_doctor_availability',
    sourceOfTruth: 'structured_db',
    allowedDuringActiveFlow: true,
    resumeActiveFlowAfterAnswer: true,
    endsActiveFlow: false,
    createsBackendAction: 'none',
    templateKey: 'availability.today_slots',
  },
  ask_previsit_instruction: {
    key: 'ask_previsit_instruction',
    sourceOfTruth: 'approved_knowledge',
    allowedDuringActiveFlow: true,
    resumeActiveFlowAfterAnswer: true,
    endsActiveFlow: false,
    createsBackendAction: 'none',
    templateKey: 'knowledge.answer',
  },
  ask_insurance: {
    key: 'ask_insurance',
    sourceOfTruth: 'approved_knowledge',
    allowedDuringActiveFlow: true,
    resumeActiveFlowAfterAnswer: true,
    endsActiveFlow: false,
    createsBackendAction: 'none',
    templateKey: 'knowledge.answer',
  },
  ask_human_agent: {
    key: 'ask_human_agent',
    sourceOfTruth: 'callback',
    allowedDuringActiveFlow: false,
    resumeActiveFlowAfterAnswer: false,
    endsActiveFlow: true,
    createsBackendAction: 'callback_request',
    templateKey: 'handoff.ask_reason',
  },
  emergency: {
    key: 'emergency',
    sourceOfTruth: 'fixed_template',
    allowedDuringActiveFlow: false,
    resumeActiveFlowAfterAnswer: false,
    endsActiveFlow: true,
    createsBackendAction: 'emergency_incident',
    templateKey: 'safety.emergency',
  },
  medical_advice_request: {
    key: 'medical_advice_request',
    sourceOfTruth: 'fixed_template',
    allowedDuringActiveFlow: false,
    resumeActiveFlowAfterAnswer: false,
    endsActiveFlow: true,
    createsBackendAction: 'none',
    templateKey: 'safety.medical_advice_refusal',
  },
  language_switch: {
    key: 'language_switch',
    sourceOfTruth: 'fixed_template',
    allowedDuringActiveFlow: true,
    resumeActiveFlowAfterAnswer: false,
    endsActiveFlow: false,
    createsBackendAction: 'none',
    templateKey: 'language.switched',
  },
  greeting_smalltalk: {
    key: 'greeting_smalltalk',
    sourceOfTruth: 'fixed_template',
    allowedDuringActiveFlow: false,
    resumeActiveFlowAfterAnswer: false,
    endsActiveFlow: false,
    createsBackendAction: 'none',
    templateKey: 'booking.greeting',
  },
  unsupported_service: {
    key: 'unsupported_service',
    sourceOfTruth: 'fixed_template',
    allowedDuringActiveFlow: false,
    resumeActiveFlowAfterAnswer: false,
    endsActiveFlow: false,
    createsBackendAction: 'none',
    templateKey: 'scope.unsupported_service',
  },
  out_of_scope: {
    key: 'out_of_scope',
    sourceOfTruth: 'fixed_template',
    allowedDuringActiveFlow: false,
    resumeActiveFlowAfterAnswer: false,
    endsActiveFlow: false,
    createsBackendAction: 'none',
    templateKey: 'scope.out_of_scope_redirect',
  },
  unknown: {
    key: 'unknown',
    sourceOfTruth: 'fixed_template',
    allowedDuringActiveFlow: true,
    resumeActiveFlowAfterAnswer: false,
    endsActiveFlow: false,
    createsBackendAction: 'none',
    templateKey: 'unknown.clarify',
  },
};

const INTENT_TO_CAPABILITY_KEY: Record<string, ReceptionistCapabilityKey> = {
  book_appointment: 'book_appointment',
  cancel_appointment: 'cancel_appointment',
  reschedule_appointment: 'reschedule_appointment',
  ask_fee: 'ask_fee',
  ask_timing: 'ask_timing',
  ask_location: 'ask_location',
  ask_doctor_availability: 'ask_doctor_availability',
  ask_previsit_instruction: 'ask_previsit_instruction',
  ask_insurance: 'ask_insurance',
  ask_human_agent: 'ask_human_agent',
  emergency: 'emergency',
  medical_advice_request: 'medical_advice_request',
  language_switch: 'language_switch',
  greeting: 'greeting_smalltalk',
  greeting_smalltalk: 'greeting_smalltalk',
  unsupported_service: 'unsupported_service',
  out_of_scope: 'out_of_scope',
  unknown: 'unknown',
};

export function normalizeIntentToCapabilityKey(intent: string): ReceptionistCapabilityKey {
  return INTENT_TO_CAPABILITY_KEY[intent] ?? 'unknown';
}

export function resolveCapabilityForIntent(intent: string): ReceptionistCapability {
  return RECEPTIONIST_CAPABILITY_REGISTRY[normalizeIntentToCapabilityKey(intent)];
}

export function capabilityTemplateKeyForIntent(intent: string): MessageTemplateKey {
  return resolveCapabilityForIntent(intent).templateKey;
}

export function capabilityUsesStructuredDb(intent: string): boolean {
  return resolveCapabilityForIntent(intent).sourceOfTruth === 'structured_db';
}

export function capabilityUsesApprovedKnowledge(intent: string): boolean {
  return resolveCapabilityForIntent(intent).sourceOfTruth === 'approved_knowledge';
}

export function shouldRouteToStructuredInfoHandler(intent: string): boolean {
  const source = resolveCapabilityForIntent(intent).sourceOfTruth;
  return source === 'structured_db' || source === 'approved_knowledge';
}

export function isCapabilityLifecycleInterrupt(intent: string): boolean {
  const capability = resolveCapabilityForIntent(intent);
  if (capability.key === 'language_switch') {
    return true;
  }
  if (capability.sourceOfTruth === 'callback') {
    return true;
  }
  return (
    capability.sourceOfTruth === 'state_machine' &&
    capability.endsActiveFlow &&
    capability.key !== 'book_appointment'
  );
}

export function isCapabilityFlowInterrupt(
  intent: string,
  safety: { isEmergency: boolean; isMedicalAdviceRequest: boolean },
): boolean {
  if (safety.isEmergency || safety.isMedicalAdviceRequest) {
    return true;
  }

  const capability = resolveCapabilityForIntent(intent);
  if (capability.endsActiveFlow) {
    return true;
  }
  if (capability.sourceOfTruth === 'state_machine') {
    return true;
  }
  if (
    capability.allowedDuringActiveFlow &&
    (capability.sourceOfTruth === 'structured_db' ||
      capability.sourceOfTruth === 'approved_knowledge')
  ) {
    return true;
  }
  if (capability.key === 'language_switch') {
    return true;
  }
  return false;
}

export function capabilityAllowsActiveFlowSideQuestion(intent: string): boolean {
  const capability = resolveCapabilityForIntent(intent);
  return (
    capability.allowedDuringActiveFlow &&
    capability.resumeActiveFlowAfterAnswer &&
    (capability.sourceOfTruth === 'structured_db' ||
      capability.sourceOfTruth === 'approved_knowledge')
  );
}

export const STRUCTURED_INFO_CAPABILITY_INTENTS = new Set<string>(
  Object.values(RECEPTIONIST_CAPABILITY_REGISTRY)
    .filter((capability) => capability.sourceOfTruth === 'structured_db')
    .map((capability) => capability.key),
);

export const KNOWLEDGE_CAPABILITY_INTENTS = new Set<string>(
  Object.values(RECEPTIONIST_CAPABILITY_REGISTRY)
    .filter((capability) => capability.sourceOfTruth === 'approved_knowledge')
    .map((capability) => capability.key),
);

export const STATE_MACHINE_CAPABILITY_INTENTS = new Set<string>(
  Object.values(RECEPTIONIST_CAPABILITY_REGISTRY)
    .filter((capability) => capability.sourceOfTruth === 'state_machine')
    .map((capability) => capability.key),
);
