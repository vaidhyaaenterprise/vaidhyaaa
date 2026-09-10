import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';
import {
  ADAPTER_TOKENS,
  JOB_QUEUE_MAP,
  JOB_TYPES,
  type NotificationChannel,
  type NotificationEventType,
  type NotificationRecipientType,
  type QueueService,
} from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';

export type OutboxNotificationInput = {
  clinicId: string;
  eventType: NotificationEventType | string;
  recipientType: NotificationRecipientType;
  recipientPhone?: string | null;
  recipientEmail?: string | null;
  channel: NotificationChannel;
  templateKey: string;
  payload: Record<string, unknown>;
  deduplicationKey?: string | null;
  languageCode?: string | null;
  scheduledAt?: Date;
  maxAttempts?: number;
};

@Injectable()
export class NotificationOutboxService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(ADAPTER_TOKENS.QueueService) private readonly queueService: QueueService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async enqueue(input: OutboxNotificationInput) {
    const [event] = await this.repos.notification.insertWithDedup({
      clinicId: input.clinicId,
      eventType: input.eventType,
      recipientType: input.recipientType,
      recipientPhone: input.recipientPhone ?? null,
      recipientEmail: input.recipientEmail ?? null,
      channel: input.channel,
      templateKey: input.templateKey,
      payloadJson: input.payload,
      deduplicationKey: input.deduplicationKey ?? null,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: input.maxAttempts ?? 3,
      scheduledAt: input.scheduledAt ?? new Date(),
      ...(input.languageCode ? { languageCode: input.languageCode } : {}),
    });

    if (!event) {
      return null;
    }

    if (event.status === 'sent' || event.status === 'cancelled') {
      return event;
    }

    const recipient =
      event.recipientPhone ??
      event.recipientEmail ??
      (event.recipientType === 'clinic_admin' ? 'clinic_admin' : 'unknown');

    await this.queueService.enqueue({
      queue: JOB_QUEUE_MAP[JOB_TYPES.SEND_NOTIFICATION],
      jobType: JOB_TYPES.SEND_NOTIFICATION,
      jobId: `notification:${event.id}`,
      clinicId: input.clinicId,
      payload: {
        clinic_id: input.clinicId,
        notification_event_id: event.id,
        channel: event.channel,
        recipient,
        template_key: event.templateKey ?? input.templateKey,
        payload: (event.payloadJson ?? {}) as Record<string, unknown>,
      },
    });

    return event;
  }

  async notifyPatientAppointmentConfirmed(input: {
    clinicId: string;
    appointmentId: string;
    patientPhone: string;
    payload?: Record<string, unknown>;
  }) {
    return this.enqueue({
      clinicId: input.clinicId,
      eventType: 'appointment.confirmed',
      recipientType: 'patient',
      recipientPhone: input.patientPhone,
      channel: 'whatsapp',
      templateKey: 'booking.created_confirmed',
      payload: {
        appointment_id: input.appointmentId,
        ...input.payload,
      },
      deduplicationKey: `appointment.confirmed:${input.appointmentId}`,
    });
  }

  async notifyPatientAppointmentCancelled(input: {
    clinicId: string;
    appointmentId: string;
    patientPhone: string;
    payload?: Record<string, unknown>;
  }) {
    return this.enqueue({
      clinicId: input.clinicId,
      eventType: 'appointment.cancelled',
      recipientType: 'patient',
      recipientPhone: input.patientPhone,
      channel: 'whatsapp',
      templateKey: 'appointment.cancelled_patient',
      payload: {
        appointment_id: input.appointmentId,
        ...input.payload,
      },
      deduplicationKey: `appointment.cancelled.patient:${input.appointmentId}`,
    });
  }

  async notifyPatientAppointmentRescheduled(input: {
    clinicId: string;
    appointmentId: string;
    patientPhone: string;
    payload?: Record<string, unknown>;
  }) {
    return this.enqueue({
      clinicId: input.clinicId,
      eventType: 'appointment.rescheduled',
      recipientType: 'patient',
      recipientPhone: input.patientPhone,
      channel: 'whatsapp',
      templateKey: 'appointment.time_changed_patient',
      payload: {
        appointment_id: input.appointmentId,
        ...input.payload,
      },
      deduplicationKey: `appointment.rescheduled:${input.appointmentId}:${String(input.payload?.appointment_start ?? '')}`,
    });
  }

  async notifyStaffPendingAppointment(input: {
    clinicId: string;
    appointmentId: string;
    fallbackPhone: string | null;
    channel: NotificationChannel;
    payload?: Record<string, unknown>;
  }) {
    if (!input.fallbackPhone) {
      return null;
    }

    return this.enqueue({
      clinicId: input.clinicId,
      eventType: 'staff.pending_appointment',
      recipientType: 'clinic_admin',
      recipientPhone: input.fallbackPhone,
      channel: input.channel,
      templateKey: 'staff.pending_appointment',
      payload: {
        appointment_id: input.appointmentId,
        ...input.payload,
      },
      deduplicationKey: `staff.pending_appointment:${input.appointmentId}`,
    });
  }

  async notifyStaffActionRequest(input: {
    clinicId: string;
    eventType: 'staff.action_request' | 'staff.callback_request' | 'staff.emergency_alert' | 'appointment.cancelled';
    templateKey: string;
    deduplicationKey: string;
    fallbackPhone: string | null;
    channel: NotificationChannel;
    payload: Record<string, unknown>;
  }) {
    if (!input.fallbackPhone && input.channel !== 'dashboard') {
      return null;
    }

    return this.enqueue({
      clinicId: input.clinicId,
      eventType: input.eventType,
      recipientType: 'clinic_admin',
      recipientPhone: input.fallbackPhone,
      channel: input.channel,
      templateKey: input.templateKey,
      payload: input.payload,
      deduplicationKey: input.deduplicationKey,
    });
  }
}
