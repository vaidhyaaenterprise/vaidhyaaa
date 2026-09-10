export type OnboardingStatus = 'not_started' | 'in_progress' | 'complete';
export type ClinicStatus = 'active' | 'suspended';
export type PlanType = 'pilot' | 'starter' | 'professional' | 'enterprise';
export type Language = 'ta_tanglish' | 'english' | 'tamil';

export interface Clinic {
  id: string;
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  country: string;
  timezone: string;
  fallbackPhone: string;
  defaultLanguage: Language;
  plan: PlanType;
  status: ClinicStatus;
  onboardingStatus: OnboardingStatus;
  agentEnabled: boolean;
  createdAt: string;
  adminName?: string;
  adminPhone?: string;
  adminEmail?: string;
}

export interface OnboardingChecklist {
  clinicDetails: boolean;
  adminUser: boolean;
  clinicHours: boolean;
  doctors: boolean;
  services: boolean;
  doctorServiceMapping: boolean;
  schedules: boolean;
  bookingRules: boolean;
  knowledgeBase: boolean;
  telephonySetup: boolean;
  testConversation: boolean;
  readyForAgent: boolean;
}

export interface CreateClinicData {
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  country: string;
  timezone: string;
  fallbackPhone: string;
  defaultLanguage: Language;
  plan: PlanType;
  adminName: string;
  adminPhone: string;
  adminEmail: string;
}

export interface NotificationEventItem {
  id: string;
  createdAt: string;
  clinicName: string;
  eventType: string;
  channel: string;
  recipient: string;
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';
  attempts: number;
  lastError: string | null;
  providerMessageId: string | null;
  payload: Record<string, unknown>;
}

export interface JobHealth {
  queueMode: 'inline' | 'bullmq';
  redisConnected: boolean;
  pendingJobs: number;
  failedJobs: number;
  lastRunSlotGeneration: string | null;
  lastRunHoldExpiry: string | null;
  lastRunRecordingCleanup: string | null;
  lastRunTranscriptCleanup: string | null;
}

export interface JobRunLog {
  id: string;
  jobName: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'completed' | 'failed';
  processedCount: number;
  error: string | null;
}
