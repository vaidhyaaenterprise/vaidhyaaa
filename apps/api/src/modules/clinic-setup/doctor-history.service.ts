import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';
import type { DatabaseConnection } from '@vaidya/db';
import { AppError } from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../database/database.module';

type DoctorPatientHistorySearchInput = {
  phone?: string;
  name?: string;
  age?: number;
};

type HistoryTimelineItem = {
  kind: 'visit' | 'appointment';
  id: string;
  at: string;
  doctor_id: string;
  doctor_name: string;
  clinic_service_id: string;
  clinic_service_name: string;
  reason_for_visit: string;
  examination_notes?: string;
  diagnosis?: string;
  advice?: string;
  status?: string;
  appointment_request_id?: string | null;
};

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

function normalizeName(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

function yearsFromDateOfBirth(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) {
    return null;
  }

  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

function yearsFromDateOfBirthWithFallback(
  ageYears: number | null,
  dateOfBirth: string | null,
): number | null {
  if (ageYears !== null && ageYears >= 0) {
    return ageYears;
  }
  return yearsFromDateOfBirth(dateOfBirth);
}

@Injectable()
export class DoctorHistoryService {
  private readonly repos: Repositories;

  constructor(@Inject(DATABASE_CONNECTION) connection: DatabaseConnection) {
    this.repos = createRepositories(connection.db);
  }

  async searchPatientHistory(clinicId: string, input: DoctorPatientHistorySearchInput) {
    const normalizedPhone = input.phone ? normalizePhone(input.phone) : undefined;
    const normalizedName = input.name ? normalizeName(input.name) : undefined;
    const age = input.age;

    if (!normalizedPhone && !normalizedName && age === undefined) {
      throw new AppError(
        'VALIDATION_ERROR',
        'At least one search field is required: phone, name, or age.',
      );
    }

    if (normalizedPhone !== undefined && normalizedPhone.length < 8) {
      throw new AppError('VALIDATION_ERROR', 'Phone must contain at least 8 digits.');
    }

    if (normalizedName !== undefined && normalizedName.length < 2) {
      throw new AppError('VALIDATION_ERROR', 'Name must contain at least 2 characters.');
    }

    if (age !== undefined && (!Number.isInteger(age) || age < 0 || age > 130)) {
      throw new AppError('VALIDATION_ERROR', 'Age must be an integer between 0 and 130.');
    }

    const patients = await this.repos.clinicalSetup.searchPatientsForHistory(clinicId, {
      ...(normalizedPhone ? { phone: normalizedPhone } : {}),
      ...(normalizedName ? { name: normalizedName } : {}),
      ...(age !== undefined ? { age } : {}),
      limit: 50,
    });

    if (patients.length === 0) {
      return { patients: [] };
    }

    const patientIds = patients.map((row) => row.id);

    const [visits, appointments] = await Promise.all([
      this.repos.clinicalSetup.listVisitsForPatientHistory(clinicId, patientIds),
      this.repos.clinicalSetup.listAppointmentsForPatientHistory(clinicId, patientIds),
    ]);

    const visitsByPatient = new Map<string, HistoryTimelineItem[]>();
    for (const visit of visits) {
      const row: HistoryTimelineItem = {
        kind: 'visit',
        id: visit.id,
        at: visit.visitedAt.toISOString(),
        doctor_id: visit.doctorId,
        doctor_name: visit.doctorName,
        clinic_service_id: visit.clinicServiceId,
        clinic_service_name: visit.clinicServiceName,
        reason_for_visit: visit.reasonForVisit,
        ...(visit.examinationNotes ? { examination_notes: visit.examinationNotes } : {}),
        ...(visit.diagnosis ? { diagnosis: visit.diagnosis } : {}),
        ...(visit.advice ? { advice: visit.advice } : {}),
        appointment_request_id: visit.appointmentRequestId,
      };

      const list = visitsByPatient.get(visit.patientId) ?? [];
      list.push(row);
      visitsByPatient.set(visit.patientId, list);
    }

    const appointmentsByPatient = new Map<string, HistoryTimelineItem[]>();
    for (const appointment of appointments) {
      if (!appointment.patientId) {
        continue;
      }

      const row: HistoryTimelineItem = {
        kind: 'appointment',
        id: appointment.id,
        at: new Date(appointment.appointmentStart).toISOString(),
        doctor_id: appointment.doctorId,
        doctor_name: appointment.doctorName,
        clinic_service_id: appointment.clinicServiceId,
        clinic_service_name: appointment.clinicServiceName,
        reason_for_visit: appointment.reasonForVisit,
        status: appointment.status,
      };

      const list = appointmentsByPatient.get(appointment.patientId) ?? [];
      list.push(row);
      appointmentsByPatient.set(appointment.patientId, list);
    }

    return {
      patients: patients.map((patient) => {
        const timeline = [
          ...(visitsByPatient.get(patient.id) ?? []),
          ...(appointmentsByPatient.get(patient.id) ?? []),
        ].sort((a, b) => b.at.localeCompare(a.at));

        return {
          id: patient.id,
          name: patient.name,
          phone: patient.phone,
          gender: patient.gender,
          age: yearsFromDateOfBirthWithFallback(patient.ageYears, patient.dateOfBirth),
          date_of_birth: patient.dateOfBirth,
          history: timeline,
        };
      }),
    };
  }
}
