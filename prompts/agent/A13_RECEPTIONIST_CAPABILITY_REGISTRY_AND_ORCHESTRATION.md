# A13 - Receptionist Capability Registry and Orchestration

## Purpose

Make Vaidya behave like a real clinic receptionist while staying controlled and safe.

## Implement CapabilityRegistry

Each capability has:

```ts
{
  key: string;
  sourceOfTruth: 'structured_db' | 'approved_knowledge' | 'state_machine' | 'fixed_template' | 'callback';
  allowedDuringActiveFlow: boolean;
  resumeActiveFlowAfterAnswer: boolean;
  endsActiveFlow: boolean;
  createsBackendAction: 'none' | 'callback_request' | 'emergency_incident' | 'appointment_action_request';
  templateKey: string;
}
```

## Capabilities

- book_appointment
- cancel_appointment
- reschedule_appointment
- ask_fee
- ask_timing
- ask_location
- ask_doctor_availability
- ask_previsit_instruction
- ask_insurance
- ask_human_agent
- emergency
- medical_advice_request
- language_switch
- greeting_smalltalk
- unsupported_service
- out_of_scope
- unknown

## Receptionist behavior

- Exact operational facts use structured DB.
- Approved FAQ uses knowledge service.
- Unknown clinic detail uses staff-confirm fallback.
- Random unrelated question redirects to clinic scope.
- Human request starts handoff.
- Emergency stops unsafe continuation.
- Medical advice is refused.

## Acceptance

- Every intent maps to one capability.
- Every capability has source_of_truth.
- Orchestrator does not manually hardcode scattered behavior.
- Active flow side questions use capability policy.
