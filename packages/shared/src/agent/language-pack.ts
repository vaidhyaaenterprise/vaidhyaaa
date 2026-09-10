export type LanguagePack = {
  languageCode: string;
  yesWords: string[];
  noWords: string[];
  cancelWords: string[];
  todayWords: string[];
  tomorrowWords: string[];
  timePreferenceWords: {
    morning: string[];
    afternoon: string[];
    evening: string[];
  };
  laterWords: string[];
};

export const DEFAULT_LANGUAGE_PACKS: Record<string, LanguagePack> = {
  ta_tanglish: {
    languageCode: 'ta_tanglish',
    yesWords: ['seri', 'sari', 'okay', 'ok', 'aama', 'confirm', 'pannunga'],
    noWords: ['vendam', 'venam', 'venda', 'no'],
    cancelWords: ['cancel', 'stop'],
    todayWords: ['inniku', 'inaiku', 'iniku', 'today', 'indru'],
    tomorrowWords: ['naalaikku', 'naalaiku', 'nalaki', 'nalaiku', 'tomorrow'],
    timePreferenceWords: {
      morning: ['morning', 'kaalai'],
      afternoon: ['afternoon', 'madhiyanam', 'madiyanam'],
      evening: ['evening', 'maalai', 'eve'],
    },
    laterWords: ['later', 'later paakalam', 'stop'],
  },
  english: {
    languageCode: 'english',
    yesWords: ['yes', 'okay', 'ok', 'confirm', 'sure'],
    noWords: ['no', 'no thanks'],
    cancelWords: ['cancel', 'stop'],
    todayWords: ['today'],
    tomorrowWords: ['tomorrow'],
    timePreferenceWords: {
      morning: ['morning'],
      afternoon: ['afternoon'],
      evening: ['evening'],
    },
    laterWords: ['later', 'not now'],
  },
};

export function getDefaultLanguagePack(languageCode: string): LanguagePack {
  return (
    DEFAULT_LANGUAGE_PACKS[languageCode] ??
    DEFAULT_LANGUAGE_PACKS.english ??
    DEFAULT_LANGUAGE_PACKS['english']!
  );
}

export function normalizeLanguagePackText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchesLanguagePackWord(normalized: string, words: string[]): boolean {
  for (const word of words) {
    const candidate = word.toLowerCase().trim();
    if (!candidate) {
      continue;
    }
    if (candidate.includes(' ')) {
      if (normalized.includes(candidate)) {
        return true;
      }
      continue;
    }
    if (new RegExp(`\\b${escapeRegex(candidate)}\\b`, 'i').test(normalized)) {
      return true;
    }
  }
  return false;
}

export function languagePackFromDbRow(row: {
  languageCode: string;
  yesWordsJson: unknown;
  noWordsJson: unknown;
  todayWordsJson: unknown;
  tomorrowWordsJson: unknown;
  timePreferenceWordsJson: unknown;
  cancelWordsJson?: unknown;
  laterWordsJson?: unknown;
}): LanguagePack {
  const defaults = getDefaultLanguagePack(row.languageCode);
  const timePreference =
    row.timePreferenceWordsJson && typeof row.timePreferenceWordsJson === 'object'
      ? (row.timePreferenceWordsJson as LanguagePack['timePreferenceWords'])
      : defaults.timePreferenceWords;

  return {
    languageCode: row.languageCode,
    yesWords: Array.isArray(row.yesWordsJson)
      ? (row.yesWordsJson as string[])
      : defaults.yesWords,
    noWords: Array.isArray(row.noWordsJson) ? (row.noWordsJson as string[]) : defaults.noWords,
    cancelWords: Array.isArray(row.cancelWordsJson)
      ? (row.cancelWordsJson as string[])
      : defaults.cancelWords,
    todayWords: Array.isArray(row.todayWordsJson)
      ? (row.todayWordsJson as string[])
      : defaults.todayWords,
    tomorrowWords: Array.isArray(row.tomorrowWordsJson)
      ? (row.tomorrowWordsJson as string[])
      : defaults.tomorrowWords,
    timePreferenceWords: timePreference,
    laterWords: Array.isArray(row.laterWordsJson)
      ? (row.laterWordsJson as string[])
      : defaults.laterWords,
  };
}
