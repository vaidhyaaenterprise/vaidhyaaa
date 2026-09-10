import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';
import type { AppointmentCandidate } from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';

import { formatAppointmentList } from './lifecycle-field-extractor';

@Injectable()
export class AppointmentLookupService {
  private readonly repos: Repositories;

  constructor(@Inject(DATABASE_CONNECTION) connection: DatabaseConnection) {
    this.repos = createRepositories(connection.db);
  }

  async listAppointmentCandidates(
    clinicId: string,
    patientPhone: string | null | undefined,
  ): Promise<AppointmentCandidate[]> {
    if (!patientPhone) {
      return [];
    }

    const appointments = await this.repos.appointmentLifecycle.listUpcomingAppointmentsByPhone(
      clinicId,
      patientPhone,
    );
    const doctors = await this.repos.clinical.listDoctors(clinicId);
    const doctorNames = new Map(doctors.map((doctor) => [doctor.id, doctor.name]));

    return appointments.map((appointment, index) => {
      const doctorName = doctorNames.get(appointment.doctorId) ?? 'Doctor';
      const startDisplay = appointment.appointmentStart.replace('T', ' ').slice(0, 16);
      return {
        appointment_id: appointment.id,
        doctor_name: doctorName,
        appointment_start: appointment.appointmentStart,
        display_label: `${index + 1}. ${doctorName} ${startDisplay}`,
      };
    });
  }

  formatAppointmentList(candidates: AppointmentCandidate[]): string {
    return formatAppointmentList(candidates);
  }
}
