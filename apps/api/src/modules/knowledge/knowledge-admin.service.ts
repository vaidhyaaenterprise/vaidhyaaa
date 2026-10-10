import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';
import type { DatabaseConnection } from '@vaidya/db';
import type { KnowledgeEntryRow } from '@vaidya/db';
import {
  AppError,
  buildKnowledgeSearchText,
  type CreateKnowledgeEntryInput,
  type PatchKnowledgeEntryInput,
} from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../database/database.module';

import { KnowledgeEmbeddingService } from './knowledge-embedding.service';
import {
  VAIDYA_MANUAL_QA_TEMPLATE,
  VAIDYA_MANUAL_TEMPLATE_SOURCE,
} from './manual-qa-template.catalog';

type TemplateUiStatus = 'draft' | 'approved' | 'inactive';

type ManualTemplateQuestionResponse = ReturnType<
  KnowledgeAdminService['buildManualEntryResponse']
> & {
  exists: boolean;
  service_name_required: boolean;
  ui_status: TemplateUiStatus;
};

type ManualTemplateSectionResponse = {
  key: string;
  title: string;
  is_custom: boolean;
  questions: ManualTemplateQuestionResponse[];
};

type BulkKnowledgeApprovalSkipReason =
  | 'answer_required'
  | 'not_applicable'
  | 'status_not_reviewable'
  | 'not_found_or_inaccessible'
  | 'changed_during_approval';

@Injectable()
export class KnowledgeAdminService {
  private readonly repos: Repositories;

  private static readonly MEDICAL_CONTENT_PATTERNS = [
    /\btablet\b/i,
    /\bdose\b/i,
    /\bdosage\b/i,
    /\bmg\b/i,
    /\bml\b/i,
    /\bcapsule\b/i,
    /\binjection\b/i,
    /\bdiagnosis\b/i,
    /\btreatment\b/i,
    /\bprescribe\b/i,
    /\bmedicine\b/i,
    /\bserious\b/i,
    /\bstart\s+medicine\b/i,
    /\bstop\s+medicine\b/i,
  ];

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(KnowledgeEmbeddingService) private readonly embeddingService: KnowledgeEmbeddingService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async getEmbeddingStatus(clinicId: string) {
    return this.repos.knowledge.getEmbeddingStatusSummary(clinicId);
  }

  async listEntries(clinicId: string) {
    const rows = await this.repos.knowledge.listKnowledgeEntries(clinicId);
    return rows.map((row) => this.buildManualEntryResponse(row));
  }

  private ensureNonMedicalAnswer(answer: string) {
    const normalized = answer.trim();
    if (!normalized) {
      return;
    }

    for (const pattern of KnowledgeAdminService.MEDICAL_CONTENT_PATTERNS) {
      if (pattern.test(normalized)) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Medical advice, diagnosis, medicine, dosage, and treatment instructions cannot be stored in the clinic knowledge base. Please provide only clinic-approved operational or administrative information.',
        );
      }
    }
  }

  private normalizeQuestionForSimilarity(question: string): string {
    return question
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private computeStatus(input: {
    status: string | undefined;
    applicable: boolean;
    qaApproved: boolean;
    answer: string;
  }): 'pending_review' | 'approved' | 'disabled' | 'needs_update' {
    const explicit = input.status;
    if (explicit === 'disabled') {
      return 'disabled';
    }

    if (!input.applicable) {
      return 'disabled';
    }

    if (!input.answer.trim()) {
      return 'needs_update';
    }

    if (explicit === 'approved') {
      return input.qaApproved ? 'approved' : 'pending_review';
    }

    if (!input.qaApproved) {
      return explicit === 'needs_update' ? 'needs_update' : 'pending_review';
    }

    return explicit === 'needs_update' ? 'needs_update' : 'pending_review';
  }

  private buildManualEntryResponse(row: KnowledgeEntryRow) {
    return {
      id: row.id,
      clinic_id: row.clinicId,
      question: row.question,
      answer: row.answer,
      category: row.category,
      alternative_phrases_json: (row.alternativePhrasesJson as string[] | null) ?? [],
      source_file_id: row.sourceFileId,
      template_key: row.templateKey,
      section_key: row.sectionKey,
      source_notes: row.sourceNotes,
      service_name: row.serviceName,
      applicable: row.applicable,
      qa_approved: row.qaApproved,
      status: row.status,
      embedding_status: row.embeddingStatus,
      embedding_model: row.embeddingModel,
      embedding_dimensions: row.embeddingDimensions,
      embedding_generated_at: row.embeddingGeneratedAt,
      embedding_error: row.embeddingError,
      embedding_source_hash: row.embeddingSourceHash,
      last_embedding_job_id: row.lastEmbeddingJobId,
      search_text: row.searchText,
      source_file: row.sourceFile,
      source_page: row.sourcePage,
      approved_by_user_id: row.approvedByUserId,
      approved_at: row.approvedAt,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    };
  }

  private toTemplateUiStatus(input: {
    status: string;
    applicable: boolean;
    qaApproved: boolean;
    answer: string;
  }): TemplateUiStatus {
    if (!input.applicable) {
      return 'inactive';
    }
    if (input.status === 'approved' && input.qaApproved && input.answer.trim().length > 0) {
      return 'approved';
    }
    return 'draft';
  }

  private toTemplateQuestionResponse(input: {
    row: ReturnType<KnowledgeAdminService['buildManualEntryResponse']>;
    exists: boolean;
    serviceNameRequired: boolean;
  }): ManualTemplateQuestionResponse {
    return {
      ...input.row,
      exists: input.exists,
      service_name_required: input.serviceNameRequired,
      ui_status: this.toTemplateUiStatus({
        status: input.row.status,
        applicable: input.row.applicable,
        qaApproved: input.row.qa_approved,
        answer: input.row.answer,
      }),
    };
  }

  private isPotentialDuplicateQuestion(a: string, b: string): boolean {
    if (a === b) {
      return true;
    }
    const aTokens = new Set(a.split(' ').filter((token) => token.length > 2));
    const bTokens = b.split(' ').filter((token) => token.length > 2);
    if (aTokens.size === 0 || bTokens.length === 0) {
      return false;
    }
    const overlap = bTokens.filter((token) => aTokens.has(token)).length;
    const ratio = overlap / Math.max(aTokens.size, bTokens.length);
    return ratio >= 0.7;
  }

  async listManualTemplate(clinicId: string) {
    const [existingRows, sectionRows] = await Promise.all([
      this.repos.knowledge.listManualTemplateEntries(clinicId),
      this.repos.knowledge.listKnowledgeSections(clinicId),
    ]);
    const byTemplateKey = new Map(
      existingRows.filter((row) => row.templateKey).map((row) => [row.templateKey!, row]),
    );
    const sectionOverrides = new Map(sectionRows.map((row) => [row.sectionKey, row]));

    const sections = new Map<string, ManualTemplateSectionResponse>();
    const catalogTemplateKeys = new Set<string>();
    const catalogSectionKeys = new Set<string>();
    const now = new Date();

    for (const preset of VAIDYA_MANUAL_QA_TEMPLATE) {
      catalogSectionKeys.add(preset.sectionKey);
      const sectionOverride = sectionOverrides.get(preset.sectionKey);
      if (sectionOverride?.active === false || sections.has(preset.sectionKey)) {
        continue;
      }
      sections.set(preset.sectionKey, {
        key: preset.sectionKey,
        title: sectionOverride?.title ?? preset.sectionTitle,
        is_custom: false,
        questions: [],
      });
    }

    for (const preset of VAIDYA_MANUAL_QA_TEMPLATE) {
      const templateKey = `${preset.sectionKey}::${preset.question}`;
      catalogTemplateKeys.add(templateKey);
      const sectionOverride = sectionOverrides.get(preset.sectionKey);
      if (sectionOverride?.active === false) {
        continue;
      }

      const existing = byTemplateKey.get(templateKey);
      if (existing?.removedAt) {
        continue;
      }

      const row = this.toTemplateQuestionResponse({
        row: existing
          ? this.buildManualEntryResponse(existing)
          : {
              id: `template:${preset.sectionKey}:${preset.question}`,
              clinic_id: clinicId,
              question: preset.question,
              answer: '',
              category: preset.category,
              alternative_phrases_json: [],
              source_file_id: null,
              template_key: templateKey,
              section_key: preset.sectionKey,
              source_notes: preset.sourceNotes ?? null,
              service_name: null,
              applicable: true,
              qa_approved: false,
              status: 'needs_update',
              embedding_status: 'not_required',
              embedding_model: null,
              embedding_dimensions: null,
              embedding_generated_at: null,
              embedding_error: null,
              embedding_source_hash: null,
              last_embedding_job_id: null,
              search_text: null,
              source_file: VAIDYA_MANUAL_TEMPLATE_SOURCE,
              source_page: null,
              approved_by_user_id: null,
              approved_at: null,
              created_at: now,
              updated_at: now,
            },
        exists: Boolean(existing),
        serviceNameRequired: Boolean(preset.serviceNameRequired),
      });

      const key = preset.sectionKey;
      sections.get(key)!.questions.push(row);
    }

    const customSectionOverride = sectionOverrides.get('custom');
    if (customSectionOverride?.active !== false) {
      sections.set('custom', {
        key: 'custom',
        title: customSectionOverride?.title ?? 'Custom Q&A',
        is_custom: true,
        questions: [],
      });
    }

    for (const sectionRow of sectionRows) {
      if (!sectionRow.active || sections.has(sectionRow.sectionKey)) {
        continue;
      }
      sections.set(sectionRow.sectionKey, {
        key: sectionRow.sectionKey,
        title: sectionRow.title,
        is_custom: sectionRow.isCustom,
        questions: [],
      });
    }

    for (const existing of existingRows) {
      if (
        existing.removedAt ||
        !existing.sectionKey ||
        catalogTemplateKeys.has(existing.templateKey ?? '')
      ) {
        continue;
      }

      // Do not reintroduce blank rows imported from the older, larger starter
      // template. Any answered/approved legacy row remains visible as clinic data.
      if (
        existing.templateKey &&
        existing.answer.trim().length === 0 &&
        existing.status !== 'approved' &&
        !existing.qaApproved
      ) {
        continue;
      }

      const sectionOverride = sectionOverrides.get(existing.sectionKey);
      if (sectionOverride?.active === false) {
        continue;
      }

      if (!sections.has(existing.sectionKey)) {
        const fallbackTitle = existing.sectionKey
          .split('_')
          .filter(Boolean)
          .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
          .join(' ');
        sections.set(existing.sectionKey, {
          key: existing.sectionKey,
          title: sectionOverride?.title ?? (fallbackTitle || 'Custom Section'),
          is_custom: sectionOverride?.isCustom ?? !catalogSectionKeys.has(existing.sectionKey),
          questions: [],
        });
      }

      sections.get(existing.sectionKey)!.questions.push(
        this.toTemplateQuestionResponse({
          row: this.buildManualEntryResponse(existing),
          exists: true,
          serviceNameRequired: existing.category === 'service_specific',
        }),
      );
    }

    const allQuestions = Array.from(sections.values()).flatMap((section) => section.questions);
    const summary = {
      total: allQuestions.length,
      completed: allQuestions.filter((q) => {
        const answer = typeof q.answer === 'string' ? q.answer.trim() : '';
        return answer.length > 0;
      }).length,
      approved: allQuestions.filter((q) => q.ui_status === 'approved').length,
      pending: allQuestions.filter((q) => q.ui_status === 'draft').length,
      not_applicable: allQuestions.filter((q) => q.ui_status === 'inactive').length,
    };

    return {
      source: VAIDYA_MANUAL_TEMPLATE_SOURCE,
      sections: Array.from(sections.values()),
      summary,
    };
  }

  async createManualSection(input: { clinicId: string; title: string }) {
    const title = input.title.trim();
    const sectionRows = await this.repos.knowledge.listKnowledgeSections(input.clinicId);
    const defaultSections = Array.from(
      new Map(
        VAIDYA_MANUAL_QA_TEMPLATE.map((preset) => [
          preset.sectionKey,
          { key: preset.sectionKey, title: preset.sectionTitle },
        ]),
      ).values(),
    );
    defaultSections.push({ key: 'custom', title: 'Custom Q&A' });

    const activeTitles = new Set(
      defaultSections
        .filter(
          (section) => sectionRows.find((row) => row.sectionKey === section.key)?.active !== false,
        )
        .map((section) => {
          const override = sectionRows.find((row) => row.sectionKey === section.key);
          return (override?.title ?? section.title).trim().toLowerCase();
        }),
    );
    for (const row of sectionRows) {
      if (row.active) {
        activeTitles.add(row.title.trim().toLowerCase());
      }
    }
    if (activeTitles.has(title.toLowerCase())) {
      throw new AppError('CONFLICT', 'A knowledge section with this name already exists.');
    }

    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || 'section';
    const sectionKey = `custom_${slug}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const [created] = await this.repos.knowledge.upsertKnowledgeSection({
      clinicId: input.clinicId,
      sectionKey,
      title,
      isCustom: true,
      active: true,
      sortOrder: 100 + sectionRows.length,
    });
    if (!created) {
      throw new AppError('INTERNAL_ERROR', 'Failed to create the knowledge section.');
    }
    return {
      key: created.sectionKey,
      title: created.title,
      is_custom: created.isCustom,
      questions: [],
    };
  }

  async updateManualSection(input: { clinicId: string; sectionKey: string; title: string }) {
    const sectionRows = await this.repos.knowledge.listKnowledgeSections(input.clinicId);
    const existingOverride = sectionRows.find((row) => row.sectionKey === input.sectionKey);
    const defaultTitle =
      input.sectionKey === 'custom'
        ? 'Custom Q&A'
        : VAIDYA_MANUAL_QA_TEMPLATE.find((preset) => preset.sectionKey === input.sectionKey)
            ?.sectionTitle;
    if (existingOverride?.active === false || (!existingOverride && !defaultTitle)) {
      throw new AppError('NOT_FOUND', 'Knowledge section not found.');
    }

    const title = input.title.trim();
    const effectiveActiveSections = new Map<string, string>();
    for (const preset of VAIDYA_MANUAL_QA_TEMPLATE) {
      if (!effectiveActiveSections.has(preset.sectionKey)) {
        const override = sectionRows.find((row) => row.sectionKey === preset.sectionKey);
        if (override?.active !== false) {
          effectiveActiveSections.set(preset.sectionKey, override?.title ?? preset.sectionTitle);
        }
      }
    }
    const customOverride = sectionRows.find((row) => row.sectionKey === 'custom');
    if (customOverride?.active !== false) {
      effectiveActiveSections.set('custom', customOverride?.title ?? 'Custom Q&A');
    }
    for (const row of sectionRows) {
      if (row.active) {
        effectiveActiveSections.set(row.sectionKey, row.title);
      }
    }
    const duplicate = Array.from(effectiveActiveSections).some(
      ([sectionKey, sectionTitle]) =>
        sectionKey !== input.sectionKey &&
        sectionTitle.trim().toLowerCase() === title.toLowerCase(),
    );
    if (duplicate) {
      throw new AppError('CONFLICT', 'A knowledge section with this name already exists.');
    }

    const [updated] = await this.repos.knowledge.upsertKnowledgeSection({
      clinicId: input.clinicId,
      sectionKey: input.sectionKey,
      title,
      isCustom: existingOverride?.isCustom ?? (input.sectionKey === 'custom' || !defaultTitle),
      active: true,
      sortOrder: existingOverride?.sortOrder ?? 0,
    });
    if (!updated) {
      throw new AppError('INTERNAL_ERROR', 'Failed to update the knowledge section.');
    }
    return {
      key: updated.sectionKey,
      title: updated.title,
      is_custom: updated.isCustom,
    };
  }

  async removeManualSection(input: { clinicId: string; sectionKey: string }) {
    const [sectionRows, entries] = await Promise.all([
      this.repos.knowledge.listKnowledgeSections(input.clinicId),
      this.repos.knowledge.listVisibleSectionEntries(input.clinicId, input.sectionKey),
    ]);
    const existingOverride = sectionRows.find((row) => row.sectionKey === input.sectionKey);
    const defaultTitle =
      input.sectionKey === 'custom'
        ? 'Custom Q&A'
        : VAIDYA_MANUAL_QA_TEMPLATE.find((preset) => preset.sectionKey === input.sectionKey)
            ?.sectionTitle;
    if (existingOverride?.active === false || (!existingOverride && !defaultTitle)) {
      throw new AppError('NOT_FOUND', 'Knowledge section not found.');
    }
    if (entries.some((entry) => entry.status === 'approved' || entry.qaApproved)) {
      throw new AppError(
        'CONFLICT',
        'This section contains approved questions. Disable them before removing the section.',
      );
    }

    const archived = await this.repos.knowledge.archiveKnowledgeSection({
      clinicId: input.clinicId,
      sectionKey: input.sectionKey,
      title: existingOverride?.title ?? defaultTitle ?? 'Section',
      isCustom: existingOverride?.isCustom ?? (input.sectionKey === 'custom' || !defaultTitle),
      active: false,
      sortOrder: existingOverride?.sortOrder ?? 0,
    });
    if (archived.blocked) {
      throw new AppError(
        'CONFLICT',
        'This section contains approved questions. Disable them before removing the section.',
      );
    }
    if (!archived.section) {
      throw new AppError('INTERNAL_ERROR', 'Failed to remove the knowledge section.');
    }
    return { removed: true, section_key: input.sectionKey };
  }

  async removeManualQuestion(input: { clinicId: string; knowledgeId: string }) {
    if (input.knowledgeId.startsWith('template:')) {
      const preset = VAIDYA_MANUAL_QA_TEMPLATE.find(
        (candidate) =>
          `template:${candidate.sectionKey}:${candidate.question}` === input.knowledgeId,
      );
      if (!preset) {
        throw new AppError('NOT_FOUND', 'Knowledge question not found.');
      }

      const templateKey = `${preset.sectionKey}::${preset.question}`;
      const [existing] = await this.repos.knowledge.findByTemplateKey(input.clinicId, templateKey);
      if (existing) {
        if (existing.removedAt) {
          return { removed: true, knowledge_id: input.knowledgeId };
        }
        if (existing.status === 'approved' || existing.qaApproved) {
          throw new AppError(
            'CONFLICT',
            'Approved questions must be disabled before they can be removed.',
          );
        }
        await this.repos.knowledge.removeKnowledgeEntry(input.clinicId, existing.id);
      } else {
        await this.repos.knowledge.createKnowledgeEntry({
          clinicId: input.clinicId,
          templateKey,
          sectionKey: preset.sectionKey,
          question: preset.question,
          answer: '',
          category: preset.category,
          sourceFile: VAIDYA_MANUAL_TEMPLATE_SOURCE,
          applicable: false,
          qaApproved: false,
          status: 'disabled',
          embeddingStatus: 'not_required',
          removedAt: new Date(),
        });
      }
      return { removed: true, knowledge_id: input.knowledgeId };
    }

    const [existing] = await this.repos.knowledge.findKnowledgeEntry(
      input.clinicId,
      input.knowledgeId,
    );
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Knowledge question not found.');
    }
    if (existing.status === 'approved' || existing.qaApproved) {
      throw new AppError(
        'CONFLICT',
        'Approved questions must be disabled before they can be removed.',
      );
    }
    await this.repos.knowledge.removeKnowledgeEntry(input.clinicId, existing.id);
    return { removed: true, knowledge_id: existing.id };
  }

  async importManualTemplate(input: { clinicId: string }) {
    let importedCount = 0;
    let existingCount = 0;
    const importedKnowledgeIds: string[] = [];

    for (const preset of VAIDYA_MANUAL_QA_TEMPLATE) {
      const templateKey = `${preset.sectionKey}::${preset.question}`;
      const [existing] = await this.repos.knowledge.findByTemplateKey(input.clinicId, templateKey);
      if (existing) {
        existingCount += 1;
        continue;
      }

      const searchText = buildKnowledgeSearchText({
        question: preset.question,
        answer: '',
        category: preset.category,
        alternativePhrases: [],
      });

      const [created] = await this.repos.knowledge.createKnowledgeEntry({
        clinicId: input.clinicId,
        templateKey,
        sectionKey: preset.sectionKey,
        question: preset.question,
        answer: '',
        category: preset.category,
        sourceNotes: preset.sourceNotes,
        sourceFile: VAIDYA_MANUAL_TEMPLATE_SOURCE,
        applicable: true,
        qaApproved: false,
        status: 'needs_update',
        embeddingStatus: 'pending',
        searchText,
      });

      if (created) {
        importedKnowledgeIds.push(created.id);
      }

      importedCount += 1;
    }

    for (const knowledgeEntryId of importedKnowledgeIds) {
      await this.embeddingService.enqueueEmbeddingJob({
        clinicId: input.clinicId,
        knowledgeEntryId,
        reason: 'edited',
      });
    }

    return {
      imported: importedCount,
      existing: existingCount,
    };
  }

  async createManualEntry(input: { clinicId: string; payload: CreateKnowledgeEntryInput }) {
    const applicable = input.payload.applicable ?? true;
    const forcedQaApproved =
      input.payload.status === 'approved' && input.payload.qa_approved === undefined
        ? true
        : undefined;
    const requestedQaApproved = input.payload.qa_approved ?? forcedQaApproved ?? false;
    const qaApproved = applicable ? requestedQaApproved : false;
    this.ensureNonMedicalAnswer(input.payload.answer);

    const status = this.computeStatus({
      status: input.payload.status,
      applicable,
      qaApproved,
      answer: input.payload.answer,
    });

    const templateKey = input.payload.template_key;
    if (templateKey) {
      const [existingByTemplate] = await this.repos.knowledge.findByTemplateKey(
        input.clinicId,
        templateKey,
      );
      if (existingByTemplate) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          'Existing Q&A already exists for this template question.',
        );
      }
    }

    const normalizedQuestion = this.normalizeQuestionForSimilarity(input.payload.question);
    const duplicateCandidates = await this.repos.knowledge.findPotentialDuplicates(
      input.clinicId,
      normalizedQuestion,
    );
    const potentialDuplicates = duplicateCandidates.filter((candidate) =>
      this.isPotentialDuplicateQuestion(
        this.normalizeQuestionForSimilarity(candidate.question),
        normalizedQuestion,
      ),
    );

    if (potentialDuplicates.length > 0 && !templateKey) {
      throw new AppError(
        'IDEMPOTENCY_CONFLICT',
        'Similar Q&A already exists. Review before creating another.',
      );
    }

    const searchText = buildKnowledgeSearchText({
      question: input.payload.question,
      answer: input.payload.answer,
      category: input.payload.category ?? null,
      alternativePhrases: input.payload.alternative_phrases_json,
    });

    const shouldGenerateEmbedding =
      status === 'approved' && applicable && qaApproved && input.payload.answer.trim().length > 0;

    const [created] = await this.repos.knowledge.createKnowledgeEntry({
      clinicId: input.clinicId,
      templateKey: input.payload.template_key,
      sectionKey: input.payload.section_key,
      question: input.payload.question,
      answer: input.payload.answer,
      category: input.payload.category ?? null,
      alternativePhrasesJson: input.payload.alternative_phrases_json,
      sourceNotes: input.payload.source_notes,
      serviceName: input.payload.service_name,
      applicable,
      qaApproved,
      sourceFileId: input.payload.source_file_id,
      sourceFile: input.payload.source_file,
      sourcePage: input.payload.source_page,
      status,
      searchText: shouldGenerateEmbedding ? searchText : null,
      embeddingStatus: shouldGenerateEmbedding ? 'pending' : 'not_required',
      ...(status === 'approved' ? { approvedAt: new Date() } : {}),
    });

    if (!created) {
      throw new AppError('INTERNAL_ERROR', 'Failed to create knowledge entry.');
    }

    if (shouldGenerateEmbedding) {
      if (input.payload.section_key || input.payload.template_key) {
        await this.embeddingService.generateEmbedding(input.clinicId, created.id);
        const [refreshed] = await this.repos.knowledge.findKnowledgeEntry(
          input.clinicId,
          created.id,
        );
        return this.buildManualEntryResponse(refreshed ?? created);
      }

      await this.embeddingService.enqueueEmbeddingJob({
        clinicId: input.clinicId,
        knowledgeEntryId: created.id,
        reason: 'approved',
      });
    }

    return this.buildManualEntryResponse(created);
  }

  async retryEmbedding(input: {
    clinicId: string;
    knowledgeId: string;
    requestedByUserId?: string;
  }) {
    const [row] = await this.repos.knowledge.findKnowledgeEntry(input.clinicId, input.knowledgeId);
    if (!row) {
      throw new AppError('NOT_FOUND', 'Knowledge entry not found.', {
        clinic_id: input.clinicId,
        knowledge_id: input.knowledgeId,
      });
    }

    await this.repos.knowledge.updateKnowledgeEntry(input.clinicId, input.knowledgeId, {
      embeddingStatus: 'pending',
    });

    await this.embeddingService.enqueueEmbeddingJob({
      clinicId: input.clinicId,
      knowledgeEntryId: input.knowledgeId,
      ...(input.requestedByUserId ? { requestedByUserId: input.requestedByUserId } : {}),
      reason: 'manual_retry',
    });

    return { queued: true };
  }

  async regenerateEmbeddings(input: {
    clinicId: string;
    onlyStatus?: 'approved' | 'all';
    requestedByUserId?: string;
  }) {
    return this.embeddingService.bulkRegenerateEmbeddings(input);
  }

  async bulkApproveKnowledgeEntries(input: {
    clinicId: string;
    knowledgeIds: string[];
    actorUserId?: string;
  }) {
    const knowledgeIds = Array.from(new Set(input.knowledgeIds));
    const selectedRows = await this.repos.knowledge.findKnowledgeEntriesByIds(
      input.clinicId,
      knowledgeIds,
    );
    const selectedRowsById = new Map(selectedRows.map((row) => [row.id, row]));
    const skipReasons = new Map<string, BulkKnowledgeApprovalSkipReason>();
    const eligibleRows: KnowledgeEntryRow[] = [];

    for (const knowledgeId of knowledgeIds) {
      const row = selectedRowsById.get(knowledgeId);
      if (!row) {
        skipReasons.set(knowledgeId, 'not_found_or_inaccessible');
      } else if (row.status !== 'pending_review' && row.status !== 'needs_update') {
        skipReasons.set(knowledgeId, 'status_not_reviewable');
      } else if (!row.applicable) {
        skipReasons.set(knowledgeId, 'not_applicable');
      } else if (row.answer.trim().length === 0) {
        skipReasons.set(knowledgeId, 'answer_required');
      } else {
        eligibleRows.push(row);
      }
    }

    for (const row of eligibleRows) {
      this.ensureNonMedicalAnswer(row.answer);
    }

    const approvedRows =
      eligibleRows.length > 0
        ? await this.repos.knowledge.bulkApproveKnowledgeEntries(
            input.clinicId,
            eligibleRows.map((row) => ({ id: row.id, answer: row.answer })),
            input.actorUserId,
          )
        : [];

    const embeddingEnqueueResult = await this.embeddingService.enqueueEmbeddingJobs({
      clinicId: input.clinicId,
      knowledgeEntryIds: approvedRows.map((row) => row.id),
      ...(input.actorUserId ? { requestedByUserId: input.actorUserId } : {}),
      reason: 'approved',
    });
    const embeddingJobsQueued = embeddingEnqueueResult.queuedKnowledgeIds.length;
    const embeddingJobFailedKnowledgeIds = embeddingEnqueueResult.failedKnowledgeIds;

    let embeddingFailureStatePersisted = embeddingJobFailedKnowledgeIds.length === 0;
    if (embeddingJobFailedKnowledgeIds.length > 0) {
      try {
        await this.repos.knowledge.bulkMarkEmbeddingFailed(
          input.clinicId,
          embeddingJobFailedKnowledgeIds,
          'embedding_job_enqueue_failed',
        );
        embeddingFailureStatePersisted = true;
      } catch {
        embeddingFailureStatePersisted = false;
      }
    }

    const approvedKnowledgeIds = approvedRows.map((row) => row.id);
    const approvedKnowledgeIdSet = new Set(approvedKnowledgeIds);
    const skippedKnowledgeIds = knowledgeIds.filter((id) => !approvedKnowledgeIdSet.has(id));
    const skippedEntries = skippedKnowledgeIds.map((knowledgeId) => ({
      knowledge_id: knowledgeId,
      reason: skipReasons.get(knowledgeId) ?? 'changed_during_approval',
    }));

    return {
      requested: knowledgeIds.length,
      approved: approvedRows.length,
      skipped: skippedKnowledgeIds.length,
      knowledge_ids: approvedKnowledgeIds,
      skipped_knowledge_ids: skippedKnowledgeIds,
      skipped_entries: skippedEntries,
      embedding_jobs_queued: embeddingJobsQueued,
      embedding_jobs_failed: embeddingJobFailedKnowledgeIds.length,
      embedding_job_failed_knowledge_ids: embeddingJobFailedKnowledgeIds,
      embedding_failure_state_persisted: embeddingFailureStatePersisted,
    };
  }

  async patchKnowledgeEntry(input: {
    clinicId: string;
    knowledgeId: string;
    patch: PatchKnowledgeEntryInput;
    actorUserId?: string;
  }) {
    const [existing] = await this.repos.knowledge.findKnowledgeEntry(
      input.clinicId,
      input.knowledgeId,
    );
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Knowledge entry not found.', {
        clinic_id: input.clinicId,
        knowledge_id: input.knowledgeId,
      });
    }

    const nextQuestion = input.patch.question ?? existing.question;
    const nextAnswer = input.patch.answer ?? existing.answer;
    const nextCategory = input.patch.category ?? existing.category;
    const forcedQaApproved =
      input.patch.status === 'approved' && input.patch.qa_approved === undefined ? true : undefined;
    const inheritedQaApproved = existing.qaApproved || existing.status === 'approved';
    const nextApplicable = input.patch.applicable ?? existing.applicable ?? true;
    const requestedQaApproved = input.patch.qa_approved ?? forcedQaApproved ?? inheritedQaApproved;
    const nextQaApproved = nextApplicable ? requestedQaApproved : false;
    const nextServiceName = input.patch.service_name ?? existing.serviceName;
    const nextSourceNotes = input.patch.source_notes ?? existing.sourceNotes;
    const nextPhrases =
      input.patch.alternative_phrases_json ??
      (existing.alternativePhrasesJson as string[] | null) ??
      [];
    const nextTemplateKey = input.patch.template_key ?? existing.templateKey;
    const nextSectionKey = input.patch.section_key ?? existing.sectionKey;
    const isManualTemplateEntry = Boolean(nextTemplateKey || nextSectionKey);
    this.ensureNonMedicalAnswer(nextAnswer);
    const requestedStatus =
      input.patch.status ??
      (input.patch.applicable === true && existing.status === 'disabled'
        ? undefined
        : existing.status);
    const nextStatus = this.computeStatus({
      status: requestedStatus,
      applicable: nextApplicable,
      qaApproved: nextQaApproved,
      answer: nextAnswer,
    });

    const contentChanged =
      nextQuestion !== existing.question ||
      nextAnswer !== existing.answer ||
      nextCategory !== existing.category ||
      nextServiceName !== existing.serviceName ||
      nextSourceNotes !== existing.sourceNotes ||
      JSON.stringify(nextPhrases) !== JSON.stringify(existing.alternativePhrasesJson ?? []);

    const updates: Record<string, unknown> = {
      ...(input.patch.question !== undefined ? { question: input.patch.question } : {}),
      ...(input.patch.answer !== undefined ? { answer: input.patch.answer } : {}),
      ...(input.patch.category !== undefined ? { category: input.patch.category } : {}),
      ...(input.patch.template_key !== undefined ? { templateKey: input.patch.template_key } : {}),
      ...(input.patch.section_key !== undefined ? { sectionKey: input.patch.section_key } : {}),
      ...(input.patch.source_notes !== undefined ? { sourceNotes: input.patch.source_notes } : {}),
      ...(input.patch.service_name !== undefined ? { serviceName: input.patch.service_name } : {}),
      ...(input.patch.applicable !== undefined ? { applicable: input.patch.applicable } : {}),
      ...(input.patch.qa_approved !== undefined ||
      forcedQaApproved !== undefined ||
      nextQaApproved !== existing.qaApproved
        ? { qaApproved: nextQaApproved }
        : {}),
      ...(input.patch.alternative_phrases_json !== undefined
        ? { alternativePhrasesJson: input.patch.alternative_phrases_json }
        : {}),
      status: nextStatus,
    };

    const shouldGenerateEmbedding =
      nextStatus === 'approved' && nextApplicable && nextQaApproved && nextAnswer.trim().length > 0;

    if (
      shouldGenerateEmbedding &&
      (contentChanged || nextStatus === 'approved' || existing.searchText === null)
    ) {
      updates.searchText = buildKnowledgeSearchText({
        question: nextQuestion,
        answer: nextAnswer,
        category: nextCategory,
        alternativePhrases: nextPhrases,
      });
    } else if (!shouldGenerateEmbedding) {
      updates.searchText = null;
      updates.embeddingStatus = 'not_required';
      updates.embeddingGeneratedAt = null;
      updates.embeddingModel = null;
      updates.embeddingDimensions = null;
      updates.embeddingError = null;
      updates.embeddingSourceHash = null;
      updates.lastEmbeddingJobId = null;
      updates.approvedAt = null;
      updates.approvedByUserId = null;
    }

    if (shouldGenerateEmbedding) {
      updates.embeddingStatus =
        contentChanged || nextStatus !== existing.status || existing.embeddingStatus !== 'generated'
          ? 'pending'
          : existing.embeddingStatus;

      if (nextStatus === 'approved') {
        updates.approvedAt = new Date();
        if (input.actorUserId) {
          updates.approvedByUserId = input.actorUserId;
        }
      }
    }

    if (nextStatus !== 'approved') {
      updates.approvedAt = null;
      updates.approvedByUserId = null;
    }

    if (input.patch.template_key !== undefined && input.patch.template_key) {
      const [existingByTemplate] = await this.repos.knowledge.findByTemplateKey(
        input.clinicId,
        input.patch.template_key,
      );
      if (existingByTemplate && existingByTemplate.id !== input.knowledgeId) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          'Existing Q&A already exists for this template question.',
        );
      }
    }

    const [updated] = await this.repos.knowledge.updateKnowledgeEntry(
      input.clinicId,
      input.knowledgeId,
      updates,
    );

    if (!updated) {
      throw new AppError('INTERNAL_ERROR', 'Failed to update knowledge entry.');
    }

    if (shouldGenerateEmbedding && updated.embeddingStatus === 'pending') {
      if (isManualTemplateEntry) {
        await this.embeddingService.generateEmbedding(input.clinicId, input.knowledgeId);
        const [refreshed] = await this.repos.knowledge.findKnowledgeEntry(
          input.clinicId,
          input.knowledgeId,
        );
        return this.buildManualEntryResponse(refreshed ?? updated);
      }

      await this.embeddingService.enqueueEmbeddingJob({
        clinicId: input.clinicId,
        knowledgeEntryId: input.knowledgeId,
        ...(input.actorUserId ? { requestedByUserId: input.actorUserId } : {}),
        reason: nextStatus === 'approved' && existing.status !== 'approved' ? 'approved' : 'edited',
      });
    }

    return this.buildManualEntryResponse(updated);
  }
}
