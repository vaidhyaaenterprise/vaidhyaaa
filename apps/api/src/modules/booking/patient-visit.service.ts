import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';

import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';

export type ReturningPatientMatch = {
  patientId: string;
  patientName: string;
  previousDoctorId: string | null;
  previousClinicServiceId: string | null;
  previousReasonForVisit: string | null;
  needsPatientIdentity: boolean;
  candidatePatients: Array<{ patient_id: string; patient_name: string }>;
};

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

function reasonsMatch(currentReason: string, previousReason: string | null): boolean {
  if (!previousReason) {
    return false;
  }
  const current = currentReason.toLowerCase();
  const previous = previousReason.toLowerCase();
  return current === previous || current.includes(previous) || previous.includes(current);
}

@Injectable()
export class PatientVisitService {
  private readonly repos: Repositories;

  constructor(@Inject(DATABASE_CONNECTION) connection: DatabaseConnection) {
    this.repos = createRepositories(connection.db);
  }

  async findReturningPatientMatch(input: {
    clinicId: string;
    patientPhone?: string | null;
    reasonForVisit?: string | null;
    patientName?: string | null;
    isFollowup?: boolean;
  }): Promise<ReturningPatientMatch | null> {
    if (!input.patientPhone) {
      return null;
    }

    const patients = await this.repos.patients.findByPhone(
      input.clinicId,
      normalizePhone(input.patientPhone),
    );
    if (patients.length === 0) {
      return null;
    }

    if (patients.length > 1 && !input.patientName) {
      return {
        patientId: '',
        patientName: '',
        previousDoctorId: null,
        previousClinicServiceId: null,
        previousReasonForVisit: null,
        needsPatientIdentity: true,
        candidatePatients: patients.map((patient) => ({
          patient_id: patient.id,
          patient_name: patient.name,
        })),
      };
    }

    const selectedPatient =
      input.patientName !== undefined && input.patientName !== null
        ? patients.find((patient) => normalizeName(patient.name) === normalizeName(input.patientName!))
        : patients[0];

    if (!selectedPatient) {
      return {
        patientId: '',
        patientName: '',
        previousDoctorId: null,
        previousClinicServiceId: null,
        previousReasonForVisit: null,
        needsPatientIdentity: true,
        candidatePatients: patients.map((patient) => ({
          patient_id: patient.id,
          patient_name: patient.name,
        })),
      };
    }

    const visits = await this.repos.patients.listRecentVisits(input.clinicId, selectedPatient.id, 1);
    const latestVisit = visits[0];
    if (!latestVisit) {
      return {
        patientId: selectedPatient.id,
        patientName: selectedPatient.name,
        previousDoctorId: null,
        previousClinicServiceId: null,
        previousReasonForVisit: null,
        needsPatientIdentity: false,
        candidatePatients: [],
      };
    }

    const shouldPreferPreviousDoctor =
      Boolean(input.isFollowup) ||
      (input.reasonForVisit ? reasonsMatch(input.reasonForVisit, latestVisit.reasonForVisit) : false);

    return {
      patientId: selectedPatient.id,
      patientName: selectedPatient.name,
      previousDoctorId: shouldPreferPreviousDoctor ? latestVisit.doctorId : null,
      previousClinicServiceId: shouldPreferPreviousDoctor ? latestVisit.clinicServiceId : null,
      previousReasonForVisit: latestVisit.reasonForVisit,
      needsPatientIdentity: false,
      candidatePatients: [],
    };
  }
}
