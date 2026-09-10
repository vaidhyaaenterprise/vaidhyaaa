import { Inject, Injectable } from '@nestjs/common';

import {
  and,
  auditLogs,
  clinicUsers,
  createRepositories,
  DatabaseService,
  doctors,
  eq,
  type Repositories,
  users,
} from '@vaidya/db';
import {
  AppError,
  type CreateClinicUserLoginInput,
  type InviteClinicUserInput,
} from '@vaidya/shared';

import { deriveLoginNumber, hashPassword } from '../../common/crypto/password';
import { DATABASE_CONNECTION } from '../database/database.module';
import type { DatabaseConnection } from '@vaidya/db';

@Injectable()
export class ClinicUsersService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(DatabaseService) private readonly dbService: DatabaseService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async listUsers(clinicId: string) {
    await this.dbService.findClinicById(clinicId);
    const [clinic] = await this.repos.clinics.findClinicUniqueNumber(clinicId);
    return {
      users: await this.repos.auth.listClinicUsers(clinicId),
      clinicLoginNumber: clinic?.uniqueNumber ?? null,
    };
  }

  async inviteUser(clinicId: string, input: InviteClinicUserInput, actorUserId: string) {
    if (!input.email && !input.phone) {
      throw new AppError('VALIDATION_ERROR', 'Invite requires email or phone.');
    }

    if (input.role === 'doctor' && !input.doctor_id) {
      throw new AppError('VALIDATION_ERROR', 'Doctor invite requires doctor_id.');
    }

    if (input.role === 'doctor' && input.doctor_id) {
      await this.dbService.assertDoctorBelongsToClinic(clinicId, input.doctor_id);
    }

    return this.dbService.withTransaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          name: input.name,
          email: input.email,
          phone: input.phone,
          active: true,
        })
        .returning();

      if (!user) {
        throw new AppError('INTERNAL_ERROR', 'Failed to create invited user.');
      }

      const [membership] = await tx
        .insert(clinicUsers)
        .values({
          clinicId,
          userId: user.id,
          role: input.role,
          doctorId: input.doctor_id ?? null,
          active: true,
          invitedByUserId: actorUserId,
        })
        .returning();

      if (input.role === 'doctor' && input.doctor_id) {
        await tx
          .update(doctors)
          .set({ userId: user.id })
          .where(and(eq(doctors.clinicId, clinicId), eq(doctors.id, input.doctor_id)));
      }

      await tx.insert(auditLogs).values({
        clinicId,
        actorUserId,
        actorType: 'clinic_admin',
        eventType: 'clinic.user.invited',
        entityType: 'clinic_user',
        entityId: membership?.id,
        newValuesJson: {
          user_id: user.id,
          role: input.role,
          doctor_id: input.doctor_id ?? null,
        },
        source: 'clinic_users',
      });

      return { user, membership };
    });
  }

  async createLogin(
    clinicId: string,
    input: CreateClinicUserLoginInput,
    actorUserId: string,
  ) {
    if (input.role === 'doctor' && !input.doctor_id) {
      throw new AppError('VALIDATION_ERROR', 'Doctor login creation requires doctor_id.');
    }

    if (input.role === 'doctor' && input.doctor_id) {
      await this.dbService.assertDoctorBelongsToClinic(clinicId, input.doctor_id);
    }

    const { hash, salt } = hashPassword(input.password);

    return this.dbService.withTransaction(async (tx) => {
      const username = await this.buildUniqueUsername(clinicId, input.login_name);
      const [user] = await tx
        .insert(users)
        .values({
          name: input.login_name,
          username,
          passwordHash: hash,
          passwordSalt: salt,
          active: true,
        })
        .returning();

      if (!user) {
        throw new AppError('INTERNAL_ERROR', 'Failed to create login user.');
      }

      const [membership] = await tx
        .insert(clinicUsers)
        .values({
          clinicId,
          userId: user.id,
          role: input.role,
          doctorId: input.doctor_id ?? null,
          active: true,
          invitedByUserId: actorUserId,
        })
        .returning();

      if (input.role === 'doctor' && input.doctor_id) {
        await tx
          .update(doctors)
          .set({ userId: user.id })
          .where(and(eq(doctors.clinicId, clinicId), eq(doctors.id, input.doctor_id)));
      }

      await tx.insert(auditLogs).values({
        clinicId,
        actorUserId,
        actorType: 'clinic_admin',
        eventType: 'clinic.user.login_created',
        entityType: 'clinic_user',
        entityId: membership?.id,
        newValuesJson: {
          user_id: user.id,
          username: user.username,
          role: input.role,
          doctor_id: input.doctor_id ?? null,
        },
        source: 'clinic_users',
      });

      return { user, membership };
    });
  }

  private async buildUniqueUsername(clinicId: string, loginName: string) {
    const [clinic] = await this.repos.clinics.findClinicUniqueNumber(clinicId);
    const number = (clinic?.uniqueNumber ?? deriveLoginNumber(clinicId)).toString();
    const base = `${loginName}.${number}`;
    let candidate = base;
    let suffix = 1;
    while ((await this.repos.auth.findUserByUsername(candidate)).length > 0) {
      candidate = `${base}.${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  async setMembershipActive(
    clinicId: string,
    membershipId: string,
    active: boolean,
    actorUserId: string,
  ) {    const [membership] = await this.repos.auth.updateClinicMembershipActive(
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
