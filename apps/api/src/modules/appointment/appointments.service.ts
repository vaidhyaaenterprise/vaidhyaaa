import { Inject, Injectable } from '@nestjs/common';

import {
  appointmentRequests,
  createRepositories,
  DatabaseService,
  formatDateInTimezone,
  type Repositories,
} from '@vaidya/db';
import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';
import { SlotService } from '../slots/slot.service';
import { SlotGenerationService } from '../slots/slot-generation.service';

export type AppointmentListItem = {
  id: string;
  patient_name: string;
  patient_phone: string | null;
  doctor_id: string;
  doctor_name: string;
  clinic_service_id: string;
  service_name: string;
  appointment_start: string;
  appointment_end: string;
  reason_for_visit: string;
  visit_type: 'new' | 'follow_up';
  routing_source: string | null;
  source: 'agent' | 'manual';
  status: string;
  has_history: boolean;
  visit_reason?: string | null;
  examination_notes?: string | null;
  diagnosis?: string | null;
  advice?: string | null;
};

export type AppointmentActionRequestItem = {
  id: string;
  appointment_id: string;
  patient_name: string;
  doctor_id: string;
  doctor_name: string;
  clinic_service_id: string;
  service_name: string;
  requested_date: string | null;
  requested_time_preference: string | null;
  requested_new_slot_id: string | null;
  reason: string | null;
  action_type: 'cancel' | 'reschedule';
  status: string;
};

export type AppointmentAvailableSlotItem = {
  slot_id: string;
  doctor_id: string;
  clinic_service_id: string;
  appointment_start: string;
  appointment_end: string;
  available_count: number;
};

function slotDatePart(value: string): string {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) {
    return match[1] ?? '';
  }
  return value.split(/[T\s]/)[0] ?? '';
}

@Injectable()
export class AppointmentsService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(DatabaseService) private readonly dbService: DatabaseService,
    @Inject(SlotService) private readonly slotService: SlotService,
    @Inject(SlotGenerationService)
    private readonly slotGenerationService: SlotGenerationService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  getAppointment(clinicId: string, appointmentId: string) {
    return this.dbService.getClinicScopedRecordOrThrow<typeof appointmentRequests.$inferSelect>(
      appointmentRequests,
      clinicId,
      appointmentId,
      'APPOINTMENT_NOT_FOUND',
    );
  }

  async listAppointments(input: {
    clinicId: string;
    doctorId?: string | null;
    status?: string[];
  }): Promise<AppointmentListItem[]> {
    const rows = await this.repos.appointmentLifecycle.listAppointmentsForClinic({
      clinicId: input.clinicId,
      ...(input.doctorId ? { doctorId: input.doctorId } : {}),
      ...(input.status?.length ? { statuses: input.status } : {}),
    });

    const doctorMap = new Map(
      (await this.repos.clinical.listDoctors(input.clinicId)).map((doctor) => [
        doctor.id,
        doctor.name,
      ]),
    );
    const serviceMap = new Map(
      (await this.repos.clinical.listServices(input.clinicId)).map((service) => [
        service.id,
        service.serviceName,
      ]),
    );

    const visitedAppointmentIds = rows
      .filter((row) => row.status === 'visited')
      .map((row) => row.id);
    const visits = await this.repos.patients.listVisitsByAppointmentIds(
      input.clinicId,
      visitedAppointmentIds,
    );
    const visitByAppointmentId = new Map<string, (typeof visits)[number]>();
    for (const visit of visits) {
      const appointmentRequestId = visit.appointmentRequestId;
      if (!appointmentRequestId || visitByAppointmentId.has(appointmentRequestId)) {
        continue;
      }
      visitByAppointmentId.set(appointmentRequestId, visit);
    }

    return rows.map((row: (typeof rows)[number]) => {
      const visit = visitByAppointmentId.get(row.id);

      return {
        id: row.id,
        patient_name: row.patientName,
        patient_phone: row.patientPhone,
        doctor_id: row.doctorId,
        doctor_name: doctorMap.get(row.doctorId) ?? 'Doctor',
        clinic_service_id: row.clinicServiceId,
        service_name: serviceMap.get(row.clinicServiceId) ?? 'Service',
        appointment_start: row.appointmentStart,
        appointment_end: row.appointmentEnd,
        reason_for_visit: row.reasonForVisit,
        visit_type: row.isFollowup ? ('follow_up' as const) : ('new' as const),
        routing_source: row.routingSource,
        source: row.createdByUserId ? ('manual' as const) : ('agent' as const),
        status: row.status,
        has_history: false,
        ...(visit ? { visit_reason: visit.reasonForVisit } : {}),
        ...(visit?.examinationNotes !== undefined ? { examination_notes: visit.examinationNotes } : {}),
        ...(visit?.diagnosis !== undefined ? { diagnosis: visit.diagnosis } : {}),
        ...(visit?.advice !== undefined ? { advice: visit.advice } : {}),
      };
    });
  }

  async listActionRequests(clinicId: string): Promise<AppointmentActionRequestItem[]> {
    const actionRows = await this.repos.appointmentLifecycle.listPendingActionRequests(clinicId);
    const doctorMap = new Map(
      (await this.repos.clinical.listDoctors(clinicId)).map((doctor) => [doctor.id, doctor.name]),
    );
    const serviceMap = new Map(
      (await this.repos.clinical.listServices(clinicId)).map((service) => [
        service.id,
        service.serviceName,
      ]),
    );

    const results: AppointmentActionRequestItem[] = [];
    for (const action of actionRows) {
      const [appointment] = await this.repos.appointmentLifecycle.findAppointmentById(
        clinicId,
        action.appointmentId,
      );
      if (!appointment) {
        continue;
      }
      results.push({
        id: action.id,
        appointment_id: action.appointmentId,
        patient_name: appointment.patientName,
        doctor_id: appointment.doctorId,
        doctor_name: doctorMap.get(appointment.doctorId) ?? 'Doctor',
        clinic_service_id: appointment.clinicServiceId,
        service_name: serviceMap.get(appointment.clinicServiceId) ?? 'Service',
        requested_date: action.requestedNewDate,
        requested_time_preference: action.requestedNewTimePreference,
        requested_new_slot_id: action.requestedNewSlotId,
        reason: action.reason,
        action_type: action.requestType as 'cancel' | 'reschedule',
        status: action.status,
      });
    }
    return results;
  }

  async listAvailableSlots(input: {
    clinicId: string;
    doctorId: string;
    clinicServiceId: string;
    date: string;
  }): Promise<AppointmentAvailableSlotItem[]> {
    const mapSlotsForDate = (slots: Awaited<ReturnType<SlotService['listProposableSlots']>>) =>
      slots
        .filter((slot) => slotDatePart(slot.start_time) === input.date)
        .sort((left, right) => left.start_time.localeCompare(right.start_time))
        .map((slot) => ({
          slot_id: slot.slot_id,
          doctor_id: slot.doctor_id,
          clinic_service_id: slot.clinic_service_id,
          appointment_start: slot.start_time,
          appointment_end: slot.end_time,
          available_count: slot.available_count,
        }));

    let slots = await this.slotService.listProposableSlots(
      input.clinicId,
      input.doctorId,
      input.clinicServiceId,
    );

    let rows = mapSlotsForDate(slots);

    if (rows.length === 0) {
      const [timezoneRow] = await this.repos.slots.findClinicTimezone(input.clinicId);
      const clinicToday = formatDateInTimezone(new Date(), timezoneRow?.timezone ?? 'Asia/Kolkata');

      if (input.date >= clinicToday) {
        const openFutureSlots = await this.repos.slots.listAvailableOpenSlots(
          input.clinicId,
          input.doctorId,
          input.clinicServiceId,
        );

        if (openFutureSlots.length === 0) {
          try {
            await this.slotGenerationService.generateSlots({
              clinicId: input.clinicId,
              doctorId: input.doctorId,
              clinicServiceId: input.clinicServiceId,
            });
            slots = await this.slotService.listProposableSlots(
              input.clinicId,
              input.doctorId,
              input.clinicServiceId,
            );
            rows = mapSlotsForDate(slots);
          } catch {
            rows = mapSlotsForDate(slots);
          }
        }
      }
    }

    return rows;
  }
}
