import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type DatabaseConnection } from '@vaidya/db';
import {
  AppError,
  buildReviewedExamplesExportCases,
  proposeLanguagePackAdditionsFromReviewedExamples,
  type CreateReviewedExampleInput,
} from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../database/database.module';

import { LanguagePackService } from '../conversation/language-pack.service';

@Injectable()
export class LanguageVariationAdminService {
  private readonly repos;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(LanguagePackService) private readonly languagePackService: LanguagePackService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async getLanguagePack(languageCode: string) {
    const pack = await this.languagePackService.getPack(languageCode);
    return this.languagePackService.toResponse(pack);
  }

  async addLanguagePackWords(languageCode: string, input: { field: string; words: string[] }) {
    const pack = await this.languagePackService.addWords(languageCode, {
      field: input.field as Parameters<LanguagePackService['addWords']>[1]['field'],
      words: input.words,
    });
    return this.languagePackService.toResponse(pack);
  }

  async createLanguagePack(input: {
    language_code: string;
    display_name: string;
    yes_words?: string[];
    no_words?: string[];
    today_words?: string[];
    tomorrow_words?: string[];
  }) {
    const pack = await this.languagePackService.createLanguagePack(input);
    return this.languagePackService.toResponse(pack);
  }

  async createReviewedExample(input: CreateReviewedExampleInput) {
    const [row] = await this.repos.reviewedExamples.create({
      languageCode: input.language_code,
      messageTextRedacted: input.message_text_redacted,
      contextFlow: input.context_flow,
      contextState: input.context_state,
      expectedRecognizedAs: input.expected_recognized_as,
      expectedIntent: input.expected_intent ?? null,
      expectedEntitiesJson: input.expected_entities_json ?? {},
      source: input.source ?? 'manual_review',
      approvedForPromptExamples: input.approved_for_prompt_examples ?? false,
    });
    if (!row) {
      throw new AppError('INTERNAL_ERROR', 'Failed to create reviewed example.');
    }
    return this.toReviewedExampleResponse(row);
  }

  async exportReviewedExamples() {
    const rows = await this.repos.reviewedExamples.listAll();
    return { cases: buildReviewedExamplesExportCases(rows) };
  }

  async proposeLanguagePackAdditions() {
    const rows = await this.repos.reviewedExamples.listForLanguagePackProposal();
    return proposeLanguagePackAdditionsFromReviewedExamples(
      rows.map((row) => ({
        id: row.id,
        languageCode: row.languageCode,
        messageTextRedacted: row.messageTextRedacted,
        contextFlow: row.contextFlow,
        contextState: row.contextState,
        expectedRecognizedAs: row.expectedRecognizedAs,
        expectedIntent: row.expectedIntent,
        expectedEntitiesJson: row.expectedEntitiesJson,
      })),
    );
  }

  async applyProposedLanguagePackAdditions(dryRun = false) {
    const { proposals, rejected } = await this.proposeLanguagePackAdditions();
    const applied: typeof proposals = [];

    if (!dryRun) {
      for (const proposal of proposals) {
        await this.languagePackService.addWords(proposal.language_code, {
          field: proposal.field,
          words: [proposal.word],
        });
        applied.push(proposal);
      }
    }

    return {
      dry_run: dryRun,
      proposals,
      applied: dryRun ? [] : applied,
      rejected,
    };
  }

  private toReviewedExampleResponse(row: {
    id: string;
    languageCode: string;
    messageTextRedacted: string;
    contextFlow: string;
    contextState: string;
    expectedRecognizedAs: string;
    expectedIntent: string | null;
    expectedEntitiesJson: unknown;
    source: string;
    approvedForPromptExamples: boolean;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      language_code: row.languageCode,
      message_text_redacted: row.messageTextRedacted,
      context_flow: row.contextFlow,
      context_state: row.contextState,
      expected_recognized_as: row.expectedRecognizedAs,
      expected_intent: row.expectedIntent,
      expected_entities_json:
        row.expectedEntitiesJson && typeof row.expectedEntitiesJson === 'object'
          ? row.expectedEntitiesJson
          : {},
      source: row.source,
      approved_for_prompt_examples: row.approvedForPromptExamples,
      created_at: row.createdAt.toISOString(),
    };
  }
}
