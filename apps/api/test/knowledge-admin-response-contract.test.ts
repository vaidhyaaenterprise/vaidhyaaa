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
    sourceFile: 'Vaidya Clinic Knowledge Base Q&A Template',
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
  it('returns the same snake_case shape after patching a manual-template entry', async () => {
    const existing = knowledgeRow();
    const updated = knowledgeRow({
      answer: 'Yes, you can share photos before the visit.',
      embeddingStatus: 'pending',
    });
    const refreshed = knowledgeRow({
      answer: 'Yes, you can share photos before the visit.',
      embeddingStatus: 'failed',
      embeddingError: 'expected 768 dimensions, not 1024',
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
      embedding_error: 'expected 768 dimensions, not 1024',
    });
    expect(result).not.toHaveProperty('alternativePhrasesJson');
    expect(result).not.toHaveProperty('clinicId');
  });
});
