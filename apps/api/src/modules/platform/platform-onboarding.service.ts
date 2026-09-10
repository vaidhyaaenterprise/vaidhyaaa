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
import { AppError } from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../database/database.module';
import type { DatabaseConnection } from '@vaidya/db';

import type { CreatePlatformClinicInput, InviteClinicAdminInput } from './platform.schemas';

@Injectable()
export class PlatformOnboardingService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(DatabaseService) private readonly dbService: DatabaseService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async createClinic(input: CreatePlatformClinicInput, actorUserId: string) {
    if (!input.admin.email && !input.admin.phone) {
      throw new AppError('VALIDATION_ERROR', 'Admin email or phone is required.');
    }

    return this.dbService.withTransaction(async (tx) => {
      const db = tx;
      const [plan] = await this.repos.platform.findSubscriptionPlanByKey(input.plan_key);
      if (!plan) {
        throw new AppError('VALIDATION_ERROR', 'Subscription plan not found.', {
          plan_key: input.plan_key,
        });
      }

      const [numberRow] = await db.execute<{ nextval: number }>(
        sql`SELECT nextval('clinic_unique_number_seq') AS nextval`,
      );
      const uniqueNumber = numberRow?.nextval;
      if (!uniqueNumber) {
        throw new AppError('INTERNAL_ERROR', 'Failed to allocate clinic unique number.');
      }

      const [clinic] = await db
        .insert(clinics)
        .values({
          name: input.name,
          uniqueNumber,
          primaryPhone: input.primary_phone,
          addressLine1: input.address_line1,
          city: input.city,
          state: input.state,
          country: input.country ?? 'India',
          timezone: input.timezone,
          defaultLanguageCode: input.default_language_code,
          onboardingStatus: 'setup_pending',
          active: true,
        })
        .returning();

      if (!clinic) {
        throw new AppError('INTERNAL_ERROR', 'Failed to create clinic.');
      }

      await db.insert(clinicSettings).values({
        clinicId: clinic.id,
        agentEnabled: false,
        answeringMode: input.answering_mode ?? 'off',
        fallbackPhone: input.fallback_phone ?? null,
        bookingMode: input.booking_mode ?? 'pending_confirmation',
        maxConcurrentCalls: input.max_concurrent_calls ?? 1,
        recordingRetentionDays: 10,
        transcriptRetentionDays: 30,
      });

      const languageCodes = new Set<string>(
        input.language_codes?.length
          ? input.language_codes
          : [input.default_language_code, 'english'],
      );

      for (const languageCode of languageCodes) {
        await db.insert(clinicLanguages).values({
          clinicId: clinic.id,
          languageCode,
          isDefault: languageCode === input.default_language_code,
          enabled: true,
        });
      }

      await db.insert(clinicSubscriptions).values({
        clinicId: clinic.id,
        subscriptionPlanId: plan.id,
        status: input.subscription_status,
        planSnapshotJson: { plan_key: plan.planKey, name: plan.name },
      });

      const [adminUser] = await db
        .insert(users)
        .values({
          name: input.admin.name,
          email: input.admin.email,
          phone: input.admin.phone,
          active: true,
        })
        .returning();

      if (!adminUser) {
        throw new AppError('INTERNAL_ERROR', 'Failed to create clinic admin user.');
      }

      await db.insert(clinicUsers).values({
        clinicId: clinic.id,
        userId: adminUser.id,
        role: 'clinic_admin',
        active: true,
        invitedByUserId: actorUserId,
      });

      await db.insert(clinicOnboardingChecklist).values({
        clinicId: clinic.id,
        adminUserDone: true,
      });

      await db.insert(auditLogs).values({
        clinicId: clinic.id,
        actorUserId,
        actorType: 'platform_admin',
        eventType: 'platform.clinic.created',
        entityType: 'clinic',
        entityId: clinic.id,
        newValuesJson: {
          name: clinic.name,
          admin_user_id: adminUser.id,
        },
        source: 'platform_onboarding',
      });

      return {
        clinic,
        admin_user: adminUser,
      };
    });
  }

  listClinics() {
    return this.repos.platform.listClinics();
  }

  async getOnboarding(clinicId: string) {
    const [clinic] = await this.repos.clinics.findClinicById(clinicId);
    if (!clinic) {
      throw new AppError('CLINIC_NOT_FOUND', 'Clinic not found.', { clinic_id: clinicId });
    }

    const [settings] = await this.repos.clinics.findClinicSettings(clinicId);
    const [checklist] = await this.repos.clinics.findOnboardingChecklist(clinicId);
    const languages = await this.repos.platform.listClinicLanguages(clinicId);
    const [subscription] = await this.repos.platform.findClinicSubscription(clinicId);

    return {
      clinic,
      settings,
      checklist,
      languages,
      subscription,
    };
  }

  async inviteClinicAdmin(clinicId: string, input: InviteClinicAdminInput, actorUserId: string) {
    if (!input.email && !input.phone) {
      throw new AppError('VALIDATION_ERROR', 'Invite requires email or phone.');
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
        throw new AppError('INTERNAL_ERROR', 'Failed to create invited admin user.');
      }

      await tx.insert(clinicUsers).values({
        clinicId,
        userId: user.id,
        role: 'clinic_admin',
        active: true,
        invitedByUserId: actorUserId,
      });

      await tx.insert(auditLogs).values({
        clinicId,
        actorUserId,
        actorType: 'platform_admin',
        eventType: 'platform.clinic_admin.invited',
        entityType: 'user',
        entityId: user.id,
        source: 'platform_onboarding',
      });

      return user;
    });
  }

  async setClinicActive(clinicId: string, active: boolean, actorUserId: string) {
    const [clinic] = await this.repos.clinics.findClinicById(clinicId);
    if (!clinic) {
      throw new AppError('CLINIC_NOT_FOUND', 'Clinic not found.', { clinic_id: clinicId });
    }

    const [updated] = await this.repos.platform.updateClinic(clinicId, {
      active,
      onboardingStatus: active ? clinic.onboardingStatus : 'suspended',
    });

    await this.dbService.insertAuditLog({
      clinicId,
      actorUserId,
      actorType: 'platform_admin',
      eventType: active ? 'platform.clinic.activated' : 'platform.clinic.suspended',
      entityType: 'clinic',
      entityId: clinicId,
      newValues: { active },
      source: 'platform_onboarding',
    });

    return updated;
  }

  async setUserActive(userId: string, active: boolean, actorUserId: string) {
    const [user] = await this.repos.auth.updateUserActive(userId, active);
    if (!user) {
      throw new AppError('NOT_FOUND', 'User not found.', { user_id: userId });
    }

    await this.dbService.insertAuditLog({
      actorUserId,
      actorType: 'platform_admin',
      eventType: active ? 'platform.user.activated' : 'platform.user.disabled',
      entityType: 'user',
      entityId: userId,
      newValues: { active },
      source: 'platform_onboarding',
    });

    return user;
  }
}
