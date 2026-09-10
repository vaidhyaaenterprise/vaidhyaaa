import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';
import {
  type ActionValidationContext,
  type NotificationChannel,
} from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';
import { NotificationOutboxService } from '../notification/notification-outbox.service';
import { SlotHoldService } from '../slots/slot-hold.service';

import { BookingActionValidator } from './booking-action-validator';

export type CreateFromConfirmedHoldInput = {
  clinicId: string;
  sessionId: string;
  slotId: string;
  holdId: string;
  patientName: string;
  patientPhone?: string | null;
  patientId?: string | null;
  reasonForVisit: string;
  routingSource?: string | null;
};

export type CreateFromFreshHoldInput = {
  clinicId: string;
  sessionId?: string;
  slotId: string;
  patientName: string;
  patientPhone?: string | null;
  patientId?: string | null;
  reasonForVisit: string;
  routingSource?: string | null;
  expectedDoctorId?: string;
};

@Injectable()
export class BookingAppointmentService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(SlotHoldService) private readonly slotHoldService: SlotHoldService,
    @Inject(BookingActionValidator) private readonly actionValidator: BookingActionValidator,
    @Inject(NotificationOutboxService) private readonly notificationOutbox: NotificationOutboxService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async createFromConfirmedHold(input: CreateFromConfirmedHoldInput) {
    const validationContext: ActionValidationContext = {
      clinicId: input.clinicId,
      actorType: 'patient',
      action: 'create_appointment',
      payload: {
        slot_id: input.slotId,
        hold_id: input.holdId,
        patient_name: input.patientName,
        reason_for_visit: input.reasonForVisit,
        session_id: input.sessionId,
      },
    };
    await this.actionValidator.validateCreateAppointment(validationContext);

    const [hold] = await this.repos.slots.findActiveHoldForSession(input.clinicId, input.sessionId);
    const holdIsActive = hold && hold.id === input.holdId && hold.holdExpiresAt > new Date();

    const appointment = holdIsActive
      ? await this.slotHoldService.createAppointmentFromHold({
          clinicId: input.clinicId,
          slotId: input.slotId,
          holdId: input.holdId,
          patientName: input.patientName,
          ...(input.patientPhone ? { patientPhone: input.patientPhone } : {}),
          reasonForVisit: input.reasonForVisit,
          sessionId: input.sessionId,
          patientId: input.patientId ?? null,
          routingSource: input.routingSource ?? null,
        })
      : await this.slotHoldService.confirmAfterExpiredHold({
          clinicId: input.clinicId,
          slotId: input.slotId,
          holdId: input.holdId,
          patientName: input.patientName,
          ...(input.patientPhone ? { patientPhone: input.patientPhone } : {}),
          reasonForVisit: input.reasonForVisit,
          sessionId: input.sessionId,
          patientId: input.patientId ?? null,
          routingSource: input.routingSource ?? null,
        });

    return this.finalizeAppointment(input, appointment);
  }

  async createAppointmentFromFreshHold(input: CreateFromFreshHoldInput) {
    const { appointment, hold } = await this.slotHoldService.holdSlotAndCreateAppointment({
      clinicId: input.clinicId,
      slotId: input.slotId,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.patientPhone ? { patientPhone: input.patientPhone } : {}),
      patientId: input.patientId ?? null,
      patientName: input.patientName,
      reasonForVisit: input.reasonForVisit,
      routingSource: input.routingSource ?? null,
      ...(input.expectedDoctorId ? { expectedDoctorId: input.expectedDoctorId } : {}),
    });

    const finalized = await this.finalizeAppointment(input, appointment);
    return { appointment: finalized, hold };
  }

  private async finalizeAppointment(
    input: { clinicId: string; patientName: string; patientPhone?: string | null; sessionId?: string },
    appointment: { id: string; status: string },
  ) {
    const [[settings], [subscription]] = await Promise.all([
      this.repos.clinics.findClinicSettings(input.clinicId),
      this.repos.platform.findClinicSubscription(input.clinicId),
    ]);
    const snapshot =
      subscription?.planSnapshotJson && typeof subscription.planSnapshotJson === 'object'
        ? (subscription.planSnapshotJson as { auto_confirm_allowed?: boolean })
        : null;
    const planAllowsAutoConfirm = Boolean(snapshot?.auto_confirm_allowed);

    const bookingMode = settings?.bookingMode ?? 'pending_confirmation';
    if (bookingMode === 'auto_confirm' && planAllowsAutoConfirm) {
      const [confirmed] = await this.repos.slots.updateAppointmentStatus(
        input.clinicId,
        appointment.id,
        'confirmed',
      );
      if (confirmed && input.patientPhone) {
        await this.notificationOutbox.notifyPatientAppointmentConfirmed({
          clinicId: input.clinicId,
          appointmentId: appointment.id,
          patientPhone: input.patientPhone,
        });
      }
      return confirmed ?? appointment;
    }

    if (settings?.notifyStaffOnPendingAppointment) {
      await this.notificationOutbox.notifyStaffPendingAppointment({
        clinicId: input.clinicId,
        appointmentId: appointment.id,
        fallbackPhone: settings.fallbackPhone ?? null,
        channel: (settings.pendingAppointmentNotificationChannel ?? 'whatsapp') as NotificationChannel,
        payload: {
          patient_name: input.patientName,
          patient_phone: input.patientPhone ?? null,
          session_id: input.sessionId ?? null,
        },
      });
    }

    return appointment;
  }
}
