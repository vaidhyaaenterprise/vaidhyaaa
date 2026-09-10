import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';
import { AppError, type LanguageCode, SUPPORTED_LANGUAGE_CODES } from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';

export type LanguageSource = 'clinic_default' | 'patient_requested' | 'detected';

@Injectable()
export class LanguageManager {
  private readonly repos: Repositories;

  constructor(@Inject(DATABASE_CONNECTION) connection: DatabaseConnection) {
    this.repos = createRepositories(connection.db);
  }

  async resolveInitialLanguage(
    clinicId: string,
    explicitLanguageCode?: LanguageCode,
  ): Promise<{ languageCode: LanguageCode; languageSource: LanguageSource }> {
    if (explicitLanguageCode) {
      await this.assertLanguageAllowed(clinicId, explicitLanguageCode);
      return {
        languageCode: explicitLanguageCode,
        languageSource: 'patient_requested',
      };
    }

    const [clinic] = await this.repos.clinics.findClinicById(clinicId);
    if (!clinic) {
      throw new AppError('CLINIC_NOT_FOUND', 'Clinic not found.');
    }

    const defaultLanguage = clinic.defaultLanguageCode as LanguageCode;
    await this.assertLanguageAllowed(clinicId, defaultLanguage);

    return {
      languageCode: defaultLanguage,
      languageSource: 'clinic_default',
    };
  }

  detectLanguageSwitch(messageText: string): LanguageCode | null {
    const normalized = messageText.trim().toLowerCase();

    if (
      /\benglish please\b/.test(normalized) ||
      /\bspeak english\b/.test(normalized) ||
      /\bin english\b/.test(normalized) ||
      normalized === 'english'
    ) {
      return 'english';
    }

    if (
      /\btamil\b/.test(normalized) ||
      /\btanglish\b/.test(normalized) ||
      /\btamil-la\b/.test(normalized) ||
      normalized === 'ta_tanglish'
    ) {
      return 'ta_tanglish';
    }

    return null;
  }

  assertSupportedLanguageCode(languageCode: string): languageCode is LanguageCode {
    return (SUPPORTED_LANGUAGE_CODES as readonly string[]).includes(languageCode);
  }

  private async assertLanguageAllowed(clinicId: string, languageCode: LanguageCode): Promise<void> {
    if (!this.assertSupportedLanguageCode(languageCode)) {
      throw new AppError('VALIDATION_ERROR', 'Unsupported language code.', {
        language_code: languageCode,
      });
    }

    const clinicLanguages = await this.repos.platform.listClinicLanguages(clinicId);
    if (clinicLanguages.length === 0) {
      return;
    }

    const enabled = clinicLanguages.some(
      (entry) => entry.languageCode === languageCode && entry.enabled,
    );

    if (!enabled) {
      throw new AppError('VALIDATION_ERROR', 'Language is not enabled for this clinic.', {
        language_code: languageCode,
      });
    }
  }
}
