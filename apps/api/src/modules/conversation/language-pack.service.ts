import { Inject, Injectable } from '@nestjs/common';

import { eq, languagePacks, supportedLanguages, type DatabaseConnection } from '@vaidya/db';
import {
  appendWordsToLanguagePackField,
  getDefaultLanguagePack,
  languagePackFromDbRow,
  languagePackToDbJson,
  type AddLanguagePackWordsInput,
  type CreateLanguagePackInput,
  type LanguagePack,
} from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../database/database.module';

@Injectable()
export class LanguagePackService {
  private readonly cache = new Map<string, LanguagePack>();

  constructor(@Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection) {}

  invalidateCache(languageCode?: string): void {
    if (languageCode) {
      this.cache.delete(languageCode);
      return;
    }
    this.cache.clear();
  }

  async getPack(languageCode: string): Promise<LanguagePack> {
    const cached = this.cache.get(languageCode);
    if (cached) {
      return cached;
    }

    const rows = await this.connection.db
      .select()
      .from(languagePacks)
      .where(eq(languagePacks.languageCode, languageCode))
      .limit(1);

    const pack =
      rows.length > 0
        ? languagePackFromDbRow({
            languageCode: rows[0]!.languageCode,
            yesWordsJson: rows[0]!.yesWordsJson,
            noWordsJson: rows[0]!.noWordsJson,
            todayWordsJson: rows[0]!.todayWordsJson,
            tomorrowWordsJson: rows[0]!.tomorrowWordsJson,
            timePreferenceWordsJson: rows[0]!.timePreferenceWordsJson,
            cancelWordsJson: rows[0]!.cancelWordsJson,
            laterWordsJson: rows[0]!.laterWordsJson,
          })
        : getDefaultLanguagePack(languageCode);

    this.cache.set(languageCode, pack);
    return pack;
  }

  async addWords(languageCode: string, input: AddLanguagePackWordsInput): Promise<LanguagePack> {
    let pack = await this.getPack(languageCode);
    for (const word of input.words) {
      pack = appendWordsToLanguagePackField(pack, input.field, [word]);
    }
    await this.savePack(pack);
    this.cache.set(languageCode, pack);
    return pack;
  }

  async createLanguagePack(input: CreateLanguagePackInput): Promise<LanguagePack> {
    const defaults = getDefaultLanguagePack('english');
    const pack: LanguagePack = {
      languageCode: input.language_code,
      yesWords: input.yes_words ?? defaults.yesWords,
      noWords: input.no_words ?? defaults.noWords,
      cancelWords: defaults.cancelWords,
      todayWords: input.today_words ?? defaults.todayWords,
      tomorrowWords: input.tomorrow_words ?? defaults.tomorrowWords,
      timePreferenceWords: defaults.timePreferenceWords,
      laterWords: defaults.laterWords,
    };

    await this.connection.db
      .insert(supportedLanguages)
      .values({
        languageCode: input.language_code,
        displayName: input.display_name,
        nativeName: input.display_name,
        enabledPlatformWide: true,
        fallbackLanguageCode: 'english',
      })
      .onConflictDoNothing();

    await this.savePack(pack);
    this.cache.set(input.language_code, pack);
    return pack;
  }

  private async savePack(pack: LanguagePack): Promise<void> {
    const json = languagePackToDbJson(pack);
    await this.connection.db
      .insert(languagePacks)
      .values({
        languageCode: pack.languageCode,
        yesWordsJson: json.yesWordsJson,
        noWordsJson: json.noWordsJson,
        cancelWordsJson: json.cancelWordsJson,
        laterWordsJson: json.laterWordsJson,
        todayWordsJson: json.todayWordsJson,
        tomorrowWordsJson: json.tomorrowWordsJson,
        timePreferenceWordsJson: json.timePreferenceWordsJson,
        classifierExamplesJson: [],
      })
      .onConflictDoUpdate({
        target: languagePacks.languageCode,
        set: {
          yesWordsJson: json.yesWordsJson,
          noWordsJson: json.noWordsJson,
          cancelWordsJson: json.cancelWordsJson,
          laterWordsJson: json.laterWordsJson,
          todayWordsJson: json.todayWordsJson,
          tomorrowWordsJson: json.tomorrowWordsJson,
          timePreferenceWordsJson: json.timePreferenceWordsJson,
          updatedAt: new Date(),
        },
      });
  }

  toResponse(pack: LanguagePack) {
    return {
      language_code: pack.languageCode,
      yes_words: pack.yesWords,
      no_words: pack.noWords,
      cancel_words: pack.cancelWords,
      today_words: pack.todayWords,
      tomorrow_words: pack.tomorrowWords,
      later_words: pack.laterWords,
      time_preference_words: pack.timePreferenceWords,
    };
  }
}
