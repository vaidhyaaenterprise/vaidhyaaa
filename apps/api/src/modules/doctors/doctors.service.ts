import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, DatabaseService, doctors, type Repositories } from '@vaidya/db';
import { AppError } from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../database/database.module';
import type { DatabaseConnection } from '@vaidya/db';

import type { CreateDoctorInput, LinkDoctorLoginInput, UpdateDoctorInput } from '../platform/platform.schemas';

@Injectable()
export class DoctorsService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(DatabaseService) private readonly dbService: DatabaseService,
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

    await this.dbService.assertDoctorBelongsToClinic(clinicId, doctorId);

    const existingDoctor = await this.dbService.getClinicScopedRecordOrThrow<
      typeof doctors.$inferSelect
    >(doctors, clinicId, doctorId, 'NOT_FOUND');

    if (existingDoctor.userId) {
      throw new AppError('VALIDATION_ERROR', 'Doctor login is already linked.');
    }

    const result = await this.repos.doctors.linkDoctorLogin({
      clinicId,
      doctorId,
      name: input.name,
      ...(input.email ? { email: input.email } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
      invitedByUserId,
    });

    if (!result) {
      throw new AppError('NOT_FOUND', 'Doctor not found.');
    }

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
    if (input.active === undefined) {
      throw new AppError('VALIDATION_ERROR', 'Doctor update requires at least active field.');
    }

    await this.dbService.assertDoctorBelongsToClinic(clinicId, doctorId);

    const [doctor] = await this.repos.doctors.updateDoctorActive(clinicId, doctorId, input.active);

    if (!doctor) {
      throw new AppError('NOT_FOUND', 'Doctor not found.');
    }

    if (input.active === false) {
      await this.dbService.insertAuditLog({
        clinicId,
        actorUserId,
        actorType: 'clinic_admin',
        eventType: 'clinic.doctor.disabled',
        entityType: 'doctor',
        entityId: doctorId,
        newValues: { active: false },
        source: 'doctors',
      });
    }

    return doctor;
  }

  async updateMembership(clinicId: string, membershipId: string, active: boolean, actorUserId: string) {
    const [membership] = await this.repos.auth.updateClinicMembershipActive(
      clinicId,
      membershipId,
      active,
    );

    if (!membership) {
      throw new AppError('NOT_FOUND', 'Clinic membership not found.');
    }

    await this.dbService.insertAuditLog({
      clinicId,
      actorUserId,
      actorType: 'clinic_admin',
      eventType: active ? 'clinic.user.enabled' : 'clinic.user.disabled',
      entityType: 'clinic_user',
      entityId: membershipId,
      newValues: { active },
      source: 'clinic_users',
    });

    return membership;
  }
}
