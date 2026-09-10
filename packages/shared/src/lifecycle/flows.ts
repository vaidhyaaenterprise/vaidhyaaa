export const CANCEL_FLOW = 'cancel' as const;
export const RESCHEDULE_FLOW = 'reschedule' as const;
export const HANDOFF_FLOW = 'handoff' as const;

export const CANCEL_INTENTS = new Set(['cancel_appointment']);
export const RESCHEDULE_INTENTS = new Set(['reschedule_appointment']);
export const HANDOFF_INTENTS = new Set(['ask_human_agent']);
