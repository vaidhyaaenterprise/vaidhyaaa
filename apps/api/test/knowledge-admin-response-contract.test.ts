import { describe, expect, it, vi } from 'vitest';

import { KnowledgeAdminService } from '../src/modules/knowledge/knowledge-admin.service';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const KNOWLEDGE_ID = '00000000-0000-0000-0000-000000000501';

function knowledgeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: KNOWLEDGE_ID,
    clinicId: CLINIC_ID,
    question: 'Can I share photos or documents before visit?',
    answer: 'You can share documents through the clinic portal.',
    category: 'communication',
    alternativePhrasesJson: [],
    sourceFileId: null,
    sourceFile: 'Vaidhyaa Clinic Knowledge Base Q&A Template',
    sourcePage: null,
    templateKey: 'communication::Can I share photos or documents before visit?',
    sectionKey: 'communication',
    sourceNotes: 'Do not give diagnosis advice.',
    serviceName: null,
    applicable: true,
    qaApproved: true,
    status: 'needs_update',
    searchText: 'Existing search text',
    embeddingModel: null,
    embeddingDimensions: null,
    embeddingStatus: 'pending',
    embeddingGeneratedAt: null,
    embeddingError: null,
    embeddingSourceHash: null,
    lastEmbeddingJobId: null,
    approvedByUserId: null,
    approvedAt: null,
    createdAt: new Date('2026-09-24T13:39:31.186Z'),
    updatedAt: new Date('2026-09-24T17:46:11.997Z'),
    ...overrides,
  };
}

describe('KnowledgeAdminService response contract', () => {
  it('loads five starter questions per predefined section for a new clinic', async () => {
    const service = Object.create(KnowledgeAdminService.prototype) as KnowledgeAdminService;
    Reflect.set(service, 'repos', { knowledge: {
      listManualTemplateEntries: vi.fn().mockResolvedValue([]),
      listKnowledgeSections: vi.fn().mockResolvedValue([]),
    } });

    const template = await service.listManualTemplate(CLINIC_ID);
    const predefinedSections = template.sections.filter((section) => section.key !== 'custom');
    expect(predefinedSections).toHaveLength(7);
    expect(predefinedSections.map((section) => section.questions.length)).toEqual([5, 5, 5, 5, 5, 5, 5]);
    expect(template.summary.total).toBe(35);
    expect(template.sections.find((section) => section.key === 'custom')?.questions).toEqual([]);
  });

  it('omits unanswered legacy starter rows even with stale approval flags while keeping clinic answers', async () => {
    const service = Object.create(KnowledgeAdminService.prototype) as KnowledgeAdminService;
    const legacyRows = [
      knowledgeRow({ id: 'legacy-blank', templateKey: 'communication::Legacy question', answer: '', qaApproved: true }),
      knowledgeRow({ id: 'legacy-disabled', templateKey: 'communication::Legacy disabled question', answer: '  ', status: 'disabled', applicable: false }),
      knowledgeRow({ id: 'legacy-answered', templateKey: 'communication::Legacy answered question', answer: 'Contact the clinic.' }),
    ];
    Reflect.set(service, 'repos', { knowledge: {
      listManualTemplateEntries: vi.fn().mockResolvedValue(legacyRows),
      listKnowledgeSections: vi.fn().mockResolvedValue([]),
    } });

    const template = await service.listManualTemplate(CLINIC_ID);
    const questions = template.sections.find((section) => section.key === 'communication')!.questions;
    expect(questions).toHaveLength(6);
    expect(questions.map((question) => question.id)).not.toContain('legacy-blank');
    expect(questions.map((question) => question.id)).not.toContain('legacy-disabled');
    expect(questions.map((question) => question.id)).toContain('legacy-answered');
  });

  it('rejects removal of an approved question until it is disabled', async () => {
    const findKnowledgeEntry = vi
      .fn()
      .mockResolvedValue([
        knowledgeRow({ status: 'approved', qaApproved: true, applicable: true }),
      ]);
    const removeKnowledgeEntry = vi.fn();
    const service = Object.create(KnowledgeAdminService.prototype) as KnowledgeAdminService;
    Reflect.set(service, 'repos', {
      knowledge: { findKnowledgeEntry, removeKnowledgeEntry },
    });

    await expect(
      service.removeManualQuestion({ clinicId: CLINIC_ID, knowledgeId: KNOWLEDGE_ID }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Approved questions must be disabled before they can be removed.',
    });
    expect(removeKnowledgeEntry).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'disabled', qaApproved: false, applicable: false },
    { status: 'disabled', qaApproved: true, applicable: false },
    { status: 'approved', qaApproved: true, applicable: false },
    { status: 'needs_update', qaApproved: true, applicable: true },
  ])('removes an unapproved question despite legacy flags: %j', async (state) => {
    const findKnowledgeEntry = vi
      .fn()
      .mockResolvedValue([
        knowledgeRow(state),
      ]);
    const removeKnowledgeEntry = vi.fn().mockResolvedValue([knowledgeRow()]);
    const service = Object.create(KnowledgeAdminService.prototype) as KnowledgeAdminService;
    Reflect.set(service, 'repos', {
      knowledge: { findKnowledgeEntry, removeKnowledgeEntry },
    });

    await expect(
      service.removeManualQuestion({ clinicId: CLINIC_ID, knowledgeId: KNOWLEDGE_ID }),
    ).resolves.toEqual({ removed: true, knowledge_id: KNOWLEDGE_ID });
    expect(removeKnowledgeEntry).toHaveBeenCalledWith(CLINIC_ID, KNOWLEDGE_ID);
  });

  it('rejects section removal while it contains an approved question', async () => {
    const archiveKnowledgeSection = vi.fn();
    const service = Object.create(KnowledgeAdminService.prototype) as KnowledgeAdminService;
    Reflect.set(service, 'repos', {
      knowledge: {
        listKnowledgeSections: vi.fn().mockResolvedValue([]),
        listVisibleSectionEntries: vi
          .fn()
          .mockResolvedValue([knowledgeRow({ status: 'approved', qaApproved: true })]),
        archiveKnowledgeSection,
      },
    });

    await expect(
      service.removeManualSection({ clinicId: CLINIC_ID, sectionKey: 'communication' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message:
        'This section contains approved questions. Disable them before removing the section.',
    });
    expect(archiveKnowledgeSection).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'disabled', qaApproved: false, applicable: false },
    { status: 'disabled', qaApproved: true, applicable: false },
    { status: 'approved', qaApproved: true, applicable: false },
    { status: 'needs_update', qaApproved: true, applicable: true },
    { status: 'approved', qaApproved: true, applicable: true, answer: '   ' },
  ])('archives a section with no effective approvals: %j', async (state) => {
    const archiveKnowledgeSection = vi.fn().mockResolvedValue({
      blocked: false,
      section: { sectionKey: 'communication' },
    });
    const service = Object.create(KnowledgeAdminService.prototype) as KnowledgeAdminService;
    Reflect.set(service, 'repos', {
      knowledge: {
        listKnowledgeSections: vi.fn().mockResolvedValue([]),
        listVisibleSectionEntries: vi
          .fn()
          .mockResolvedValue([knowledgeRow(state)]),
        archiveKnowledgeSection,
      },
    });

    await expect(
      service.removeManualSection({ clinicId: CLINIC_ID, sectionKey: 'communication' }),
    ).resolves.toEqual({ removed: true, section_key: 'communication' });
    expect(archiveKnowledgeSection).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: CLINIC_ID,
        sectionKey: 'communication',
        active: false,
      }),
    );
  });

  it('returns the same snake_case shape after patching a manual-template entry', async () => {
    const existing = knowledgeRow({ status: 'approved' });
    const updated = knowledgeRow({
      answer: 'Yes, you can share photos before the visit.',
      status: 'approved',
      embeddingStatus: 'pending',
    });
    const refreshed = knowledgeRow({
      answer: 'Yes, you can share photos before the visit.',
      status: 'approved',
      embeddingStatus: 'failed',
      embeddingError: 'expected 1024 dimensions, received 768',
    });
    const findKnowledgeEntry = vi
      .fn()
      .mockResolvedValueOnce([existing])
      .mockResolvedValueOnce([refreshed]);
    const updateKnowledgeEntry = vi.fn().mockResolvedValue([updated]);
    const generateEmbedding = vi.fn().mockResolvedValue({ status: 'failed' });

    const service = Object.create(KnowledgeAdminService.prototype) as KnowledgeAdminService;
    Reflect.set(service, 'repos', {
      knowledge: {
        findKnowledgeEntry,
        updateKnowledgeEntry,
      },
    });
    Reflect.set(service, 'embeddingService', { generateEmbedding });

    const result = await service.patchKnowledgeEntry({
      clinicId: CLINIC_ID,
      knowledgeId: KNOWLEDGE_ID,
      patch: { answer: 'Yes, you can share photos before the visit.' },
    });

    expect(generateEmbedding).toHaveBeenCalledWith(CLINIC_ID, KNOWLEDGE_ID);
    expect(result).toMatchObject({
      id: KNOWLEDGE_ID,
      clinic_id: CLINIC_ID,
      alternative_phrases_json: [],
      source_file_id: null,
      template_key: 'communication::Can I share photos or documents before visit?',
      section_key: 'communication',
      source_notes: 'Do not give diagnosis advice.',
      qa_approved: true,
      embedding_status: 'failed',
      embedding_error: 'expected 1024 dimensions, received 768',
    });
    expect(result).not.toHaveProperty('alternativePhrasesJson');
    expect(result).not.toHaveProperty('clinicId');
  });

  it('reactivates a disabled manual-template entry when applicable is enabled', async () => {
    const existing = knowledgeRow({
      applicable: false,
      qaApproved: false,
      status: 'disabled',
      embeddingStatus: 'not_required',
      approvedAt: null,
    });
    const updated = knowledgeRow({
      applicable: true,
      qaApproved: false,
      status: 'pending_review',
      embeddingStatus: 'not_required',
    });
    const findKnowledgeEntry = vi.fn().mockResolvedValueOnce([existing]);
    const updateKnowledgeEntry = vi.fn().mockResolvedValue([updated]);
    const generateEmbedding = vi.fn().mockResolvedValue({ status: 'generated' });

    const service = Object.create(KnowledgeAdminService.prototype) as KnowledgeAdminService;
    Reflect.set(service, 'repos', {
      knowledge: {
        findKnowledgeEntry,
        updateKnowledgeEntry,
      },
    });
    Reflect.set(service, 'embeddingService', { generateEmbedding });

    const result = await service.patchKnowledgeEntry({
      clinicId: CLINIC_ID,
      knowledgeId: KNOWLEDGE_ID,
      patch: { applicable: true },
    });

    expect(updateKnowledgeEntry).toHaveBeenCalledWith(
      CLINIC_ID,
      KNOWLEDGE_ID,
      expect.objectContaining({
        applicable: true,
        status: 'pending_review',
      }),
    );
    expect(result).toMatchObject({
      applicable: true,
      status: 'pending_review',
      embedding_status: 'not_required',
    });
    expect(generateEmbedding).not.toHaveBeenCalled();
  });

  it('clears approval and embeddings when an approved entry is made inactive', async () => {
    const existing = knowledgeRow({
      status: 'approved',
      applicable: true,
      qaApproved: true,
      embeddingStatus: 'generated',
      approvedAt: new Date('2026-10-08T10:00:00.000Z'),
    });
    const updated = knowledgeRow({
      answer: 'Updated while inactive.',
      status: 'disabled',
      applicable: false,
      qaApproved: false,
      searchText: null,
      embeddingStatus: 'not_required',
      approvedAt: null,
    });
    const findKnowledgeEntry = vi.fn().mockResolvedValueOnce([existing]);
    const updateKnowledgeEntry = vi.fn().mockResolvedValue([updated]);
    const generateEmbedding = vi.fn();

    const service = Object.create(KnowledgeAdminService.prototype) as KnowledgeAdminService;
    Reflect.set(service, 'repos', {
      knowledge: {
        findKnowledgeEntry,
        updateKnowledgeEntry,
      },
    });
    Reflect.set(service, 'embeddingService', { generateEmbedding });

    const result = await service.patchKnowledgeEntry({
      clinicId: CLINIC_ID,
      knowledgeId: KNOWLEDGE_ID,
      patch: {
        answer: 'Updated while inactive.',
        applicable: false,
        status: 'disabled',
      },
    });

    expect(updateKnowledgeEntry).toHaveBeenCalledWith(
      CLINIC_ID,
      KNOWLEDGE_ID,
      expect.objectContaining({
        answer: 'Updated while inactive.',
        applicable: false,
        qaApproved: false,
        status: 'disabled',
        searchText: null,
        embeddingStatus: 'not_required',
        approvedAt: null,
      }),
    );
    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      applicable: false,
      qa_approved: false,
      status: 'disabled',
      embedding_status: 'not_required',
      approved_at: null,
    });
  });
});
