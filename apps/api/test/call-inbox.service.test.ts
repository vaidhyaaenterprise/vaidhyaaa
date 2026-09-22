import { describe, expect, it, vi } from 'vitest';

import type { DatabaseConnection, Repositories } from '@vaidya/db';

import { CallInboxService } from '../src/modules/call-inbox/call-inbox.service';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';

function date(hour: number) {
  return new Date(`2026-09-22T${String(hour).padStart(2, '0')}:00:00.000Z`);
}

function makeService(data: {
  calls?: unknown[];
  bookings?: unknown[];
  actions?: unknown[];
  callbacks?: unknown[];
  emergencies?: unknown[];
  inquiries?: unknown[];
}) {
  const service = new CallInboxService({ db: {} } as DatabaseConnection);
  const callInbox = {
    listCalls: vi.fn().mockResolvedValue(data.calls ?? []),
    listVoiceAppointmentBookings: vi.fn().mockResolvedValue(data.bookings ?? []),
    listAppointmentCallActions: vi.fn().mockResolvedValue(data.actions ?? []),
    listCallbackRequests: vi.fn().mockResolvedValue(data.callbacks ?? []),
    listEmergencyIncidents: vi.fn().mockResolvedValue(data.emergencies ?? []),
    listVoiceInquiryMessages: vi.fn().mockResolvedValue(data.inquiries ?? []),
  } as unknown as Repositories['callInbox'];
  (service as unknown as { repos: Repositories }).repos = {
    callInbox,
  } as Repositories;
  return { service, callInbox };
}

function call(id: string, sessionId: string, outcome: string, hour: number) {
  return {
    id,
    clinicId: CLINIC_ID,
    sessionId,
    patientPhone: '9876543210',
    patientId: null,
    patientName: 'Patient',
    provider: 'test',
    providerCallId: `provider-${id}`,
    startedAt: date(hour),
    endedAt: date(hour + 1),
    durationSeconds: 60,
    outcome,
    summary: `${outcome} summary`,
    recordingUrl: null,
    recordingStorageKey: null,
    recordingExpiresAt: null,
    recordingDeletedAt: null,
    transcriptExpiresAt: null,
    createdAppointmentRequestId: null,
    createdCallbackRequestId: null,
    createdAt: date(hour),
    updatedAt: date(hour),
  };
}

describe('CallInboxService', () => {
  it('normalizes canonical DB sources and suppresses duplicate raw call outcomes', async () => {
    const callbackCall = call('call-callback', 'session-callback', 'callback_requested', 5);
    const { service } = makeService({
      calls: [
        callbackCall,
        call('call-inquiry', 'session-inquiry', 'general_inquiry', 4),
        call('call-inquiry-reconnect', 'session-inquiry', 'general_inquiry', 3),
        call('call-transport', 'session-transport', 'answered', 3),
      ],
      bookings: [
        {
          id: 'booking-1',
          clinicId: CLINIC_ID,
          sourceSessionId: 'session-booking',
          patientPhone: '9000000001',
          patientName: 'Booked patient',
          patientId: null,
          status: 'pending_confirmation',
          reasonForVisit: 'Consultation',
          createdAt: date(1),
          updatedAt: date(1),
        },
      ],
      actions: [
        {
          id: 'action-cancel',
          clinicId: CLINIC_ID,
          appointmentId: 'appointment-cancelled',
          requestType: 'cancel',
          status: 'completed',
          reason: 'Patient requested cancellation',
          sourceCallId: null,
          sourceSessionId: 'session-cancel',
          createdAt: date(2),
          updatedAt: date(2),
          patientName: 'Cancelled patient',
          patientPhone: '9000000002',
          patientId: null,
          reasonForVisit: 'Consultation',
        },
        {
          id: 'action-reschedule',
          clinicId: CLINIC_ID,
          appointmentId: 'appointment-rescheduled',
          requestType: 'reschedule',
          status: 'pending',
          reason: 'Needs another day',
          sourceCallId: null,
          sourceSessionId: 'session-reschedule',
          createdAt: date(3),
          updatedAt: date(3),
          patientName: 'Rescheduled patient',
          patientPhone: '9000000003',
          patientId: null,
          reasonForVisit: 'Consultation',
        },
      ],
      callbacks: [
        {
          id: 'callback-1',
          clinicId: CLINIC_ID,
          patientName: 'Callback patient',
          patientPhone: '9000000004',
          reason: 'Call later',
          status: 'pending',
          sourceSessionId: 'session-callback',
          sourceCallId: 'call-callback',
          createdAt: date(5),
          updatedAt: date(5),
        },
      ],
      emergencies: [
        {
          id: 'emergency-1',
          clinicId: CLINIC_ID,
          patientPhone: '9000000005',
          patientName: 'Emergency patient',
          messageText: 'Urgent help',
          detectedReason: 'Emergency keywords',
          sourceSessionId: 'session-emergency',
          sourceCallId: null,
          status: 'alert_created',
          createdAt: date(6),
          updatedAt: date(6),
        },
      ],
    });

    const result = await service.list({ clinicId: CLINIC_ID, limit: 200 });

    expect(result.items.map((item) => item.outcome).sort()).toEqual([
      'appointment_booked',
      'appointment_cancelled',
      'appointment_rescheduled',
      'callback_requested',
      'emergency',
      'general_inquiry',
    ]);
    expect(result.items.filter((item) => item.outcome === 'callback_requested')).toHaveLength(1);
    expect(result.items.some((item) => item.source_id === 'call-transport')).toBe(false);
    expect(
      result.items.find((item) => item.source_id === 'action-reschedule')?.action_needed,
    ).toBe('appointment_action_needed');
  });

  it('applies multiple outcomes with OR semantics', async () => {
    const { service } = makeService({
      calls: [
        call('call-booked', 'session-booked', 'appointment_booked', 2),
        call('call-cancelled', 'session-cancelled', 'appointment_cancelled', 3),
        call('call-emergency', 'session-emergency', 'emergency', 4),
      ],
    });

    const result = await service.list({
      clinicId: CLINIC_ID,
      outcomes: ['appointment_booked', 'appointment_cancelled'],
      limit: 200,
    });

    expect(result.items.map((item) => item.outcome).sort()).toEqual([
      'appointment_booked',
      'appointment_cancelled',
    ]);
  });

  it('derives enquiries from voice intents and never from generic completed calls', async () => {
    const { service } = makeService({
      calls: [
        call('call-enquiry', 'session-enquiry', 'completed', 2),
        call('call-completed', 'session-completed', 'completed', 3),
      ],
      inquiries: [
        {
          id: 'message-enquiry',
          clinicId: CLINIC_ID,
          sessionId: 'session-enquiry',
          intent: 'ask_timing',
          messageText: 'The clinic is open from nine to five.',
          patientPhone: '9000000006',
          patientId: null,
          patientName: 'Inquiry patient',
          createdAt: date(2),
        },
      ],
    });

    const result = await service.list({ clinicId: CLINIC_ID, limit: 200 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      source_id: 'message-enquiry',
      outcome: 'general_inquiry',
      source_status: 'ask_timing',
    });
    expect(result.items.some((item) => item.source_id === 'call-completed')).toBe(false);
  });

  it('only marks active callback and emergency records as needing action', async () => {
    const { service } = makeService({
      callbacks: [
        {
          id: 'callback-cancelled',
          clinicId: CLINIC_ID,
          patientName: null,
          patientPhone: '9000000007',
          reason: null,
          status: 'cancelled',
          sourceSessionId: 'session-callback-cancelled',
          sourceCallId: null,
          createdAt: date(2),
          updatedAt: date(2),
        },
      ],
      emergencies: [
        {
          id: 'emergency-closed',
          clinicId: CLINIC_ID,
          patientPhone: '9000000008',
          patientName: null,
          messageText: null,
          detectedReason: null,
          sourceSessionId: 'session-emergency-closed',
          sourceCallId: null,
          status: 'closed',
          createdAt: date(3),
          updatedAt: date(3),
        },
      ],
    });

    const result = await service.list({ clinicId: CLINIC_ID, limit: 200 });

    expect(result.items).toHaveLength(2);
    expect(result.items.every((item) => item.action_needed === 'none')).toBe(true);
  });
});
