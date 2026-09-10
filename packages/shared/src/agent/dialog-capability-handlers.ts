import type { ReceptionistDialogCapability, ReceptionistAnswerHandler, ReceptionistDialogInput } from './receptionist-dialog-types';
import type { CapabilitySourceOfTruth } from './receptionist-capability-registry';
import { RECEPTIONIST_CAPABILITY_REGISTRY } from './receptionist-capability-registry';

export type DialogCapabilityHandlerMeta = {
  handler: ReceptionistAnswerHandler;
  sourceOfTruth: CapabilitySourceOfTruth | 'none';
};

const CAPABILITY_HANDLER_MAP: Record<ReceptionistDialogCapability, DialogCapabilityHandlerMeta> = {
  book_appointment: { handler: 'BookingMachine', sourceOfTruth: 'state_machine' },
  cancel_appointment: { handler: 'CancelMachine', sourceOfTruth: 'state_machine' },
  reschedule_appointment: { handler: 'RescheduleMachine', sourceOfTruth: 'state_machine' },
  ask_fee: { handler: 'FeeHandler', sourceOfTruth: 'structured_db' },
  ask_timing: { handler: 'TimingHandler', sourceOfTruth: 'structured_db' },
  ask_location: { handler: 'LocationHandler', sourceOfTruth: 'structured_db' },
  ask_doctor_availability: { handler: 'DoctorAvailabilityHandler', sourceOfTruth: 'structured_db' },
  ask_previsit_instruction: { handler: 'KnowledgeRuntimeHandler', sourceOfTruth: 'approved_knowledge' },
  ask_insurance: { handler: 'KnowledgeRuntimeHandler', sourceOfTruth: 'approved_knowledge' },
  ask_report_status: { handler: 'KnowledgeRuntimeHandler', sourceOfTruth: 'approved_knowledge' },
  ask_human_agent: { handler: 'HandoffMachine', sourceOfTruth: 'callback' },
  language_switch: { handler: 'AckHandler', sourceOfTruth: 'fixed_template' },
  greeting_smalltalk: { handler: 'BookingMachine', sourceOfTruth: 'state_machine' },
  thanks_acknowledgement: { handler: 'AckHandler', sourceOfTruth: 'fixed_template' },
  medical_advice_request: { handler: 'MedicalAdviceHandler', sourceOfTruth: 'fixed_template' },
  emergency: { handler: 'EmergencyHandler', sourceOfTruth: 'fixed_template' },
  unsupported_service: { handler: 'ScopeHandler', sourceOfTruth: 'fixed_template' },
  out_of_scope: { handler: 'ScopeHandler', sourceOfTruth: 'fixed_template' },
  unknown: { handler: 'UnknownHandler', sourceOfTruth: 'fixed_template' },
};

export function resolveDialogCapabilityHandler(
  capability: ReceptionistDialogCapability,
): DialogCapabilityHandlerMeta {
  return CAPABILITY_HANDLER_MAP[capability];
}

export function buildClinicCapabilitiesForDialogInput(): ReceptionistDialogInput['clinicCapabilities'] {
  return Object.values(RECEPTIONIST_CAPABILITY_REGISTRY).map((cap) => ({
    capabilityKey: cap.key,
    sourceOfTruth:
      cap.sourceOfTruth === 'callback'
        ? ('callback' as const)
        : cap.sourceOfTruth === 'state_machine'
          ? ('state_machine' as const)
          : cap.sourceOfTruth === 'structured_db'
            ? ('structured_db' as const)
            : cap.sourceOfTruth === 'approved_knowledge'
              ? ('approved_knowledge' as const)
              : ('fixed_template' as const),
    allowedDuringActiveTask: cap.allowedDuringActiveFlow,
    resumeActiveTaskAfterAnswer: cap.resumeActiveFlowAfterAnswer,
    endsActiveTask: cap.endsActiveFlow,
  }));
}

export function capabilityToIntent(capability: ReceptionistDialogCapability): string {
  if (capability === 'thanks_acknowledgement') {
    return 'acknowledgment';
  }
  if (capability === 'greeting_smalltalk') {
    return 'greeting_smalltalk';
  }
  return capability;
}
