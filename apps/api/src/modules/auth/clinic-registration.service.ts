import { Inject, Injectable } from '@nestjs/common';

import {
  auditLogs,
  clinicLanguages,
  clinicOnboardingChecklist,
  clinicSettings,
  clinicSubscriptions,
  clinicUsers,
  clinics,
  createRepositories,
  DatabaseService,
  type Repositories,
  sql,
  users,
} from '@vaidya/db';
import {
  AppError,
  type RegisterClinicAdminInput,
  type RegisterClinicAdminResponse,
} from '@vaidya/shared';

import { hashPassword } from '../../common/crypto/password';
import { DATABASE_CONNECTION } from '../database/database.module';
import type { DatabaseConnection } from '@vaidya/db';

function sanitizeLoginName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '.')
      .replace(/[^a-zA-Z0-9._-]/g, '')
      .replace(/\.{2,}/g, '.')
      .replace(/^[.\-_]+|[.\-_]+$/g, '') || 'admin'
  );
}

@Injectable()
export class ClinicRegistrationService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(DatabaseService) private readonly dbService: DatabaseService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async register(input: RegisterClinicAdminInput): Promise<RegisterClinicAdminResponse> {
    const normalizedEmail = input.admin_email.trim().toLowerCase();

    const [existingUser] = await this.repos.auth.findUserByIdentifier(normalizedEmail);
    if (existingUser) {
      throw new AppError('VALIDATION_ERROR', 'Email is already registered.');
    }

    const [verification] = await this.repos.otp.findLatestForEmail(
      normalizedEmail,
      'EMAIL_VERIFICATION',
    );
    const verifiedWithinWindow =
      verification?.verifiedAt &&
      Date.now() - verification.verifiedAt.getTime() < 15 * 60 * 1000;
    if (!verifiedWithinWindow) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Please verify your email with the code sent to your inbox before registering.',
      );
    }

    const [plan] = await this.repos.platform.findSubscriptionPlanByKey('pilot');
    if (!plan) {
      throw new AppError('INTERNAL_ERROR', 'Default subscription plan not found.');
    }

    const { hash, salt } = hashPassword(input.password);

    return this.dbService.withTransaction(async (tx) => {
      const [numberRow] = await tx.execute<{ nextval: number }>(
        sql`SELECT nextval('clinic_unique_number_seq') AS nextval`,
      );
      const uniqueNumber = numberRow?.nextval;
      if (!uniqueNumber) {
        throw new AppError('INTERNAL_ERROR', 'Failed to allocate clinic unique number.');
      }

      const [clinic] = await tx
        .insert(clinics)
        .values({
          name: input.clinic_name,
          uniqueNumber,
          primaryPhone: input.clinic_phone,
          addressLine1: input.address_line1,
          city: input.city,
          state: input.state,
          postalCode: input.zip_code,
          country: input.country || 'India',
          timezone: 'Asia/Kolkata',
          defaultLanguageCode: 'ta_tanglish',
          onboardingStatus: 'setup_pending',
          active: true,
        })
        .returning();

      if (!clinic) {
        throw new AppError('INTERNAL_ERROR', 'Failed to create clinic.');
      }

      await tx.insert(clinicSettings).values({
        clinicId: clinic.id,
        agentEnabled: false,
        answeringMode: 'off',
        fallbackPhone: null,
        bookingMode: 'pending_confirmation',
        maxConcurrentCalls: 1,
        recordingRetentionDays: 10,
        transcriptRetentionDays: 30,
      });

      await tx.insert(clinicLanguages).values({
        clinicId: clinic.id,
        languageCode: 'ta_tanglish',
        isDefault: true,
        enabled: true,
      });
      await tx.insert(clinicLanguages).values({
        clinicId: clinic.id,
        languageCode: 'english',
        isDefault: false,
        enabled: true,
      });

      await tx.insert(clinicSubscriptions).values({
        clinicId: clinic.id,
        subscriptionPlanId: plan.id,
        status: 'trialing',
        planSnapshotJson: { plan_key: plan.planKey, name: plan.name },
      });

      const [adminUser] = await tx
        .insert(users)
        .values({
          name: input.admin_name,
          email: normalizedEmail,
          phone: input.admin_phone,
          username: `${sanitizeLoginName(input.admin_name)}.${uniqueNumber}`,
          passwordHash: hash,
          passwordSalt: salt,
          active: true,
        })
        .returning();

      if (!adminUser) {
        throw new AppError('INTERNAL_ERROR', 'Failed to create clinic admin user.');
      }

      await tx.insert(clinicUsers).values({
        clinicId: clinic.id,
        userId: adminUser.id,
        role: 'clinic_admin',
        active: true,
        invitedByUserId: null,
      });

      await tx.insert(clinicOnboardingChecklist).values({
        clinicId: clinic.id,
        adminUserDone: true,
      });

      await tx.insert(auditLogs).values({
        clinicId: clinic.id,
        actorUserId: adminUser.id,
        actorType: 'clinic_admin',
        eventType: 'platform.clinic.registered',
        entityType: 'clinic',
        entityId: clinic.id,
        newValuesJson: {
          unique_number: uniqueNumber,
          admin_user_id: adminUser.id,
        },
        source: 'clinic_registration',
      });

      return {
        email: normalizedEmail,
        clinic_unique_number: uniqueNumber,
      };
    });
  }
}