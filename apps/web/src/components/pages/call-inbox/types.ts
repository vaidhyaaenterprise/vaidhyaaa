export type CallOutcome = 'appointment_booked' | 'callback_requested' | 'emergency' | 'general_inquiry' | 'no_action_needed' | 'voicemail';
export type CallAction = 'confirmation_needed' | 'callback_needed' | 'emergency_response' | 'none';
export type CallLinkType = 'appointment' | 'callback' | 'emergency' | 'none';

export interface Call {
  id: string;
  callTime: string;
  callerPhone: string;
  patientName?: string;
  duration: number;
  summary: string;
  outcome: CallOutcome;
  actionNeeded: CallAction;
  linkedAppointmentId?: string;
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
  dateRange?: { start: string; end: string };
  outcome?: CallOutcome;
  emergencyOnly?: boolean;
  callbackOnly?: boolean;
  appointmentRequestOnly?: boolean;
  actionNeeded?: boolean;
}
