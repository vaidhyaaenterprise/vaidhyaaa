import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type DatabaseConnection, type Repositories } from '@vaidya/db';
import type { CallInboxOutcome, CallInboxSource } from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../database/database.module';

type RepositoryCall = Awaited<ReturnType<Repositories['callInbox']['listCalls']>>[number];
type RepositoryInquiry = Awaited<
  ReturnType<Repositories['callInbox']['listVoiceInquiryMessages']>
>[number];

type CallInboxItem = {
  id: string;
  clinic_id: string;
  source_type: CallInboxSource;
  source_id: string;
  call_id: string | null;
  session_id: string | null;
  patient_phone: string | null;
  patient_name: string | null;
  patient_id: string | null;
  provider: string | null;
  provider_call_id: string | null;
  occurred_at: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  outcome: CallInboxOutcome;
  action_needed:
    | 'confirmation_needed'
    | 'appointment_action_needed'
    | 'callback_needed'
    | 'emergency_response'
    | 'none';
  summary: string | null;
  recording_url: string | null;
  recording_storage_key: string | null;
  recording_expires_at: string | null;
  recording_deleted_at: string | null;
  transcript_expires_at: string | null;
  created_appointment_request_id: string | null;
  created_callback_request_id: string | null;
  created_emergency_incident_id: string | null;
  appointment_action_request_id: string | null;
  source_status: string | null;
  created_at: string;
  updated_at: string;
};

const RAW_OUTCOME_ALIASES: Readonly<Record<string, CallInboxOutcome>> = {
  appointment_booked: 'appointment_booked',
  appointment_created: 'appointment_booked',
  booked: 'appointment_booked',
  appointment_cancelled: 'appointment_cancelled',
  appointment_canceled: 'appointment_cancelled',
  cancelled: 'appointment_cancelled',
  canceled: 'appointment_cancelled',
  appointment_rescheduled: 'appointment_rescheduled',
  rescheduled: 'appointment_rescheduled',
  general_inquiry: 'general_inquiry',
  clinic_enquiry: 'general_inquiry',
  clinic_inquiry: 'general_inquiry',
  inquiry: 'general_inquiry',
  callback_requested: 'callback_requested',
  callback_needed: 'callback_requested',
  emergency: 'emergency',
  emergency_case: 'emergency',
};

function iso(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

function actionFor(outcome: CallInboxOutcome, sourceStatus?: string | null): CallInboxItem['action_needed'] {
  if (outcome === 'appointment_booked' && sourceStatus === 'pending_confirmation') {
    return 'confirmation_needed';
  }
  if (
    (outcome === 'appointment_cancelled' || outcome === 'appointment_rescheduled') &&
    sourceStatus === 'pending'
  ) {
    return 'appointment_action_needed';
  }
  if (outcome === 'callback_requested' && sourceStatus === 'pending') {
    return 'callback_needed';
  }
  if (outcome === 'emergency' && sourceStatus === 'alert_created') {
    return 'emergency_response';
  }
  return 'none';
}

function normalizeRawOutcome(value: string | null): CallInboxOutcome | null {
  if (!value) return null;
  return RAW_OUTCOME_ALIASES[value.trim().toLowerCase()] ?? null;
}

function callFields(call: RepositoryCall | undefined) {
  return {
    call_id: call?.id ?? null,
    session_id: call?.sessionId ?? null,
    provider: call?.provider ?? null,
    provider_call_id: call?.providerCallId ?? null,
    started_at: iso(call?.startedAt),
    ended_at: iso(call?.endedAt),
    duration_seconds: call?.durationSeconds ?? null,
    recording_url: call?.recordingUrl ?? null,
    recording_storage_key: call?.recordingStorageKey ?? null,
    recording_expires_at: iso(call?.recordingExpiresAt),
    recording_deleted_at: iso(call?.recordingDeletedAt),
    transcript_expires_at: iso(call?.transcriptExpiresAt),
  };
}

@Injectable()
export class CallInboxService {
  private readonly repos: Repositories;

  constructor(@Inject(DATABASE_CONNECTION) connection: DatabaseConnection) {
    this.repos = createRepositories(connection.db);
  }

  async list(input: {
    clinicId: string;
    outcomes?: CallInboxOutcome[];
    from?: Date;
    to?: Date;
    limit: number;
  }): Promise<{ items: CallInboxItem[]; next_cursor: null }> {
    const range = {
      ...(input.from ? { from: input.from } : {}),
      ...(input.to ? { to: input.to } : {}),
    };
    const [calls, bookings, actions, callbacks, emergencies, inquiryMessages] = await Promise.all([
      this.repos.callInbox.listCalls(input.clinicId, range),
      this.repos.callInbox.listVoiceAppointmentBookings(input.clinicId, range),
      this.repos.callInbox.listAppointmentCallActions(input.clinicId, range),
      this.repos.callInbox.listCallbackRequests(input.clinicId, range),
      this.repos.callInbox.listEmergencyIncidents(input.clinicId, range),
      this.repos.callInbox.listVoiceInquiryMessages(input.clinicId, range),
    ]);

    // Calls are ordered newest-first. Keep the newest call for a session when a
    // provider retries or reconnects under the same conversation session.
    const callById = new Map(calls.map((call) => [call.id, call]));
    const callBySession = new Map<string, RepositoryCall>();
    const callByAppointmentRequest = new Map<string, RepositoryCall>();
    const callByCallbackRequest = new Map<string, RepositoryCall>();
    for (const call of calls) {
      if (call.sessionId && !callBySession.has(call.sessionId)) {
        callBySession.set(call.sessionId, call);
      }
      if (
        call.createdAppointmentRequestId &&
        !callByAppointmentRequest.has(call.createdAppointmentRequestId)
      ) {
        callByAppointmentRequest.set(call.createdAppointmentRequestId, call);
      }
      if (
        call.createdCallbackRequestId &&
        !callByCallbackRequest.has(call.createdCallbackRequestId)
      ) {
        callByCallbackRequest.set(call.createdCallbackRequestId, call);
      }
    }
    const callFor = (
      sourceCallId?: string | null,
      sourceSessionId?: string | null,
      reverseLinkedCall?: RepositoryCall,
    ) =>
      (sourceCallId ? callById.get(sourceCallId) : undefined) ??
      (sourceSessionId ? callBySession.get(sourceSessionId) : undefined) ??
      reverseLinkedCall;

    const representedRawCalls = new Set<string>();
    const representedSessions = new Set<string>();
    const items: CallInboxItem[] = [];
    const markRepresented = (call: RepositoryCall | undefined, sessionId?: string | null) => {
      if (call) representedRawCalls.add(call.id);
      const representedSessionId = sessionId ?? call?.sessionId;
      if (representedSessionId) representedSessions.add(representedSessionId);
    };

    for (const booking of bookings) {
      const call = callFor(
        null,
        booking.sourceSessionId,
        callByAppointmentRequest.get(booking.id),
      );
      markRepresented(call, booking.sourceSessionId);
      const occurredAt = call?.startedAt ?? booking.createdAt;
      items.push({
        id: booking.id,
        clinic_id: booking.clinicId,
        source_type: 'appointment_request',
        source_id: booking.id,
        ...callFields(call),
        session_id: booking.sourceSessionId ?? call?.sessionId ?? null,
        patient_phone: booking.patientPhone ?? call?.patientPhone ?? null,
        patient_name: booking.patientName || call?.patientName || null,
        patient_id: booking.patientId ?? call?.patientId ?? null,
        occurred_at: occurredAt.toISOString(),
        outcome: 'appointment_booked',
        action_needed: actionFor('appointment_booked', booking.status),
        summary: booking.reasonForVisit || call?.summary || null,
        created_appointment_request_id: booking.id,
        created_callback_request_id: null,
        created_emergency_incident_id: null,
        appointment_action_request_id: null,
        source_status: booking.status,
        created_at: booking.createdAt.toISOString(),
        updated_at: booking.updatedAt.toISOString(),
      });
    }

    for (const action of actions) {
      const outcome: CallInboxOutcome =
        action.requestType === 'cancel' ? 'appointment_cancelled' : 'appointment_rescheduled';
      const call = callFor(action.sourceCallId, action.sourceSessionId);
      markRepresented(call, action.sourceSessionId);
      const occurredAt = call?.startedAt ?? action.createdAt;
      items.push({
        id: action.id,
        clinic_id: action.clinicId,
        source_type: 'appointment_action_request',
        source_id: action.id,
        ...callFields(call),
        session_id: action.sourceSessionId ?? call?.sessionId ?? null,
        patient_phone: action.patientPhone ?? call?.patientPhone ?? null,
        patient_name: action.patientName || call?.patientName || null,
        patient_id: action.patientId ?? call?.patientId ?? null,
        occurred_at: occurredAt.toISOString(),
        outcome,
        action_needed: actionFor(outcome, action.status),
        summary: action.reason || action.reasonForVisit || call?.summary || null,
        created_appointment_request_id: action.appointmentId,
        created_callback_request_id: null,
        created_emergency_incident_id: null,
        appointment_action_request_id: action.id,
        source_status: action.status,
        created_at: action.createdAt.toISOString(),
        updated_at: action.updatedAt.toISOString(),
      });
    }

    for (const callback of callbacks) {
      const call = callFor(
        callback.sourceCallId,
        callback.sourceSessionId,
        callByCallbackRequest.get(callback.id),
      );
      markRepresented(call, callback.sourceSessionId);
      const occurredAt = call?.startedAt ?? callback.createdAt;
      items.push({
        id: callback.id,
        clinic_id: callback.clinicId,
        source_type: 'callback_request',
        source_id: callback.id,
        ...callFields(call),
        session_id: callback.sourceSessionId ?? call?.sessionId ?? null,
        patient_phone: callback.patientPhone ?? call?.patientPhone ?? null,
        patient_name: callback.patientName || call?.patientName || null,
        patient_id: call?.patientId ?? null,
        occurred_at: occurredAt.toISOString(),
        outcome: 'callback_requested',
        action_needed: actionFor('callback_requested', callback.status),
        summary: callback.reason || call?.summary || null,
        created_appointment_request_id: null,
        created_callback_request_id: callback.id,
        created_emergency_incident_id: null,
        appointment_action_request_id: null,
        source_status: callback.status,
        created_at: callback.createdAt.toISOString(),
        updated_at: callback.updatedAt.toISOString(),
      });
    }

    for (const emergency of emergencies) {
      const call = callFor(emergency.sourceCallId, emergency.sourceSessionId);
      markRepresented(call, emergency.sourceSessionId);
      const occurredAt = call?.startedAt ?? emergency.createdAt;
      items.push({
        id: emergency.id,
        clinic_id: emergency.clinicId,
        source_type: 'emergency_incident',
        source_id: emergency.id,
        ...callFields(call),
        session_id: emergency.sourceSessionId ?? call?.sessionId ?? null,
        patient_phone: emergency.patientPhone ?? call?.patientPhone ?? null,
        patient_name: emergency.patientName || call?.patientName || null,
        patient_id: call?.patientId ?? null,
        occurred_at: occurredAt.toISOString(),
        outcome: 'emergency',
        action_needed: actionFor('emergency', emergency.status),
        summary: emergency.detectedReason || emergency.messageText || call?.summary || null,
        created_appointment_request_id: null,
        created_callback_request_id: null,
        created_emergency_incident_id: emergency.id,
        appointment_action_request_id: null,
        source_status: emergency.status,
        created_at: emergency.createdAt.toISOString(),
        updated_at: emergency.updatedAt.toISOString(),
      });
    }

    // A clinic enquiry is derived from an explicit information-seeking intent
    // persisted for a voice session. Generic telephony states (for example,
    // "completed") are deliberately not treated as enquiries.
    const inquiryBySession = new Map<string, RepositoryInquiry>();
    for (const inquiry of inquiryMessages) {
      if (!inquiryBySession.has(inquiry.sessionId)) {
        inquiryBySession.set(inquiry.sessionId, inquiry);
      }
    }
    for (const inquiry of inquiryBySession.values()) {
      if (representedSessions.has(inquiry.sessionId)) continue;
      const call = callFor(null, inquiry.sessionId);
      markRepresented(call, inquiry.sessionId);
      const occurredAt = call?.startedAt ?? inquiry.createdAt;
      items.push({
        id: inquiry.id,
        clinic_id: inquiry.clinicId,
        source_type: 'conversation_message',
        source_id: inquiry.id,
        ...callFields(call),
        session_id: inquiry.sessionId,
        patient_phone: inquiry.patientPhone ?? call?.patientPhone ?? null,
        patient_name: inquiry.patientName ?? call?.patientName ?? null,
        patient_id: inquiry.patientId ?? call?.patientId ?? null,
        occurred_at: occurredAt.toISOString(),
        outcome: 'general_inquiry',
        action_needed: 'none',
        summary: inquiry.messageText || call?.summary || null,
        created_appointment_request_id: null,
        created_callback_request_id: null,
        created_emergency_incident_id: null,
        appointment_action_request_id: null,
        source_status: inquiry.intent,
        created_at: inquiry.createdAt.toISOString(),
        updated_at: inquiry.createdAt.toISOString(),
      });
    }

    // Backward-compatible fallback for integrations that already record one of
    // the six business outcomes directly on calls. Transport-only states such
    // as "answered", "forwarded", and "completed" are never shown as business
    // outcomes.
    const emittedRawSessions = new Set<string>();
    for (const call of calls) {
      if (
        representedRawCalls.has(call.id) ||
        (call.sessionId
          ? representedSessions.has(call.sessionId) || emittedRawSessions.has(call.sessionId)
          : false)
      ) {
        continue;
      }
      const outcome = normalizeRawOutcome(call.outcome);
      if (!outcome) continue;
      if (call.sessionId) emittedRawSessions.add(call.sessionId);
      const occurredAt = call.startedAt ?? call.createdAt;
      items.push({
        id: call.id,
        clinic_id: call.clinicId,
        source_type: 'call',
        source_id: call.id,
        ...callFields(call),
        patient_phone: call.patientPhone,
        patient_name: call.patientName,
        patient_id: call.patientId,
        occurred_at: occurredAt.toISOString(),
        outcome,
        action_needed: actionFor(outcome),
        summary: call.summary,
        created_appointment_request_id: call.createdAppointmentRequestId,
        created_callback_request_id: call.createdCallbackRequestId,
        created_emergency_incident_id: null,
        appointment_action_request_id: null,
        source_status: null,
        created_at: call.createdAt.toISOString(),
        updated_at: call.updatedAt.toISOString(),
      });
    }

    const selected = input.outcomes?.length ? new Set(input.outcomes) : null;
    const filtered = selected ? items.filter((item) => selected.has(item.outcome)) : items;
    filtered.sort(
      (left, right) =>
        Date.parse(right.occurred_at) - Date.parse(left.occurred_at) ||
        right.source_id.localeCompare(left.source_id),
    );

    return {
      items: filtered.slice(0, input.limit),
      next_cursor: null,
    };
  }
}
