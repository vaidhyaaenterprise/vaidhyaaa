import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';
import { AppError, type PlatformSubscriptionChangeInput, type ReplaceClinicLanguagesInput } from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../database/database.module';
import type { DatabaseConnection } from '@vaidya/db';

@Injectable()
export class ClinicSubscriptionService {
  private readonly repos: Repositories;

  constructor(@Inject(DATABASE_CONNECTION) connection: DatabaseConnection) {
    this.repos = createRepositories(connection.db);
  }

  async getSubscription(clinicId: string) {
    const [subscription] = await this.repos.platform.findClinicSubscription(clinicId);
    const [settings] = await this.repos.clinics.findClinicSettings(clinicId);
    if (!subscription) {
      throw new AppError('NOT_FOUND', 'Clinic subscription not found.');
    }

    const snapshot =
      subscription.planSnapshotJson && typeof subscription.planSnapshotJson === 'object'
        ? (subscription.planSnapshotJson as Record<string, unknown>)
        : {};

    return {
      plan_key: String(snapshot.plan_key ?? 'unknown'),
      plan_name: String(snapshot.name ?? 'Plan'),
      status: subscription.status,
      included_voice_minutes: Number(snapshot.included_voice_minutes ?? 0),
      max_concurrent_calls: settings?.maxConcurrentCalls ?? 1,
      recording_retention_days: settings?.recordingRetentionDays ?? 10,
      transcript_retention_days: settings?.transcriptRetentionDays ?? 30,
      trial_end: null,
      notes: null,
    };
  }

  async getCurrentMonthUsage(clinicId: string) {
    const month = new Date().toISOString().slice(0, 7);
    const [usage] = await this.repos.platform.findUsageForMonth(clinicId, `${month}-01`);
    const subscription = await this.getSubscription(clinicId);
    return {
      month,
      used_voice_minutes: usage?.voiceCallCount ?? 0,
      included_voice_minutes: subscription.included_voice_minutes,
      voice_call_count: usage?.voiceCallCount ?? 0,
    };
  }

  async listSupportedLanguages() {
    const rows = await this.repos.platform.listSupportedLanguages();
    return rows.map((row) => ({
      language_code: row.languageCode,
      display_name: row.displayName,
      enabled_platform_wide: row.enabledPlatformWide,
    }));
  }

  async getClinicLanguages(clinicId: string) {
    const rows = await this.repos.platform.listClinicLanguages(clinicId);
    const defaultRow = rows.find((row) => row.isDefault) ?? rows[0];
    return {
      default_language_code: defaultRow?.languageCode ?? 'ta_tanglish',
      languages: rows.map((row) => ({
        language_code: row.languageCode,
        enabled: row.enabled,
        is_default: row.isDefault,
      })),
    };
  }

  async replaceClinicLanguages(clinicId: string, input: ReplaceClinicLanguagesInput) {
    for (const language of input.languages) {
      const [supported] = await this.repos.clinical.findSupportedLanguage(language.language_code);
      if (!supported?.enabledPlatformWide) {
        throw new AppError('VALIDATION_ERROR', `Unsupported language: ${language.language_code}`);
      }
    }

    const rows = await this.repos.platform.replaceClinicLanguages(
      clinicId,
      input.default_language_code,
      input.languages.map((row) => ({
        languageCode: row.language_code,
        enabled: row.enabled,
      })),
    );

    return {
      default_language_code: input.default_language_code,
      languages: rows.map((row) => ({
        language_code: row.languageCode,
        enabled: row.enabled,
        is_default: row.isDefault,
      })),
    };
  }

  async listSubscriptionPlans() {
    const rows = await this.repos.platform.listSubscriptionPlans();
    return rows.map((row) => ({
      plan_key: row.planKey,
      name: row.name,
      included_voice_minutes: row.includedVoiceMinutes,
      active: row.active,
    }));
  }

  async changeClinicSubscription(clinicId: string, input: PlatformSubscriptionChangeInput) {
    const [plan] = await this.repos.platform.findSubscriptionPlanByKey(input.plan_key);
    if (!plan) {
      throw new AppError('VALIDATION_ERROR', 'Subscription plan not found.');
    }

    const [updated] = await this.repos.platform.updateClinicSubscription(clinicId, {
      subscriptionPlanId: plan.id,
      status: input.status,
      planSnapshotJson: {
        plan_key: plan.planKey,
        name: plan.name,
        included_voice_minutes: plan.includedVoiceMinutes,
        ...(input.notes ? { notes: input.notes } : {}),
        ...(input.trial_end ? { trial_end: input.trial_end } : {}),
      },
    });

    if (!updated) {
      throw new AppError('NOT_FOUND', 'Clinic subscription not found.');
    }

    return {
      subscription: {
        plan_key: plan.planKey,
        plan_name: plan.name,
        status: updated.status,
      },
    };
  }
}
