# A14 - Service Router Capability Context and Unsupported Handling

## Purpose

Improve service routing for real-world patient problems without storing every possible problem phrase.

## Required behavior

Use active clinic service profiles:

- service_name
- handles_json
- does_not_handle_json
- red_flags_json
- routing_examples_json
- doctor_services active mappings

Do not use a giant `clinic_service_problem_phrases` table.

## Implement

1. Service router prompt with only current clinic active service profiles.
2. Unsupported service handling.
3. Red-flag escalation from service profiles.
4. Clarification when multiple services match.
5. No cross-clinic service data.

## Output

```ts
{
  matched: boolean;
  clinicServiceId?: string;
  serviceKey?: string;
  confidence: number;
  unsupportedReason?: string;
  needsClarification?: boolean;
  clarificationQuestion?: string;
}
```

## Examples

- knee pain -> Orthopaedic if clinic has it.
- child fever -> Paediatric if clinic has it.
- mild fever -> General Consultation if configured.
- tooth pain -> unsupported if clinic has no dental.
- chest pain -> emergency, not service route.

## Acceptance

- Service router only sees current clinic services.
- Unsupported service does not book wrong doctor.
- If multiple services match, asks clarification.
- Red flags override to emergency.
