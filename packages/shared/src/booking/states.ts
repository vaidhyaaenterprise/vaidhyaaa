/** A02 booking state machine states (stored in conversation_sessions.current_state). */
export const BOOKING_STATES = [
  'BOOKING_STARTED',
  'ASK_PROBLEM_OR_DOCTOR',
  'ASK_DATE',
  'ASK_TIME',
  'PROPOSE_SLOTS',
  'ASK_PATIENT_NAME',
  'ASK_PHONE_IF_NEEDED',
  'ASK_PATIENT_IDENTITY',
  'CONFIRM_DETAILS',
  'DONE',
] as const;

export type BookingState = (typeof BOOKING_STATES)[number];

export const BOOKING_FLOW = 'booking' as const;
