import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, DatabaseService, type Repositories } from '@vaidya/db';
import { AppError } from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../database/database.module';
import type { DatabaseConnection } from '@vaidya/db';
import { ClinicUsersService } from '../clinic-setup/clinic-users.service';

import type {
  CreateDoctorInput,
  LinkDoctorLoginInput,
  UpdateDoctorInput,
} from '../platform/platform.schemas';

@Injectable()
export class DoctorsService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(DatabaseService) private readonly dbService: DatabaseService,
    @Inject(ClinicUsersService) private readonly clinicUsersService: ClinicUsersService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async createDoctor(clinicId: string, input: CreateDoctorInput) {
    const [doctor] = await this.repos.doctors.createDoctor({
      clinicId,
      name: input.name,
      qualification: input.qualification,
    });

    if (!doctor) {
      throw new AppError('INTERNAL_ERROR', 'Failed to create doctor profile.');
    }

    return doctor;
  }

  async linkDoctorLogin(
    clinicId: string,
    doctorId: string,
    input: LinkDoctorLoginInput,
    invitedByUserId: string,
  ) {
    if (!input.email && !input.phone) {
      throw new AppError('VALIDATION_ERROR', 'Doctor login requires email or phone.');
    }

    const result = await this.clinicUsersService.inviteUser(
      clinicId,
      {
        role: 'doctor',
        doctor_id: doctorId,
        name: input.name,
        ...(input.email ? { email: input.email } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
      },
      invitedByUserId,
    );

    await this.dbService.insertAuditLog({
      clinicId,
      actorUserId: invitedByUserId,
      actorType: 'clinic_admin',
      eventType: 'clinic.doctor.login_linked',
      entityType: 'doctor',
      entityId: doctorId,
      newValues: { user_id: result.user.id },
      source: 'doctors',
    });

    return { doctor_id: doctorId, user: result.user };
  }

  async updateDoctor(
    clinicId: string,
    doctorId: string,
    input: UpdateDoctorInput,
    actorUserId: string,
  ) {
    if (input.name === undefined && input.qualification === undefined && input.active === undefined) {
      throw new AppError('VALIDATION_ERROR', 'Doctor update requires at least one field.');
    }

    await this.dbService.assertDoctorBelongsToClinic(clinicId, doctorId);

    const doctor = await this.dbService.withTransaction(async (tx) => {
      const [updatedDoctor] = await this.repos.doctors.updateDoctor(
        clinicId,
        doctorId,
        {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.qualification !== undefined
            ? { qualification: input.qualification.trim() || null }
            : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
        tx,
      );

      if (updatedDoctor?.userId && input.name !== undefined) {
        await this.repos.doctors.updateLinkedUserName(
          updatedDoctor.userId,
          input.name.trim(),
          tx,
        );
      }

      return updatedDoctor;
    });

    if (!doctor) {
      throw new AppError('NOT_FOUND', 'Doctor not found.');
    }

    await this.dbService.insertAuditLog({
      clinicId,
      actorUserId,
      actorType: 'clinic_admin',
      eventType: input.active === false ? 'clinic.doctor.disabled' : 'clinic.doctor.updated',
      entityType: 'doctor',
      entityId: doctorId,
      newValues: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.qualification !== undefined
          ? { qualification: input.qualification.trim() || null }
          : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
      source: 'doctors',
    });

    return doctor;
  }
}
