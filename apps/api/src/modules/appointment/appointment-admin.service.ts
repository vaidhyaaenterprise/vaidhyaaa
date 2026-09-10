import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';
import { AppError, type ManualAppointmentCreateInput, type ResolveAppointmentActionRequestInput } from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../database/database.module';
import type { DatabaseConnection } from '@vaidya/db';

import { AppointmentLifecycleService } from './appointment-lifecycle.service';

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

function sameDateValue(left: string | null, right: string | null): boolean {
  return left === right;
}

@Injectable()
export class AppointmentAdminService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(AppointmentLifecycleService)
    private readonly lifecycleService: AppointmentLifecycleService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async createManualAppointment(
    clinicId: string,
    input: ManualAppointmentCreateInput,
    actorUserId: string,
  ) {
    let slotId: string | null = input.slot_id ?? null;
    let appointmentStart = input.appointment_start;
    let appointmentEnd = input.appointment_end;

    if (slotId) {
      const [slot] = await this.repos.slots.findOpenSlot(clinicId, slotId);

      if (!slot || slot.status !== 'open') {
        throw new AppError('VALIDATION_ERROR', 'Selected slot is not open. Choose another slot.');
      }

      if (slot.doctorId !== input.doctor_id || slot.clinicServiceId !== input.clinic_service_id) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Selected slot does not belong to the chosen doctor/service.',
        );
      }

      const activeAppointments = await this.repos.slots.countActiveAppointments(
        clinicId,
        slot.id,
      );

      const activeHolds = await this.repos.slots.countActiveHolds(clinicId, slot.id);

      if (activeAppointments + activeHolds >= slot.capacityTotal) {
        throw new AppError('VALIDATION_ERROR', 'Selected slot is full. Choose another slot.');
      }

      appointmentStart = slot.startTime;
      appointmentEnd = slot.endTime;
    } else {
      const slotWindow = await this.repos.slots.findSlotWindow(
        clinicId,
        input.doctor_id,
        input.clinic_service_id,
        input.appointment_start,
        input.appointment_end,
      );

      if (slotWindow[0]) {
        const activeAppointments = await this.repos.slots.countActiveAppointments(
          clinicId,
          slotWindow[0].id,
        );
        const activeHolds = await this.repos.slots.countActiveHolds(clinicId, slotWindow[0].id);
        if (activeAppointments + activeHolds < slotWindow[0].capacityTotal) {
          slotId = slotWindow[0].id;
          appointmentStart = slotWindow[0].startTime;
          appointmentEnd = slotWindow[0].endTime;
        }
      }
    }

    const [holiday] = await this.repos.slots.isDoctorHolidayForWindow(
      clinicId,
      input.doctor_id,
      appointmentStart,
      appointmentEnd,
    );
    if (holiday) {
      throw new AppError(
        'SLOT_NOT_AVAILABLE',
        'Selected doctor is unavailable due to holiday on this date.',
      );
    }

    if (!slotId && !input.override_reason) {
      throw new AppError(
        'VALIDATION_ERROR',
        'No open slot available. Provide override_reason for manual booking.',
      );
    }

    if (input.patient_date_of_birth) {
      const dob = new Date(input.patient_date_of_birth);
      if (Number.isNaN(dob.getTime())) {
        throw new AppError('VALIDATION_ERROR', 'Invalid patient_date_of_birth.');
      }
      if (dob > new Date()) {
        throw new AppError('VALIDATION_ERROR', 'patient_date_of_birth cannot be in the future.');
      }
    }

    let patientId: string | null = null;
    const normalizedName = normalizeName(input.patient_name);
    const normalizedPhone = input.patient_phone ? normalizePhone(input.patient_phone) : '';
    const requestedDob = input.patient_date_of_birth ?? null;

    if (!normalizedPhone || normalizedPhone.length < 8) {
      throw new AppError('VALIDATION_ERROR', 'patient_phone must contain at least 8 digits.');
    }

    if (input.patient_age < 0 || input.patient_age > 130) {
      throw new AppError('VALIDATION_ERROR', 'patient_age must be between 0 and 130.');
    }

    const candidates = await this.repos.patients.findByPhone(clinicId, normalizedPhone);

    const byName = candidates.filter((candidate) => {
      const candidateNormalizedName = candidate.normalizedName ?? normalizeName(candidate.name);
      return candidateNormalizedName === normalizedName;
    });

    const exactMatch = byName.find(
      (candidate) =>
        candidate.ageYears === input.patient_age &&
        sameDateValue(candidate.dateOfBirth ?? null, requestedDob),
    );

    const sameAgeMissingDob = requestedDob
      ? byName.find(
          (candidate) => candidate.ageYears === input.patient_age && (candidate.dateOfBirth ?? null) === null,
        )
      : undefined;

    const sameAgeAnyDob = requestedDob
      ? undefined
      : byName.find((candidate) => candidate.ageYears === input.patient_age);

    const sameDobUnknownAge = requestedDob
      ? byName.find(
          (candidate) =>
            (candidate.ageYears === null || candidate.ageYears === undefined) &&
            sameDateValue(candidate.dateOfBirth ?? null, requestedDob),
        )
      : undefined;

    const selectedPrecise = exactMatch ?? sameAgeMissingDob ?? sameAgeAnyDob ?? sameDobUnknownAge;

    if (!selectedPrecise && input.is_followup && byName.length > 1) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Multiple patient records match this phone and name. Add DOB to identify follow-up patient.',
      );
    }

    const selected = selectedPrecise ?? byName[0];

    if (selected) {
      const [updated] = await this.repos.patients.updatePatient(clinicId, selected.id, {
        name: input.patient_name,
        normalizedName,
        phone: input.patient_phone ?? null,
        normalizedPhone,
        ageYears: input.patient_age,
        ...(requestedDob !== null ? { dateOfBirth: requestedDob } : {}),
      });
      patientId = updated?.id ?? selected.id;

      if (selectedPrecise) {
        const duplicates = byName.filter((candidate) => candidate.id !== selectedPrecise.id);
        const shouldMergeDuplicates = input.is_followup ?? false;
        if (shouldMergeDuplicates) {
          for (const duplicate of duplicates) {
            if (duplicate.ageYears !== input.patient_age) {
              continue;
            }

            const duplicateDob = duplicate.dateOfBirth ?? null;
            if (
              requestedDob !== null &&
              duplicateDob !== null &&
              !sameDateValue(duplicateDob, requestedDob)
            ) {
              continue;
            }

            await this.repos.patients.reassignPatientReferences(
              clinicId,
              duplicate.id,
              selectedPrecise.id,
            );
            await this.repos.patients.deletePatient(clinicId, duplicate.id);
          }
        }
      }
    } else {
      const [created] = await this.repos.patients.insertPatient({
        clinicId,
        name: input.patient_name,
        normalizedName,
        phone: input.patient_phone ?? null,
        normalizedPhone,
        ageYears: input.patient_age,
        ...(requestedDob !== null ? { dateOfBirth: requestedDob } : {}),
      });
      patientId = created?.id ?? null;
    }

    let followupOfVisitId = input.followup_of_visit_id ?? null;
    if ((input.is_followup ?? false) && !followupOfVisitId && patientId) {
      const recentVisits = await this.repos.patients.listRecentVisits(clinicId, patientId, 1);
      followupOfVisitId = recentVisits[0]?.id ?? null;
    }

    const [appointment] = await this.repos.slots.insertAppointment({
      clinicId,
      slotId,
      slotHoldId: input.slot_hold_id ?? null,
      patientId,
      patientName: input.patient_name,
      patientPhone: input.patient_phone ?? null,
      doctorId: input.doctor_id,
      clinicServiceId: input.clinic_service_id,
      reasonForVisit: input.reason_for_visit,
      normalizedReason: input.reason_for_visit.toLowerCase(),
      appointmentStart,
      appointmentEnd,
      status: input.status ?? 'confirmed',
      isFollowup: input.is_followup ?? false,
      followupOfVisitId,
      routingSource: input.override_reason ? 'admin_action' : 'manual',
      sourceSessionId: input.source_session_id ?? null,
      createdByUserId: actorUserId,
    });

    if (!appointment) {
      throw new AppError('INTERNAL_ERROR', 'Failed to create appointment.');
    }

    await this.repos.appointmentLifecycle.insertAppointmentEvent({
      clinicId,
      appointmentRequestId: appointment.id,
      eventType: 'appointment.created_manual',
      actorType: 'clinic_admin',
      actorUserId,
      newValuesJson: {
        status: appointment.status,
        patient_age: input.patient_age,
        ...(input.patient_date_of_birth
          ? { patient_date_of_birth: input.patient_date_of_birth }
          : {}),
        ...(input.override_reason ? { override_reason: input.override_reason } : {}),
      },
    });

    return appointment;
  }

  async markVisited(input: {
    clinicId: string;
    appointmentId: string;
    visitReason: string;
    examinationNotes?: string;
    diagnosis?: string;
    advice?: string;
    actorUserId: string;
    actorClinicRole?: 'clinic_admin' | 'doctor';
  }) {
    const [appointment] = await this.repos.appointmentLifecycle.findAppointmentById(
      input.clinicId,
      input.appointmentId,
    );
    if (!appointment) {
      throw new AppError('APPOINTMENT_NOT_FOUND', 'Appointment not found.');
    }
    if (appointment.status !== 'confirmed') {
      throw new AppError('VALIDATION_ERROR', 'Only confirmed appointments can be marked visited.');
    }

    let patientId = appointment.patientId;
    if (!patientId && appointment.patientPhone) {
      const normalizedPhone = normalizePhone(appointment.patientPhone);
      const [patient] = await this.repos.patients.upsertByPhone({
        clinicId: input.clinicId,
        name: appointment.patientName,
        phone: appointment.patientPhone,
        normalizedPhone,
      });
      patientId = patient?.id ?? null;
    }
    if (!patientId) {
      throw new AppError('VALIDATION_ERROR', 'Patient record is required to mark a visit.');
    }

    const visitedAt = new Date();
    const [visit] = await this.repos.patients.insertVisit({
      clinicId: input.clinicId,
      patientId,
      appointmentRequestId: appointment.id,
      doctorId: appointment.doctorId,
      clinicServiceId: appointment.clinicServiceId,
      reasonForVisit: input.visitReason,
      examinationNotes: input.examinationNotes?.trim() || null,
      diagnosis: input.diagnosis?.trim() || null,
      advice: input.advice?.trim() || null,
      normalizedReason: input.visitReason.toLowerCase(),
      visitedAt,
    });

    const [updated] = await this.repos.slots.updateAppointmentStatus(
      input.clinicId,
      appointment.id,
      'visited',
    );

    await this.repos.appointmentLifecycle.insertAppointmentEvent({
      clinicId: input.clinicId,
      appointmentRequestId: appointment.id,
      eventType: 'appointment.visited',
      actorType: input.actorClinicRole === 'doctor' ? 'doctor' : 'clinic_admin',
      actorUserId: input.actorUserId,
      newValuesJson: {
        status: 'visited',
        visit_reason: input.visitReason,
        ...(input.examinationNotes?.trim() ? { examination_notes: input.examinationNotes.trim() } : {}),
        ...(input.diagnosis?.trim() ? { diagnosis: input.diagnosis.trim() } : {}),
        ...(input.advice?.trim() ? { advice: input.advice.trim() } : {}),
      },
      oldValuesJson: { status: appointment.status },
    });

    return { appointment: updated, patient_visit: visit };
  }

  async resolveActionRequest(input: {
    clinicId: string;
    actionRequestId: string;
    body: ResolveAppointmentActionRequestInput;
    actorUserId: string;
  }) {
    const [actionRequest] = await this.repos.appointmentLifecycle.findActionRequestById(
      input.clinicId,
      input.actionRequestId,
    );
    if (!actionRequest) {
      throw new AppError('NOT_FOUND', 'Action request not found.');
    }
    if (actionRequest.status !== 'pending') {
      throw new AppError('VALIDATION_ERROR', 'Action request is not pending.');
    }

    if (input.body.status === 'rejected') {
      const [updated] = await this.repos.appointmentLifecycle.updateActionRequest(
        input.clinicId,
        actionRequest.id,
        { status: 'rejected' },
      );
      return { action_request: updated };
    }

    if (actionRequest.requestType === 'cancel') {
      await this.lifecycleService.cancelAppointment({
        clinicId: input.clinicId,
        appointmentId: actionRequest.appointmentId,
        actorUserId: input.actorUserId,
      });
      const [updated] = await this.repos.appointmentLifecycle.updateActionRequest(
        input.clinicId,
        actionRequest.id,
        { status: 'approved' },
      );
      return { action_request: updated };
    }

    const slotId = input.body.new_slot_id ?? actionRequest.requestedNewSlotId;
    if (!slotId) {
      throw new AppError('VALIDATION_ERROR', 'new_slot_id is required to approve reschedule.');
    }

    const appointment = await this.lifecycleService.rescheduleAppointmentTime({
      clinicId: input.clinicId,
      appointmentId: actionRequest.appointmentId,
      newSlotId: slotId,
      actorUserId: input.actorUserId,
    });

    const [updated] = await this.repos.appointmentLifecycle.updateActionRequest(
      input.clinicId,
      actionRequest.id,
      { status: 'approved', requestedNewSlotId: slotId },
    );

    return { action_request: updated, appointment };
  }
}
