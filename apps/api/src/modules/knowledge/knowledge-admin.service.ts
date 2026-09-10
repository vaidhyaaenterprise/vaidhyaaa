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

type ManualTemplateQuestionResponse = ReturnType<KnowledgeAdminService['buildManualEntryResponse']> & {
  exists: boolean;
  service_name_required: boolean;
  ui_status: TemplateUiStatus;
};

type ManualTemplateSectionResponse = {
  key: string;
  title: string;
  questions: ManualTemplateQuestionResponse[];
};

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
    return rows.map((row) => ({
      id: row.id,
      clinic_id: row.clinicId,
      question: row.question,
      answer: row.answer,
      category: row.category,
      alternative_phrases_json: (row.alternativePhrasesJson as string[] | null) ?? [],
      template_key: row.templateKey,
      section_key: row.sectionKey,
      source_notes: row.sourceNotes,
      service_name: row.serviceName,
      applicable: row.applicable,
      qa_approved: row.qaApproved,
      status: row.status,
      embedding_status: row.embeddingStatus,
      embedding_model: row.embeddingModel,
      embedding_generated_at: row.embeddingGeneratedAt,
      search_text: row.searchText,
      source_file: row.sourceFile,
      source_page: row.sourcePage,
      approved_at: row.approvedAt,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }));
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
      template_key: row.templateKey,
      section_key: row.sectionKey,
      source_notes: row.sourceNotes,
      service_name: row.serviceName,
      applicable: row.applicable,
      qa_approved: row.qaApproved,
      status: row.status,
      embedding_status: row.embeddingStatus,
      embedding_model: row.embeddingModel,
      embedding_generated_at: row.embeddingGeneratedAt,
      search_text: row.searchText,
      source_file: row.sourceFile,
      source_page: row.sourcePage,
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
    const existingRows = await this.repos.knowledge.listManualTemplateEntries(clinicId);
    const byTemplateKey = new Map(
      existingRows
        .filter((row) => row.templateKey)
        .map((row) => [row.templateKey!, row]),
    );

    const sections = new Map<string, ManualTemplateSectionResponse>();
    const now = new Date();

    for (const preset of VAIDYA_MANUAL_QA_TEMPLATE) {
      const templateKey = `${preset.sectionKey}::${preset.question}`;
      const existing = byTemplateKey.get(templateKey);
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
              template_key: templateKey,
              section_key: preset.sectionKey,
              source_notes: preset.sourceNotes ?? null,
              service_name: null,
              applicable: true,
              qa_approved: false,
              status: 'needs_update',
              embedding_status: 'not_required',
              embedding_model: null,
              embedding_generated_at: null,
              search_text: null,
              source_file: VAIDYA_MANUAL_TEMPLATE_SOURCE,
              source_page: null,
              approved_at: null,
              created_at: now,
              updated_at: now,
            },
        exists: Boolean(existing),
        serviceNameRequired: Boolean(preset.serviceNameRequired),
      });

      const key = preset.sectionKey;
      if (!sections.has(key)) {
        sections.set(key, {
          key,
          title: preset.sectionTitle,
          questions: [],
        });
      }

      sections.get(key)!.questions.push(row);
    }

    const customRows = existingRows.filter((row) => row.sectionKey === 'custom');
    if (customRows.length > 0) {
      sections.set('custom', {
        key: 'custom',
        title: 'Custom Q&A',
        questions: customRows.map((row) =>
          this.toTemplateQuestionResponse({
            row: this.buildManualEntryResponse(row),
            exists: true,
            serviceNameRequired: false,
          }),
        ),
      });
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

  async importManualTemplate(input: {
    clinicId: string;
  }) {
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

  async createManualEntry(input: {
    clinicId: string;
    payload: CreateKnowledgeEntryInput;
  }) {
    const applicable = input.payload.applicable ?? true;
    const forcedQaApproved =
      input.payload.status === 'approved' && input.payload.qa_approved === undefined ? true : undefined;
    const qaApproved = input.payload.qa_approved ?? forcedQaApproved ?? false;
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

    const isManualTemplateEntry = Boolean(input.payload.section_key || input.payload.template_key);
    const shouldGenerateEmbedding =
      isManualTemplateEntry ||
      (status === 'approved' && applicable && qaApproved && input.payload.answer.trim().length > 0);

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
      if (isManualTemplateEntry) {
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

  async patchKnowledgeEntry(input: {
    clinicId: string;
    knowledgeId: string;
    patch: PatchKnowledgeEntryInput;
    actorUserId?: string;
  }) {
    const [existing] = await this.repos.knowledge.findKnowledgeEntry(input.clinicId, input.knowledgeId);
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
    const nextApplicable =
      input.patch.applicable ?? existing.applicable ?? true;
    const nextQaApproved =
      input.patch.qa_approved ?? forcedQaApproved ?? inheritedQaApproved;
    const nextServiceName =
      input.patch.service_name ?? existing.serviceName;
    const nextSourceNotes =
      input.patch.source_notes ?? existing.sourceNotes;
    const nextPhrases =
      input.patch.alternative_phrases_json ??
      ((existing.alternativePhrasesJson as string[] | null) ?? []);
    const nextTemplateKey = input.patch.template_key ?? existing.templateKey;
    const nextSectionKey = input.patch.section_key ?? existing.sectionKey;
    const isManualTemplateEntry = Boolean(nextTemplateKey || nextSectionKey);
    this.ensureNonMedicalAnswer(nextAnswer);
    const nextStatus = this.computeStatus({
      status: input.patch.status ?? existing.status,
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
      ...(input.patch.qa_approved !== undefined
        ? { qaApproved: input.patch.qa_approved }
        : forcedQaApproved !== undefined
          ? { qaApproved: forcedQaApproved }
          : !existing.qaApproved && nextQaApproved
            ? { qaApproved: true }
          : {}),
      ...(input.patch.alternative_phrases_json !== undefined
        ? { alternativePhrasesJson: input.patch.alternative_phrases_json }
        : {}),
      status: nextStatus,
    };

    const shouldGenerateEmbedding =
      isManualTemplateEntry ||
      (nextStatus === 'approved' &&
        nextApplicable &&
        nextQaApproved &&
        nextAnswer.trim().length > 0);

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

    if (shouldGenerateEmbedding && updated && updated.embeddingStatus === 'pending') {
      if (isManualTemplateEntry) {
        await this.embeddingService.generateEmbedding(input.clinicId, input.knowledgeId);
        const [refreshed] = await this.repos.knowledge.findKnowledgeEntry(
          input.clinicId,
          input.knowledgeId,
        );
        return refreshed ?? updated;
      }

      await this.embeddingService.enqueueEmbeddingJob({
        clinicId: input.clinicId,
        knowledgeEntryId: input.knowledgeId,
        ...(input.actorUserId ? { requestedByUserId: input.actorUserId } : {}),
        reason: nextStatus === 'approved' && existing.status !== 'approved' ? 'approved' : 'edited',
      });
    }

    return updated;
  }
}
