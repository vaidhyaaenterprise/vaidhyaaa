# A15 - Agent Memory, Side Questions, and Conversation Policy

## Purpose

Ensure Vaidya remembers the active flow and can answer interruptions like a receptionist.

## Implement

1. Store current active prompt in session debug/collected_json.
2. Add resume prompt logic after side question.
3. Add active-flow interruption policy.
4. Release slot holds when active booking is explicitly cancelled or handoff begins.

## Side-question examples during booking

- `Dr Priya fees evlo?`
- `Sunday open-a?`
- `Parking irukka?`
- `Scan-ku fasting venuma?`
- `Clinic enga irukku?`

Behavior:

1. Answer from structured DB or approved KB.
2. Do not reset booking.
3. Repeat the previous missing question.

Example:

```text
Patient: Dr Priya fees evlo?
Vaidya: Dr. Priya consultation fee Rs.700. Appointment-ku endha date venum?
```

## Memory rules

- Do not ask again for fields already collected.
- If patient gives multiple fields in one message, store all.
- If user changes one field, update that field and recompute next state.
- If user asks human handoff, pause/stop current flow and start handoff.
- If user says cancel/vendam in booking, release hold and end booking.

## Acceptance

- Active state survives side question.
- Previous prompt can be resumed.
- No duplicated appointment created.
- No lost collected fields after side question.
