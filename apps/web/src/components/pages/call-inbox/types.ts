export type CallOutcome =
  | 'appointment_booked'
  | 'appointment_cancelled'
  | 'appointment_rescheduled'
  | 'callback_requested'
  | 'emergency'
  | 'general_inquiry';
export type CallLinkType = 'appointment' | 'callback' | 'emergency' | 'none';

export interface Call {
  id: string;
  callTime: string;
  callerPhone: string;
  patientName?: string;
  duration: number;
  summary: string;
  outcome: CallOutcome;
  sourceStatus?: string;
  linkedAppointmentId?: string;
  linkedAppointmentStart?: string;
  linkedCallbackId?: string;
  linkedEmergencyId?: string;
  recordingUrl?: string;
  recordingExpiresAt?: string;
  transcript?: string;
  transcriptExpiresAt?: string;
  intent?: string;
  source: 'voice_bot' | 'manual';
}

export interface CallFilters {
  outcomes: CallOutcome[];
}
