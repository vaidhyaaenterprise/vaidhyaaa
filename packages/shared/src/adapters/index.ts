/**
 * Provider adapter interfaces — implementations are mock in C00, real in later milestones.
 */

export interface EnqueueJobInput {
  queue: string;
  jobType: string;
  payload: Record<string, unknown>;
  /** Unique id for deduplication when supported by the queue backend. */
  jobId?: string;
  correlationId?: string;
  clinicId?: string;
}

/** @deprecated Use {@link EnqueueJobInput} */
export interface QueueJobPayload {
  name: string;
  data: Record<string, unknown>;
}

export interface QueueService {
  enqueue(job: EnqueueJobInput): Promise<string>;
}

export interface LockService {
  acquire(key: string, ttlMs: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

export interface SchedulerService {
  scheduleRepeat(cron: string, jobName: string): Promise<void>;
}

export interface RateLimitService {
  check(key: string, limit: number, windowMs: number): Promise<boolean>;
}

export interface ObjectStoragePutInput {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
}

export interface ObjectStorageProvider {
  put(input: ObjectStoragePutInput): Promise<{ key: string }>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}

export interface NotificationSendInput {
  channel: 'whatsapp' | 'sms' | 'email' | 'dashboard';
  recipient: string;
  templateKey: string;
  payload: Record<string, unknown>;
}

export interface NotificationProvider {
  send(input: NotificationSendInput): Promise<{ providerMessageId: string }>;
}

export type MessagingSendInput = {
  recipient: string;
  templateKey: string;
  payload: Record<string, unknown>;
};

export interface MessagingProvider {
  sendWhatsApp(input: MessagingSendInput): Promise<{ providerMessageId: string }>;
  sendSms(input: MessagingSendInput): Promise<{ providerMessageId: string }>;
}

export interface TelephonyProvider {
  forwardCall(callId: string, destination: string): Promise<void>;
}

export interface SttTranscribeInput {
  audioUrl: string;
  languageHint?: string;
}

export interface SttProvider {
  transcribe(input: SttTranscribeInput): Promise<{ text: string }>;
}

export interface TtsSynthesizeInput {
  text: string;
  voice?: string;
}

export interface TtsProvider {
  synthesize(input: TtsSynthesizeInput): Promise<{ audioUrl: string }>;
}

export type VoiceAdapterIncomingCallInput = {
  provider: string;
  providerCallId: string;
  providerNumber: string;
  callerPhone: string;
  overflowForwarded?: boolean;
};

export type VoiceAdapterIncomingCallResult = {
  action: 'answer' | 'forward';
  forwardTo?: string | null;
  callId?: string | null;
  sessionId?: string | null;
  greetingText?: string | null;
  reason?: string;
};

export interface VoiceAdapter {
  handleIncomingCall(input: VoiceAdapterIncomingCallInput): Promise<VoiceAdapterIncomingCallResult>;
}

export type CallRecordingMetadataInput = {
  clinicId: string;
  callId: string;
  storageKey: string;
  contentType: string;
  sizeBytes?: number;
};

export type CallRecordingMetadataResult = {
  storageKey: string;
  recordingUrl: string;
};

export interface CallRecordingStorage {
  storeRecordingMetadata(input: CallRecordingMetadataInput): Promise<CallRecordingMetadataResult>;
}

export type VoiceTranscriptTurnRequest = {
  clinicId: string;
  callId: string;
  sessionId: string;
  transcriptText: string;
  speaker: 'patient' | 'assistant' | 'system';
  sttConfidence?: number;
  startedAtMs?: number;
  endedAtMs?: number;
  idempotencyKey?: string;
};

export type VoiceCallEventRequest = {
  clinicId: string;
  callId: string;
  eventType: string;
  outcome?: string;
  durationSeconds?: number;
  summary?: string;
  metadata?: Record<string, unknown>;
};

export interface VoiceCallSessionService {
  handleIncomingCall(
    input: import('../dto/voice-api').VoiceIncomingCallInput,
  ): Promise<import('../dto/voice-api').VoiceIncomingCallResponse>;
  processTranscriptTurn(
    callId: string,
    input: import('../dto/voice-api').VoiceTranscriptTurnInput,
  ): Promise<Record<string, unknown>>;
  processCallEvent(
    callId: string,
    input: import('../dto/voice-api').VoiceCallEventInput,
  ): Promise<Record<string, unknown>>;
  handleRecordingReady(
    callId: string,
    input: import('../dto/voice-api').VoiceRecordingReadyInput,
  ): Promise<Record<string, unknown>>;
}

export interface IntentClassifierInput {
  clinicId: string;
  sessionId?: string;
  messageText: string;
  currentFlow: string;
  currentState: string;
  languageCode: string;
  knownCollectedFields?: Record<string, unknown>;
  llmRuntime?: import('../agent/llm-latency').LlmRuntimeSettings;
}

export type IntentClassifierEntities = {
  patientName?: string | null;
  doctorName?: string | null;
  reasonForVisit?: string | null;
  date?: string | null;
  timePreference?: string | null;
  visitType?: string | null;
  dayName?: string | null;
  feeCategory?: 'consultation' | 'followup' | 'procedure' | null;
  topic?: string | null;
  requestedLanguageCode?: string | null;
};

export interface IntentClassifierResult {
  intent: string;
  confidence: number;
  languageCode: string;
  entities: IntentClassifierEntities;
  safety: {
    isEmergency: boolean;
    isMedicalAdviceRequest: boolean;
    reason?: string | null;
  };
  needsClarification: boolean;
  llmDebug?: import('../agent/llm-debug').LlmInvocationDebug;
}

export interface IntentClassifierAdapter {
  classify(input: IntentClassifierInput): Promise<IntentClassifierResult>;
}

export type {
  ActiveFlow,
  StateEntityExtractorEntities,
  StateEntityExtractorInput,
  StateEntityExtractorResult,
  StateRecognizedAs,
  SideQuestionIntent,
  MessageSafetyResult,
} from '../agent/state-entity-types';

export interface StateEntityExtractorAdapter {
  extract(input: import('../agent/state-entity-types').StateEntityExtractorInput): Promise<
    import('../agent/state-entity-types').StateEntityExtractorResult
  >;
}

export type ActiveClinicServiceProfile = {
  id: string;
  serviceKey: string;
  serviceName: string;
  handlesJson: unknown;
  doesNotHandleJson: unknown;
  redFlagsJson: unknown;
  routingExamplesJson: unknown;
};

export interface ServiceRouterInput {
  clinicId: string;
  reasonForVisit: string;
  patientAgeHint?: string | null;
  activeClinicServices: ActiveClinicServiceProfile[];
  llmRuntime?: import('../agent/llm-latency').LlmRuntimeSettings;
}

export interface ServiceRouterResult {
  matched: boolean;
  clinicServiceId?: string;
  serviceKey?: string;
  confidence: number;
  unsupportedReason?: string;
  needsClarification?: boolean;
  clarificationQuestion?: string;
}

export interface ServiceRouterAdapter {
  route(input: ServiceRouterInput): Promise<ServiceRouterResult>;
}

export interface ActionValidationContext {
  clinicId: string;
  actorUserId?: string;
  actorType: string;
  action: string;
  payload: Record<string, unknown>;
}

export interface ActionValidator {
  validateWrite(context: ActionValidationContext): Promise<void>;
  validateCreateAppointment(context: ActionValidationContext): Promise<void>;
}

export interface AuditLogInput {
  clinicId?: string;
  actorUserId?: string;
  actorType: string;
  eventType: string;
  entityType?: string;
  entityId?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  requestId?: string;
}

export interface AuditService {
  log(input: AuditLogInput): Promise<void>;
}

export const ADAPTER_TOKENS = {
  QueueService: Symbol('QueueService'),
  LockService: Symbol('LockService'),
  SchedulerService: Symbol('SchedulerService'),
  RateLimitService: Symbol('RateLimitService'),
  JobRegistry: Symbol('JobRegistry'),
  WorkerBootstrap: Symbol('WorkerBootstrap'),
  ObjectStorageProvider: Symbol('ObjectStorageProvider'),
  NotificationProvider: Symbol('NotificationProvider'),
  MessagingProvider: Symbol('MessagingProvider'),
  TelephonyProvider: Symbol('TelephonyProvider'),
  SttProvider: Symbol('SttProvider'),
  TtsProvider: Symbol('TtsProvider'),
  VoiceAdapter: Symbol('VoiceAdapter'),
  CallRecordingStorage: Symbol('CallRecordingStorage'),
  VoiceCallSessionService: Symbol('VoiceCallSessionService'),
  IntentClassifierAdapter: Symbol('IntentClassifierAdapter'),
  StateEntityExtractorAdapter: Symbol('StateEntityExtractorAdapter'),
  ServiceRouterAdapter: Symbol('ServiceRouterAdapter'),
  ActionValidator: Symbol('ActionValidator'),
  AuditService: Symbol('AuditService'),
  ReceptionistDialogPlannerAdapter: Symbol('ReceptionistDialogPlannerAdapter'),
} as const;

export type { ReceptionistDialogInput, ReceptionistDialogPlan } from '../agent/receptionist-dialog-types';
import type { ReceptionistDialogInput, ReceptionistDialogPlan } from '../agent/receptionist-dialog-types';

export interface ReceptionistDialogPlannerAdapter {
  plan(input: ReceptionistDialogInput): Promise<ReceptionistDialogPlan | null>;
}
