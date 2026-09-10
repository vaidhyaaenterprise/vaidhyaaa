export type AnsweringMode = 'off' | 'always_on' | 'after_hours_only' | 'overflow_after_n_rings' | 'holiday_only';
export type BookingMode = 'pending_confirmation' | 'auto_confirm';
export type NotificationChannel = 'whatsapp' | 'sms' | 'email' | 'none';
export type Language = 'ta_tanglish' | 'english' | 'tamil';
export type SubscriptionStatus = 'trialing' | 'active' | 'manual_free' | 'expired' | 'past_due' | 'canceled';

export interface AgentSettings {
  agentEnabled: boolean;
  answeringMode: AnsweringMode;
  bookingMode: BookingMode;
  fallbackPhone: string;
  overflowAfterRings: number;
  onboardingComplete: boolean;
}

export interface NotificationSettings {
  notifyStaffOnPendingAppointment: boolean;
  pendingNotificationChannel: NotificationChannel;
  notificationContacts?: string[];
}

export interface LanguageSettings {
  supportedLanguages: Language[];
  clinicLanguages: Language[];
  defaultLanguage: Language;
  missingTemplates: Language[];
}

export interface SubscriptionUsage {
  voiceMinutesUsed: number;
  voiceMinutesIncluded: number;
  callsThisMonth: number;
  overageMinutes?: number;
}

export interface SubscriptionPlan {
  planKey: string;
  planName: string;
  status: SubscriptionStatus;
  includedVoiceMinutes: number;
  usedVoiceMinutes: number;
  maxConcurrentCalls: number;
  recordingRetentionDays: number;
  transcriptRetentionDays: number;
  trialEnd?: string;
  overageMinutes?: number;
  notes?: string;
}

export interface NotificationEvent {
  id: string;
  type: 'appointment_confirmation' | 'callback_request' | 'emergency_alert';
  status: 'sent' | 'failed' | 'pending';
  recipient: string;
  channel: NotificationChannel;
  timestamp: string;
  errorMessage?: string;
}

export interface PlatformSubscriptionChange {
  planKey: string;
  status: SubscriptionStatus;
  trialEnd?: string;
  notes?: string;
}

export interface TemplateCoverage {
  templateKey: string;
  taTanglishExists: boolean;
  englishExists: boolean;
}

export interface SubscriptionPlanOption {
  planKey: string;
  planName: string;
}
