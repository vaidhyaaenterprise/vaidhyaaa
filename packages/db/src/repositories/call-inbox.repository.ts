import { and, asc, desc, eq, getTableColumns, gte, inArray, lt, lte, sql } from 'drizzle-orm';

import type { Database } from '../client';
import {
  appointmentActionRequests,
  appointmentRequests,
  callbackRequests,
  calls,
  callTranscripts,
  conversationMessages,
  conversationSessions,
  emergencyIncidents,
  patients,
} from '../schema';

type InboxDateRange = {
  from?: Date;
  to?: Date;
};

const MAX_SOURCE_ROWS = 500;

const GENERAL_INQUIRY_INTENTS = [
  'ask_clinic_identity',
  'ask_doctor_availability',
  'ask_fee',
  'ask_insurance',
  'ask_location',
  'ask_previsit_instruction',
  'ask_timing',
] as const;

/**
 * Reads the normalized source tables that feed the call inbox. The product's
 * six outcome labels are a projection over these canonical tables; keeping
 * that projection here avoids six duplicate write tables drifting apart.
 *
 * appointment_booked      -> appointment_requests
 * appointment_* action    -> appointment_action_requests
 * general_inquiry         -> conversation_messages (explicit enquiry intents)
 * callback_requested      -> callback_requests
 * emergency               -> emergency_incidents
 */
export class CallInboxRepository {
  constructor(private readonly db: Database) {}

  listCalls(clinicId: string, range: InboxDateRange = {}) {
    const filters = [eq(calls.clinicId, clinicId)];
    const occurredAt = sql`coalesce(${calls.startedAt}, ${calls.createdAt})`;
    if (range.from) filters.push(gte(occurredAt, range.from));
    if (range.to) filters.push(lte(occurredAt, range.to));

    return this.db
      .select({
        id: calls.id,
        clinicId: calls.clinicId,
        sessionId: calls.sessionId,
        patientPhone: calls.patientPhone,
        patientId: calls.patientId,
        patientName: patients.name,
        provider: calls.provider,
        providerCallId: calls.providerCallId,
        startedAt: calls.startedAt,
        endedAt: calls.endedAt,
        durationSeconds: calls.durationSeconds,
        outcome: calls.outcome,
        summary: calls.summary,
        recordingUrl: calls.recordingUrl,
        recordingStorageKey: calls.recordingStorageKey,
        recordingExpiresAt: calls.recordingExpiresAt,
        recordingDeletedAt: calls.recordingDeletedAt,
        transcriptExpiresAt: calls.transcriptExpiresAt,
        createdAppointmentRequestId: calls.createdAppointmentRequestId,
        createdCallbackRequestId: calls.createdCallbackRequestId,
        linkedAppointmentStart: appointmentRequests.appointmentStart,
        createdAt: calls.createdAt,
        updatedAt: calls.updatedAt,
      })
      .from(calls)
      .leftJoin(
        patients,
        and(eq(patients.clinicId, calls.clinicId), eq(patients.id, calls.patientId)),
      )
      .leftJoin(
        appointmentRequests,
        and(
          eq(appointmentRequests.clinicId, calls.clinicId),
          eq(appointmentRequests.id, calls.createdAppointmentRequestId),
        ),
      )
      .where(and(...filters))
      .orderBy(desc(sql`coalesce(${calls.startedAt}, ${calls.createdAt})`))
      .limit(MAX_SOURCE_ROWS);
  }

  listExpiredCalls(cutoff: Date, limit: number, clinicId?: string) {
    return this.db
      .select()
      .from(calls)
      .where(
        and(
          lt(sql`coalesce(${calls.startedAt}, ${calls.createdAt})`, cutoff),
          ...(clinicId ? [eq(calls.clinicId, clinicId)] : []),
        ),
      )
      .orderBy(asc(sql`coalesce(${calls.startedAt}, ${calls.createdAt})`), asc(calls.id))
      .limit(limit);
  }

  /** Delete call history, not the operational records created during a call. */
  deleteExpiredCall(clinicId: string, callId: string, cutoff: Date) {
    return this.db.transaction(async (tx) => {
      const callFilter = and(
        eq(calls.clinicId, clinicId),
        eq(calls.id, callId),
        lt(sql`coalesce(${calls.startedAt}, ${calls.createdAt})`, cutoff),
      );
      const [expired] = await tx
        .select({ id: calls.id })
        .from(calls)
        .where(callFilter)
        .for('update');
      if (!expired) return false;

      // Composite SET NULL foreign keys also include non-null clinic_id.
      // Detach only source_call_id explicitly before deleting the parent.
      for (const table of [appointmentActionRequests, callbackRequests, emergencyIncidents]) {
        await tx
          .update(table)
          .set({ sourceCallId: null })
          .where(and(eq(table.clinicId, clinicId), eq(table.sourceCallId, callId)));
      }
      await tx
        .delete(callTranscripts)
        .where(and(eq(callTranscripts.clinicId, clinicId), eq(callTranscripts.callId, callId)));
      await tx.delete(calls).where(callFilter);
      return true;
    });
  }

  listVoiceAppointmentBookings(clinicId: string, range: InboxDateRange = {}) {
    const filters = [eq(appointmentRequests.clinicId, clinicId)];
    if (range.from) filters.push(gte(appointmentRequests.createdAt, range.from));
    if (range.to) filters.push(lte(appointmentRequests.createdAt, range.to));

    return this.db
      .select({ ...getTableColumns(appointmentRequests) })
      .from(appointmentRequests)
      .innerJoin(
        conversationSessions,
        and(
          eq(conversationSessions.clinicId, appointmentRequests.clinicId),
          eq(conversationSessions.id, appointmentRequests.sourceSessionId),
          eq(conversationSessions.channel, 'voice_call'),
        ),
      )
      .where(and(...filters))
      .orderBy(desc(appointmentRequests.createdAt))
      .limit(MAX_SOURCE_ROWS);
  }

  listAppointmentCallActions(clinicId: string, range: InboxDateRange = {}) {
    const filters = [
      eq(appointmentActionRequests.clinicId, clinicId),
      inArray(appointmentActionRequests.requestType, ['cancel', 'reschedule']),
      inArray(appointmentActionRequests.status, ['pending', 'approved', 'completed']),
    ];
    if (range.from) filters.push(gte(appointmentActionRequests.createdAt, range.from));
    if (range.to) filters.push(lte(appointmentActionRequests.createdAt, range.to));

    return this.db
      .select({
        id: appointmentActionRequests.id,
        clinicId: appointmentActionRequests.clinicId,
        appointmentId: appointmentActionRequests.appointmentId,
        requestType: appointmentActionRequests.requestType,
        status: appointmentActionRequests.status,
        reason: appointmentActionRequests.reason,
        sourceCallId: appointmentActionRequests.sourceCallId,
        sourceSessionId: appointmentActionRequests.sourceSessionId,
        createdAt: appointmentActionRequests.createdAt,
        updatedAt: appointmentActionRequests.updatedAt,
        patientName: appointmentRequests.patientName,
        patientPhone: appointmentRequests.patientPhone,
        patientId: appointmentRequests.patientId,
        reasonForVisit: appointmentRequests.reasonForVisit,
        appointmentStart: appointmentRequests.appointmentStart,
      })
      .from(appointmentActionRequests)
      .innerJoin(
        appointmentRequests,
        and(
          eq(appointmentRequests.clinicId, appointmentActionRequests.clinicId),
          eq(appointmentRequests.id, appointmentActionRequests.appointmentId),
        ),
      )
      .innerJoin(
        conversationSessions,
        and(
          eq(conversationSessions.clinicId, appointmentActionRequests.clinicId),
          eq(conversationSessions.id, appointmentActionRequests.sourceSessionId),
          eq(conversationSessions.channel, 'voice_call'),
        ),
      )
      .where(and(...filters))
      .orderBy(desc(appointmentActionRequests.createdAt))
      .limit(MAX_SOURCE_ROWS);
  }

  listCallbackRequests(clinicId: string, range: InboxDateRange = {}) {
    const filters = [eq(callbackRequests.clinicId, clinicId)];
    if (range.from) filters.push(gte(callbackRequests.createdAt, range.from));
    if (range.to) filters.push(lte(callbackRequests.createdAt, range.to));

    return this.db
      .select({ ...getTableColumns(callbackRequests) })
      .from(callbackRequests)
      .innerJoin(
        conversationSessions,
        and(
          eq(conversationSessions.clinicId, callbackRequests.clinicId),
          eq(conversationSessions.id, callbackRequests.sourceSessionId),
          eq(conversationSessions.channel, 'voice_call'),
        ),
      )
      .where(and(...filters))
      .orderBy(desc(callbackRequests.createdAt))
      .limit(MAX_SOURCE_ROWS);
  }

  listEmergencyIncidents(clinicId: string, range: InboxDateRange = {}) {
    const filters = [eq(emergencyIncidents.clinicId, clinicId)];
    if (range.from) filters.push(gte(emergencyIncidents.createdAt, range.from));
    if (range.to) filters.push(lte(emergencyIncidents.createdAt, range.to));

    return this.db
      .select({ ...getTableColumns(emergencyIncidents) })
      .from(emergencyIncidents)
      .innerJoin(
        conversationSessions,
        and(
          eq(conversationSessions.clinicId, emergencyIncidents.clinicId),
          eq(conversationSessions.id, emergencyIncidents.sourceSessionId),
          eq(conversationSessions.channel, 'voice_call'),
        ),
      )
      .where(and(...filters))
      .orderBy(desc(emergencyIncidents.createdAt))
      .limit(MAX_SOURCE_ROWS);
  }

  listVoiceInquiryMessages(clinicId: string, range: InboxDateRange = {}) {
    const filters = [
      eq(conversationMessages.clinicId, clinicId),
      eq(conversationMessages.sender, 'assistant'),
      inArray(conversationMessages.intent, [...GENERAL_INQUIRY_INTENTS]),
    ];
    if (range.from) filters.push(gte(conversationMessages.createdAt, range.from));
    if (range.to) filters.push(lte(conversationMessages.createdAt, range.to));

    return this.db
      .select({
        id: conversationMessages.id,
        clinicId: conversationMessages.clinicId,
        sessionId: conversationMessages.sessionId,
        intent: conversationMessages.intent,
        messageText: conversationMessages.messageText,
        createdAt: conversationMessages.createdAt,
        patientPhone: conversationSessions.patientPhone,
        patientId: conversationSessions.patientId,
        patientName: patients.name,
      })
      .from(conversationMessages)
      .innerJoin(
        conversationSessions,
        and(
          eq(conversationSessions.clinicId, conversationMessages.clinicId),
          eq(conversationSessions.id, conversationMessages.sessionId),
          eq(conversationSessions.channel, 'voice_call'),
        ),
      )
      .leftJoin(
        patients,
        and(
          eq(patients.clinicId, conversationSessions.clinicId),
          eq(patients.id, conversationSessions.patientId),
        ),
      )
      .where(and(...filters))
      .orderBy(desc(conversationMessages.createdAt))
      .limit(MAX_SOURCE_ROWS);
  }
}
