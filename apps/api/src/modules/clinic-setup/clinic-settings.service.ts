import { Inject, Injectable } from '@nestjs/common';

import {
  and,
  appointmentSlots,
  clinicHours,
  clinicServices,
  createRepositories,
  DatabaseService,
  doctorSchedules,
  doctorServiceBookingRules,
  doctorServices,
  doctors,
  eq,
  gt,
  sql,
  type Repositories,
} from '@vaidya/db';
import { AppError, type ClinicSettingsPatchInput } from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../database/database.module';
import type { DatabaseConnection } from '@vaidya/db';

export type AgentReadinessResult = {
  ready: boolean;
  missing: string[];
};

@Injectable()
export class ClinicSettingsService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(DatabaseService) private readonly dbService: DatabaseService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async getSettings(clinicId: string) {
    await this.dbService.findClinicById(clinicId);
    const [settings] = await this.repos.clinics.findClinicSettings(clinicId);
    if (!settings) {
      throw new AppError('NOT_FOUND', 'Clinic settings not found.', { clinic_id: clinicId });
    }
    return settings;
  }

  async getClinicProfile(clinicId: string) {
    await this.dbService.findClinicById(clinicId);
    const [profile] = await this.repos.clinics.getClinicLocation(clinicId);
    if (!profile) {
      throw new AppError('NOT_FOUND', 'Clinic not found.', { clinic_id: clinicId });
    }
    return profile;
  }

  async assessAgentReadiness(clinicId: string): Promise<AgentReadinessResult> {
    const missing: string[] = [];
    const [settings] = await this.repos.clinics.findClinicSettings(clinicId);
    if (!settings?.fallbackPhone) {
      missing.push('fallback_phone');
    }

    const db = this.dbService.database;
    const activeDoctors = await db
      .select({ id: doctors.id })
      .from(doctors)
      .where(and(eq(doctors.clinicId, clinicId), eq(doctors.active, true)))
      .limit(1);
    if (activeDoctors.length === 0) {
      missing.push('active_doctor');
    }

    const activeServices = await db
      .select({ id: clinicServices.id })
      .from(clinicServices)
      .where(and(eq(clinicServices.clinicId, clinicId), eq(clinicServices.active, true)))
      .limit(1);
    if (activeServices.length === 0) {
      missing.push('active_clinic_service');
    }

    const activeMappings = await db
      .select({ id: doctorServices.id })
      .from(doctorServices)
      .where(and(eq(doctorServices.clinicId, clinicId), eq(doctorServices.active, true)))
      .limit(1);
    if (activeMappings.length === 0) {
      missing.push('doctor_service_mapping');
    }

    const activeRules = await db
      .select({ id: doctorServiceBookingRules.id })
      .from(doctorServiceBookingRules)
      .where(and(eq(doctorServiceBookingRules.clinicId, clinicId), eq(doctorServiceBookingRules.active, true)))
      .limit(1);
    if (activeRules.length === 0) {
      missing.push('booking_rule');
    }

    const [hours] = await db
      .select({ id: clinicHours.id })
      .from(clinicHours)
      .where(and(eq(clinicHours.clinicId, clinicId), eq(clinicHours.active, true)))
      .limit(1);

    const [schedule] = await db
      .select({ id: doctorSchedules.id })
      .from(doctorSchedules)
      .where(and(eq(doctorSchedules.clinicId, clinicId), eq(doctorSchedules.active, true)))
      .limit(1);

    if (!hours && !schedule) {
      missing.push('clinic_hours_or_doctor_schedules');
    }

    const [futureSlot] = await db
      .select({ id: appointmentSlots.id })
      .from(appointmentSlots)
      .where(
        and(
          eq(appointmentSlots.clinicId, clinicId),
          gt(appointmentSlots.startTime, sql`now()`),
        ),
      )
      .limit(1);

    const canGenerateSlots = Boolean(schedule && activeRules.length > 0);
    if (!futureSlot && !canGenerateSlots) {
      missing.push('future_slots_or_slot_generation_ready');
    }

    return { ready: missing.length === 0, missing };
  }

  async patchSettings(
    clinicId: string,
    patch: ClinicSettingsPatchInput,
    actorUserId: string,
  ) {
    if (patch.agent_enabled === true) {
      const readiness = await this.assessAgentReadiness(clinicId);
      if (!readiness.ready) {
        await this.dbService.insertAuditLog({
          clinicId,
          actorUserId,
          actorType: 'clinic_admin',
          eventType: 'clinic.agent.enable_failed',
          entityType: 'clinic_settings',
          entityId: clinicId,
          newValues: { missing: readiness.missing },
          source: 'clinic_settings',
        });
        throw new AppError('CLINIC_SETUP_INCOMPLETE', 'Clinic setup is incomplete for agent enable.', {
          clinic_id: clinicId,
          missing: readiness.missing,
        });
      }
    }

    const [current] = await this.repos.clinics.findClinicSettings(clinicId);
    if (!current) {
      throw new AppError('NOT_FOUND', 'Clinic settings not found.', { clinic_id: clinicId });
    }

    const [updated] = await this.repos.clinics.updateClinicSettings(clinicId, {
      ...(patch.agent_enabled !== undefined ? { agentEnabled: patch.agent_enabled } : {}),
      ...(patch.answering_mode !== undefined ? { answeringMode: patch.answering_mode } : {}),
      ...(patch.fallback_phone !== undefined ? { fallbackPhone: patch.fallback_phone } : {}),
      ...(patch.overflow_after_rings !== undefined
        ? { overflowAfterRings: patch.overflow_after_rings }
        : {}),
      ...(patch.booking_mode !== undefined ? { bookingMode: patch.booking_mode } : {}),
      ...(patch.max_concurrent_calls !== undefined
        ? { maxConcurrentCalls: patch.max_concurrent_calls }
        : {}),
      ...(patch.recording_retention_days !== undefined
        ? { recordingRetentionDays: patch.recording_retention_days }
        : {}),
      ...(patch.transcript_retention_days !== undefined
        ? { transcriptRetentionDays: patch.transcript_retention_days }
        : {}),
      ...(patch.notify_staff_on_pending_appointment !== undefined
        ? { notifyStaffOnPendingAppointment: patch.notify_staff_on_pending_appointment }
        : {}),
      ...(patch.pending_appointment_notification_channel !== undefined
        ? {
            pendingAppointmentNotificationChannel:
              patch.pending_appointment_notification_channel,
          }
        : {}),
      ...(patch.allow_doctor_service_edit !== undefined
        ? { allowDoctorServiceEdit: patch.allow_doctor_service_edit }
        : {}),
      ...(patch.allow_patient_auto_cancel !== undefined
        ? { allowPatientAutoCancel: patch.allow_patient_auto_cancel }
        : {}),
      updatedByUserId: actorUserId,
    });

    if (!updated) {
      throw new AppError('INTERNAL_ERROR', 'Failed to update clinic settings.');
    }

    if (patch.agent_enabled !== undefined && patch.agent_enabled !== current.agentEnabled) {
      await this.dbService.insertAuditLog({
        clinicId,
        actorUserId,
        actorType: 'clinic_admin',
        eventType: patch.agent_enabled ? 'clinic.agent.enabled' : 'clinic.agent.disabled',
        entityType: 'clinic_settings',
        entityId: clinicId,
        oldValues: { agent_enabled: current.agentEnabled },
        newValues: { agent_enabled: patch.agent_enabled },
        source: 'clinic_settings',
      });
    }

    return updated;
  }
}
