import postgres from 'postgres';

import {
  appendWordsToLanguagePackField,
  getDefaultLanguagePack,
  proposeLanguagePackAdditionsFromReviewedExamples,
} from '@vaidya/shared';

async function main() {
  const databaseUrl =
    process.env.DATABASE_URL ??
    process.env.TEST_DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5433/vaidya_test';

  const dryRun = process.argv.includes('--dry-run');
  const sql = postgres(databaseUrl, { max: 3 });

  try {
    const rows = await sql`
      SELECT
        id,
        language_code,
        message_text_redacted,
        context_flow,
        context_state,
        expected_recognized_as,
        expected_intent,
        expected_entities_json
      FROM reviewed_examples
      ORDER BY created_at DESC
    `;

    const { proposals, rejected } = proposeLanguagePackAdditionsFromReviewedExamples(
      rows.map((row) => ({
        id: row.id as string,
        languageCode: row.language_code as string,
        messageTextRedacted: row.message_text_redacted as string,
        contextFlow: row.context_flow as string,
        contextState: row.context_state as string,
        expectedRecognizedAs: row.expected_recognized_as as string,
        expectedIntent: (row.expected_intent as string | null) ?? null,
        expectedEntitiesJson: row.expected_entities_json,
      })),
    );

    if (dryRun) {
      console.log(JSON.stringify({ dry_run: true, proposals, rejected }, null, 2));
      return;
    }

    for (const proposal of proposals) {
      const [existing] = await sql`
        SELECT *
        FROM language_packs
        WHERE language_code = ${proposal.language_code}
        LIMIT 1
      `;

      const basePack = existing
        ? getDefaultLanguagePack(proposal.language_code)
        : getDefaultLanguagePack(proposal.language_code);

      const current = existing
        ? appendWordsToLanguagePackField(
            {
              ...basePack,
              languageCode: proposal.language_code,
              yesWords: (existing.yes_words_json as string[]) ?? basePack.yesWords,
              noWords: (existing.no_words_json as string[]) ?? basePack.noWords,
              cancelWords: (existing.cancel_words_json as string[]) ?? basePack.cancelWords,
              todayWords: (existing.today_words_json as string[]) ?? basePack.todayWords,
              tomorrowWords: (existing.tomorrow_words_json as string[]) ?? basePack.tomorrowWords,
              laterWords: (existing.later_words_json as string[]) ?? basePack.laterWords,
              timePreferenceWords:
                (existing.time_preference_words_json as typeof basePack.timePreferenceWords) ??
                basePack.timePreferenceWords,
            },
            proposal.field,
            [proposal.word],
          )
        : appendWordsToLanguagePackField(
            getDefaultLanguagePack(proposal.language_code),
            proposal.field,
            [proposal.word],
          );

      await sql`
        INSERT INTO language_packs (
          language_code,
          yes_words_json,
          no_words_json,
          cancel_words_json,
          today_words_json,
          tomorrow_words_json,
          later_words_json,
          time_preference_words_json,
          classifier_examples_json
        )
        VALUES (
          ${proposal.language_code},
          ${sql.json(current.yesWords)},
          ${sql.json(current.noWords)},
          ${sql.json(current.cancelWords)},
          ${sql.json(current.todayWords)},
          ${sql.json(current.tomorrowWords)},
          ${sql.json(current.laterWords)},
          ${sql.json(current.timePreferenceWords)},
          ${sql.json([])}
        )
        ON CONFLICT (language_code) DO UPDATE SET
          yes_words_json = EXCLUDED.yes_words_json,
          no_words_json = EXCLUDED.no_words_json,
          cancel_words_json = EXCLUDED.cancel_words_json,
          today_words_json = EXCLUDED.today_words_json,
          tomorrow_words_json = EXCLUDED.tomorrow_words_json,
          later_words_json = EXCLUDED.later_words_json,
          time_preference_words_json = EXCLUDED.time_preference_words_json,
          updated_at = now()
      `;
    }

    console.log(JSON.stringify({ applied: proposals.length, proposals, rejected }, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
