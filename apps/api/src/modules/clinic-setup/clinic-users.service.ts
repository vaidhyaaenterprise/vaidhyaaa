import { Inject, Injectable } from '@nestjs/common';

import {
  and,
  auditLogs,
  clinicUsers,
  clinics,
  createRepositories,
  DatabaseService,
  doctors,
  eq,
  isNull,
  sql,
  type Database,
  type Repositories,
  users,
} from '@vaidya/db';
import {
  AppError,
  type CreateClinicUserLoginInput,
  type InviteClinicUserInput,
  type UpdateClinicUserLoginInput,
} from '@vaidya/shared';

import { deriveLoginNumber, hashPassword } from '../../common/crypto/password';
import { DATABASE_CONNECTION } from '../database/database.module';
import type { DatabaseConnection } from '@vaidya/db';

function readableNameFromLoginName(loginName: string): string {
  return loginName
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

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
    this.assertRoleAndDoctorInput(input.role, input.doctor_id);

    try {
      return await this.dbService.withTransaction(async (tx) => {
        await this.lockClinic(tx, clinicId);
        const doctor = input.doctor_id
          ? await this.lockAvailableDoctor(tx, clinicId, input.doctor_id)
          : null;

        const [user] = await tx
          .insert(users)
          .values({
            name: doctor?.name ?? input.name.trim(),
            email: input.email?.trim().toLowerCase(),
            phone: input.phone?.trim(),
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

        if (!membership) {
          throw new AppError('INTERNAL_ERROR', 'Failed to create clinic membership.');
        }

        if (doctor) {
          await tx
            .update(doctors)
            .set({ userId: user.id, updatedAt: new Date() })
            .where(and(eq(doctors.clinicId, clinicId), eq(doctors.id, doctor.id)));
        }

        await tx.insert(auditLogs).values({
          clinicId,
          actorUserId,
          actorType: 'clinic_admin',
          eventType: 'clinic.user.invited',
          entityType: 'clinic_user',
          entityId: membership.id,
          newValuesJson: {
            user_id: user.id,
            role: input.role,
            doctor_id: input.doctor_id ?? null,
          },
          source: 'clinic_users',
        });

        return { user, membership };
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new AppError('CONFLICT', 'A user with that email or phone already exists.');
      }
      throw error;
    }
  }

  async createLogin(clinicId: string, input: CreateClinicUserLoginInput, actorUserId: string) {
    this.assertRoleAndDoctorInput(input.role, input.doctor_id);
    const { hash, salt } = hashPassword(input.password);

    try {
      return await this.dbService.withTransaction(async (tx) => {
        const clinic = await this.lockClinic(tx, clinicId);
        const doctor = input.doctor_id
          ? await this.lockAvailableDoctor(tx, clinicId, input.doctor_id)
          : null;
        const username = this.buildUsername(clinicId, clinic.uniqueNumber, input.login_name);
        await this.assertUsernameAvailable(tx, username);

        const [user] = await tx
          .insert(users)
          .values({
            name: doctor?.name ?? readableNameFromLoginName(input.login_name),
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

        if (!membership) {
          throw new AppError('INTERNAL_ERROR', 'Failed to create clinic membership.');
        }

        if (doctor) {
          await tx
            .update(doctors)
            .set({ userId: user.id, updatedAt: new Date() })
            .where(and(eq(doctors.clinicId, clinicId), eq(doctors.id, doctor.id)));
        }

        await tx.insert(auditLogs).values({
          clinicId,
          actorUserId,
          actorType: 'clinic_admin',
          eventType: 'clinic.user.login_created',
          entityType: 'clinic_user',
          entityId: membership.id,
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
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw this.usernameConflict();
      }
      throw error;
    }
  }

  async updateLogin(
    clinicId: string,
    membershipId: string,
    input: UpdateClinicUserLoginInput,
    actorUserId: string,
  ) {
    try {
      return await this.dbService.withTransaction(async (tx) => {
        const clinic = await this.lockClinic(tx, clinicId);
        const [target] = await tx
          .select({ membership: clinicUsers, user: users })
          .from(clinicUsers)
          .innerJoin(users, eq(clinicUsers.userId, users.id))
          .where(
            and(
              eq(clinicUsers.clinicId, clinicId),
              eq(clinicUsers.id, membershipId),
              isNull(clinicUsers.deletedAt),
            ),
          )
          .for('update')
          .limit(1);

        if (!target) {
          throw new AppError('NOT_FOUND', 'Clinic user login not found.');
        }
        if (target.user.platformRole && target.user.platformRole !== 'none') {
          throw new AppError('FORBIDDEN', 'Platform account credentials cannot be edited here.');
        }

        const [otherMembership] = await tx
          .select({ id: clinicUsers.id })
          .from(clinicUsers)
          .where(
            and(
              eq(clinicUsers.userId, target.user.id),
              isNull(clinicUsers.deletedAt),
              sql<boolean>`${clinicUsers.id} <> ${membershipId}`,
            ),
          )
          .limit(1);

        if (otherMembership) {
          throw new AppError(
            'CONFLICT',
            'Credentials for a user shared with another clinic cannot be edited here.',
          );
        }

        const updates: Partial<
          Pick<
            typeof users.$inferInsert,
            'name' | 'username' | 'passwordHash' | 'passwordSalt' | 'updatedAt'
          >
        > = { updatedAt: new Date() };

        let nextUsername = target.user.username;
        if (input.login_name !== undefined) {
          nextUsername = this.buildUsername(clinicId, clinic.uniqueNumber, input.login_name);
          await this.assertUsernameAvailable(tx, nextUsername, target.user.id);
          updates.username = nextUsername;
          if (target.membership.role === 'clinic_admin') {
            updates.name = readableNameFromLoginName(input.login_name);
          }
        }

        if (input.password !== undefined) {
          const { hash, salt } = hashPassword(input.password);
          updates.passwordHash = hash;
          updates.passwordSalt = salt;
        }

        const [updatedUser] = await tx
          .update(users)
          .set(updates)
          .where(eq(users.id, target.user.id))
          .returning();

        if (!updatedUser) {
          throw new AppError('NOT_FOUND', 'Clinic user login not found.');
        }

        await tx.insert(auditLogs).values({
          clinicId,
          actorUserId,
          actorType: 'clinic_admin',
          eventType: 'clinic.user.credentials_updated',
          entityType: 'clinic_user',
          entityId: membershipId,
          oldValuesJson: {
            username: target.user.username,
          },
          newValuesJson: {
            username: nextUsername,
            username_changed: input.login_name !== undefined,
            password_changed: input.password !== undefined,
          },
          source: 'clinic_users',
        });

        return { user: updatedUser, membership: target.membership };
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw this.usernameConflict();
      }
      throw error;
    }
  }

  async revokeLogin(clinicId: string, membershipId: string, actorUserId: string) {
    return this.dbService.withTransaction(async (tx) => {
      await this.lockClinic(tx, clinicId);
      const [target] = await tx
        .select({ membership: clinicUsers, user: users })
        .from(clinicUsers)
        .innerJoin(users, eq(clinicUsers.userId, users.id))
        .where(
          and(
            eq(clinicUsers.clinicId, clinicId),
            eq(clinicUsers.id, membershipId),
            isNull(clinicUsers.deletedAt),
          ),
        )
        .for('update')
        .limit(1);

      if (!target) {
        throw new AppError('NOT_FOUND', 'Clinic user login not found.');
      }
      if (target.user.id === actorUserId) {
        throw new AppError('FORBIDDEN', 'You cannot delete your own login.');
      }

      await this.assertNotLastActiveAdmin(tx, clinicId, target.membership, target.user.active);

      const now = new Date();
      const [revokedMembership] = await tx
        .update(clinicUsers)
        .set({
          active: false,
          deletedAt: now,
          deletedByUserId: actorUserId,
          updatedAt: now,
        })
        .where(
          and(
            eq(clinicUsers.clinicId, clinicId),
            eq(clinicUsers.id, membershipId),
            isNull(clinicUsers.deletedAt),
          ),
        )
        .returning();

      if (!revokedMembership) {
        throw new AppError('NOT_FOUND', 'Clinic user login not found.');
      }

      if (target.membership.role === 'doctor') {
        await tx
          .update(doctors)
          .set({ userId: null, updatedAt: now })
          .where(and(eq(doctors.clinicId, clinicId), eq(doctors.userId, target.user.id)));
      }

      const [otherMembership] = await tx
        .select({ id: clinicUsers.id })
        .from(clinicUsers)
        .where(and(eq(clinicUsers.userId, target.user.id), isNull(clinicUsers.deletedAt)))
        .limit(1);

      const canRevokeCredentials =
        !otherMembership &&
        (target.user.platformRole === null || target.user.platformRole === 'none');

      if (canRevokeCredentials) {
        const replacementUsername =
          target.user.email || target.user.phone ? null : `revoked.${target.user.id}`;
        await tx
          .update(users)
          .set({
            username: replacementUsername,
            passwordHash: null,
            passwordSalt: null,
            active: false,
            updatedAt: now,
          })
          .where(eq(users.id, target.user.id));
      }

      await tx.insert(auditLogs).values({
        clinicId,
        actorUserId,
        actorType: 'clinic_admin',
        eventType: 'clinic.user.login_revoked',
        entityType: 'clinic_user',
        entityId: membershipId,
        oldValuesJson: {
          user_id: target.user.id,
          username: target.user.username,
          role: target.membership.role,
          doctor_id: target.membership.doctorId,
          active: target.membership.active,
        },
        newValuesJson: {
          active: false,
          deleted_at: now.toISOString(),
          credentials_revoked: canRevokeCredentials,
        },
        source: 'clinic_users',
      });

      return {
        membership: revokedMembership,
        credentialsRevoked: canRevokeCredentials,
      };
    });
  }

  async setMembershipActive(
    clinicId: string,
    membershipId: string,
    active: boolean,
    actorUserId: string,
  ) {
    return this.dbService.withTransaction(async (tx) => {
      await this.lockClinic(tx, clinicId);
      const [target] = await tx
        .select({ membership: clinicUsers, user: users })
        .from(clinicUsers)
        .innerJoin(users, eq(clinicUsers.userId, users.id))
        .where(
          and(
            eq(clinicUsers.clinicId, clinicId),
            eq(clinicUsers.id, membershipId),
            isNull(clinicUsers.deletedAt),
          ),
        )
        .for('update')
        .limit(1);

      if (!target) {
        throw new AppError('NOT_FOUND', 'Clinic membership not found.');
      }
      const membership = target.membership;
      if (!active && membership.userId === actorUserId) {
        throw new AppError('FORBIDDEN', 'You cannot disable your own login.');
      }
      if (active && !target.user.active) {
        throw new AppError(
          'CONFLICT',
          'This account is disabled at platform level and cannot be enabled by a clinic admin.',
        );
      }

      if (!active) {
        await this.assertNotLastActiveAdmin(tx, clinicId, membership, target.user.active);
      }

      if (membership.active === active) {
        return membership;
      }

      const [updatedMembership] = await tx
        .update(clinicUsers)
        .set({ active, updatedAt: new Date() })
        .where(
          and(
            eq(clinicUsers.clinicId, clinicId),
            eq(clinicUsers.id, membershipId),
            isNull(clinicUsers.deletedAt),
          ),
        )
        .returning();

      if (!updatedMembership) {
        throw new AppError('NOT_FOUND', 'Clinic membership not found.');
      }

      await tx.insert(auditLogs).values({
        clinicId,
        actorUserId,
        actorType: 'clinic_admin',
        eventType: active ? 'clinic.user.enabled' : 'clinic.user.disabled',
        entityType: 'clinic_user',
        entityId: membershipId,
        oldValuesJson: { active: membership.active },
        newValuesJson: { active },
        source: 'clinic_users',
      });

      return updatedMembership;
    });
  }

  private assertRoleAndDoctorInput(role: string, doctorId: string | undefined): void {
    if (role === 'doctor' && !doctorId) {
      throw new AppError('VALIDATION_ERROR', 'Doctor login creation requires doctor_id.');
    }
    if (role === 'clinic_admin' && doctorId) {
      throw new AppError('VALIDATION_ERROR', 'Admin login cannot be linked to a doctor.');
    }
  }

  private async lockClinic(tx: Database, clinicId: string) {
    const [clinic] = await tx
      .select()
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .for('update')
      .limit(1);

    if (!clinic) {
      throw new AppError('CLINIC_NOT_FOUND', 'Clinic not found.', { clinic_id: clinicId });
    }
    return clinic;
  }

  private async lockAvailableDoctor(tx: Database, clinicId: string, doctorId: string) {
    const [doctor] = await tx
      .select()
      .from(doctors)
      .where(and(eq(doctors.clinicId, clinicId), eq(doctors.id, doctorId)))
      .for('update')
      .limit(1);

    if (!doctor) {
      throw new AppError('NOT_FOUND', 'Doctor does not belong to this clinic.');
    }
    if (!doctor.active) {
      throw new AppError('CONFLICT', 'An inactive doctor cannot be given a login.');
    }

    const [existingMembership] = await tx
      .select({ id: clinicUsers.id })
      .from(clinicUsers)
      .where(
        and(
          eq(clinicUsers.clinicId, clinicId),
          eq(clinicUsers.doctorId, doctorId),
          isNull(clinicUsers.deletedAt),
        ),
      )
      .limit(1);

    if (doctor.userId || existingMembership) {
      throw new AppError('CONFLICT', 'This doctor already has a login.');
    }
    return doctor;
  }

  private buildUsername(clinicId: string, uniqueNumber: number | null, loginName: string): string {
    const number = (uniqueNumber ?? deriveLoginNumber(clinicId)).toString();
    return `${loginName}.${number}`.toLowerCase();
  }

  private async assertUsernameAvailable(
    tx: Database,
    username: string,
    ignoredUserId?: string,
  ): Promise<void> {
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql<boolean>`lower(${users.username}) = ${username.toLowerCase()}`)
      .limit(1);

    if (existing && existing.id !== ignoredUserId) {
      throw this.usernameConflict();
    }
  }

  private usernameConflict(): AppError {
    return new AppError('CONFLICT', 'That username is already in use. Choose another name.', {
      field: 'login_name',
    });
  }

  private async assertNotLastActiveAdmin(
    tx: Database,
    clinicId: string,
    membership: typeof clinicUsers.$inferSelect,
    userActive: boolean,
  ): Promise<void> {
    if (membership.role !== 'clinic_admin' || !membership.active || !userActive) {
      return;
    }

    const activeAdmins = await tx
      .select({ id: clinicUsers.id })
      .from(clinicUsers)
      .innerJoin(users, eq(clinicUsers.userId, users.id))
      .where(
        and(
          eq(clinicUsers.clinicId, clinicId),
          eq(clinicUsers.role, 'clinic_admin'),
          eq(clinicUsers.active, true),
          eq(users.active, true),
          sql<boolean>`coalesce(${users.platformRole}, 'none') <> 'support'`,
          isNull(clinicUsers.deletedAt),
        ),
      );

    if (activeAdmins.length <= 1) {
      throw new AppError('CONFLICT', 'The last active clinic admin cannot be disabled or deleted.');
    }
  }
}
