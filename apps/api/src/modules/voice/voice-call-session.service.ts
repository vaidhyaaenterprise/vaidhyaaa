import { Inject, Injectable } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import { createRepositories, type Repositories } from '@vaidya/db';
import {
  ADAPTER_TOKENS,
  ANSWERING_MODES,
  AppError,
  type AuditService,
  type TelephonyProvider,
  type VoiceCallSessionService,
  type VoiceCallEventInput,
  type VoiceIncomingCallInput,
  type VoiceIncomingCallResponse,
  type VoiceRecordingReadyInput,
  type VoiceTranscriptTurnInput,
} from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { API_ENV } from '../../config/api-config.module';
import { DATABASE_CONNECTION } from '../database/database.module';
import { ConversationService } from '../conversation/conversation.service';
import { TemplateRenderer } from '../conversation/template-renderer.service';

import { CallRecordingStorageService } from './call-recording-storage.service';
import { VoiceAnsweringPolicyService } from './voice-answering-policy.service';

type AnsweringMode = (typeof ANSWERING_MODES)[number];

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

@Injectable()
export class VoiceCallSessionServiceImpl implements VoiceCallSessionService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(ConversationService) private readonly conversationService: ConversationService,
    @Inject(TemplateRenderer) private readonly templateRenderer: TemplateRenderer,
    @Inject(VoiceAnsweringPolicyService) private readonly answeringPolicy: VoiceAnsweringPolicyService,
    @Inject(CallRecordingStorageService) private readonly recordingStorage: CallRecordingStorageService,
    @Inject(ADAPTER_TOKENS.TelephonyProvider) private readonly telephony: TelephonyProvider,
    @Inject(ADAPTER_TOKENS.AuditService) private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async handleIncomingCall(input: VoiceIncomingCallInput): Promise<VoiceIncomingCallResponse> {
    const [telephonySettings] = await this.repos.voice.findTelephonyByProviderNumber(
      input.provider,
      input.provider_number,
    );
    if (!telephonySettings) {
      throw new AppError('NOT_FOUND', 'Clinic telephony mapping not found for provider number.');
    }

    const clinicId = telephonySettings.clinicId;
    const [settings] = await this.repos.clinics.findClinicSettings(clinicId);
    if (!settings) {
      throw new AppError('NOT_FOUND', 'Clinic settings not found.');
    }

    const decision = await this.answeringPolicy.evaluate({
      clinicId,
      agentEnabled: settings.agentEnabled,
      answeringMode: settings.answeringMode as AnsweringMode,
      fallbackPhone: settings.fallbackPhone,
      ...(input.overflow_forwarded !== undefined ? { overflowForwarded: input.overflow_forwarded } : {}),
    });

    const fallbackPhone = settings.fallbackPhone ?? telephonySettings.fallbackPhone;
    if (!decision.shouldAnswer) {
      const [call] = await this.repos.voice.createCall({
        clinicId,
        patientPhone: input.caller_phone,
        provider: input.provider,
        providerCallId: input.provider_call_id,
        startedAt: new Date(),
        outcome: 'forwarded',
        summary: decision.reason,
      });

      if (fallbackPhone && call) {
        await this.telephony.forwardCall(call.id, fallbackPhone);
      }

      await this.audit.log({
        clinicId,
        actorType: 'voice_webhook',
        eventType: 'voice.call_forwarded',
        entityType: 'call',
        ...(call?.id ? { entityId: call.id } : {}),
        newValues: {
          reason: decision.reason,
          forward_to: fallbackPhone,
          provider_call_id: input.provider_call_id,
        },
      });

      return {
        action: 'forward',
        forward_to: fallbackPhone ?? null,
        call_id: call?.id ?? null,
        session_id: null,
        greeting_text: null,
        reason: decision.reason,
      };
    }

    const session = await this.conversationService.createSession({
      clinic_id: clinicId,
      channel: 'voice_call',
      patient_phone: input.caller_phone,
    });

    const recordingRetentionDays = settings.recordingRetentionDays ?? this.env.DEFAULT_RECORDING_RETENTION_DAYS;
    const transcriptRetentionDays = settings.transcriptRetentionDays ?? this.env.DEFAULT_TRANSCRIPT_RETENTION_DAYS;
    const startedAt = new Date();

    const [call] = await this.repos.voice.createCall({
      clinicId,
      sessionId: session.id,
      patientPhone: input.caller_phone,
      provider: input.provider,
      providerCallId: input.provider_call_id,
      startedAt,
      outcome: 'answered',
      transcriptExpiresAt: addDays(startedAt, transcriptRetentionDays),
    });

    if (!call) {
      throw new AppError('INTERNAL_ERROR', 'Failed to create call row.');
    }

    const [clinic] = await this.repos.clinics.findClinicById(clinicId);
    const greeting = await this.templateRenderer.render(
      'booking.greeting',
      session.language_code as 'ta_tanglish' | 'english',
      {
        clinic_name: clinic?.name ?? 'Clinic',
      },
    );

    await this.audit.log({
      clinicId,
      actorType: 'voice_webhook',
      eventType: 'voice.call_answered',
      entityType: 'call',
      entityId: call.id,
      newValues: {
        session_id: session.id,
        provider_call_id: input.provider_call_id,
        recording_retention_days: recordingRetentionDays,
        transcript_retention_days: transcriptRetentionDays,
      },
    });

    return {
      action: 'answer',
      forward_to: null,
      call_id: call.id,
      session_id: session.id,
      greeting_text: greeting.message_text,
      reason: decision.reason,
    };
  }

  async processTranscriptTurn(
    callId: string,
    input: VoiceTranscriptTurnInput,
  ): Promise<Record<string, unknown>> {
    const call = await this.requireCall(callId);

    if (!call.sessionId) {
      throw new AppError('VALIDATION_ERROR', 'Call has no linked conversation session.');
    }

    if (
      input.stt_confidence !== undefined &&
      input.stt_confidence < this.env.VOICE_STT_LOW_CONFIDENCE_THRESHOLD
    ) {
      return {
        action: 'repeat_prompt',
        reason: 'stt_low_confidence',
        threshold: this.env.VOICE_STT_LOW_CONFIDENCE_THRESHOLD,
      };
    }

    await this.repos.voice.insertCallTranscript({
      clinicId: call.clinicId,
      callId: call.id,
      speaker: input.speaker,
      transcriptText: input.transcript_text,
      startedAtMs: input.started_at_ms ?? null,
      endedAtMs: input.ended_at_ms ?? null,
    });

    const messageResult = await this.conversationService.sendMessage(call.sessionId, {
      message_text: input.transcript_text,
      ...(input.idempotency_key ? { idempotency_key: input.idempotency_key } : {}),
    });

    if (messageResult.assistant_message.reply_template_key === 'safety.emergency') {
      await this.linkEmergencyToCall(call.clinicId, call.sessionId, call.id);
    }

    return {
      session: messageResult.session,
      patient_message: messageResult.patient_message,
      assistant_message: messageResult.assistant_message,
      tts_text: messageResult.assistant_message.message_text,
    };
  }

  async processCallEvent(
    callId: string,
    input: VoiceCallEventInput,
  ): Promise<Record<string, unknown>> {
    const call = await this.requireCall(callId);
    const endedAt = input.event_type === 'call_ended' ? new Date() : undefined;

    const [updated] = await this.repos.voice.updateCall(call.clinicId, call.id, {
      ...(input.outcome ? { outcome: input.outcome } : {}),
      ...(input.summary ? { summary: input.summary } : {}),
      ...(input.duration_seconds !== undefined ? { durationSeconds: input.duration_seconds } : {}),
      ...(endedAt ? { endedAt } : {}),
    });

    await this.audit.log({
      clinicId: call.clinicId,
      actorType: 'voice_webhook',
      eventType: `voice.${input.event_type}`,
      entityType: 'call',
      entityId: call.id,
      newValues: {
        outcome: input.outcome ?? null,
        duration_seconds: input.duration_seconds ?? null,
        metadata: input.metadata ?? {},
      },
    });

    return { call: updated ?? call };
  }

  async handleRecordingReady(
    callId: string,
    input: VoiceRecordingReadyInput,
  ): Promise<Record<string, unknown>> {
    const call = await this.requireCall(callId);
    const [settings] = await this.repos.clinics.findClinicSettings(call.clinicId);
    const retentionDays = settings?.recordingRetentionDays ?? this.env.DEFAULT_RECORDING_RETENTION_DAYS;
    const referenceTime = call.startedAt ?? new Date();
    const recordingExpiresAt = addDays(referenceTime, retentionDays);

    const stored = await this.recordingStorage.storeRecordingMetadata({
      clinicId: call.clinicId,
      callId: call.id,
      storageKey: input.storage_key,
      contentType: input.content_type,
      ...(input.size_bytes !== undefined ? { sizeBytes: input.size_bytes } : {}),
    });

    const [updated] = await this.repos.voice.updateCall(call.clinicId, call.id, {
      recordingStorageKey: stored.storageKey,
      recordingUrl: input.provider_recording_url ?? stored.recordingUrl,
      recordingExpiresAt,
    });

    await this.audit.log({
      clinicId: call.clinicId,
      actorType: 'voice_webhook',
      eventType: 'voice.recording_ready',
      entityType: 'call',
      entityId: call.id,
      newValues: {
        recording_storage_key: stored.storageKey,
        recording_expires_at: recordingExpiresAt.toISOString(),
      },
    });

    return {
      call: updated ?? call,
      recording_storage_key: stored.storageKey,
      recording_url: stored.recordingUrl,
      recording_expires_at: recordingExpiresAt.toISOString(),
    };
  }

  private async requireCall(callId: string) {
    const [call] = await this.repos.voice.findCallByIdGlobal(callId);
    if (!call) {
      throw new AppError('NOT_FOUND', 'Call not found.');
    }
    return call;
  }

  private async linkEmergencyToCall(clinicId: string, sessionId: string, callId: string) {
    await this.repos.appointmentLifecycle.linkLatestEmergencyToCall(clinicId, sessionId, callId);
    const [incident] = await this.repos.appointmentLifecycle.findLatestEmergencyForSession(
      clinicId,
      sessionId,
    );

    if (incident) {
      await this.audit.log({
        clinicId,
        actorType: 'voice_webhook',
        eventType: 'voice.emergency_detected',
        entityType: 'emergency_incident',
        entityId: incident.id,
        newValues: { call_id: callId, session_id: sessionId },
      });
    }
  }
}
