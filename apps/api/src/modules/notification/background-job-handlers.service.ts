import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';
import {
  ADAPTER_TOKENS,
  JOB_QUEUE_MAP,
  JOB_TYPES,
  type QueueService,
} from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';

const DOCX_STUB_ENTRIES = [
  {
    question: 'Parking irukka?',
    answer: 'Yes, basement parking is available.',
    category: 'pre_visit_instruction',
    alternativePhrases: ['parking available'],
  },
  {
    question: 'Sunday open-a?',
    answer: 'Sunday clinic is closed.',
    category: 'timing',
    alternativePhrases: ['sunday timing'],
  },
];

@Injectable()
export class KnowledgeDocxParserService {
  private readonly repos: Repositories;

  constructor(@Inject(DATABASE_CONNECTION) connection: DatabaseConnection) {
    this.repos = createRepositories(connection.db);
  }

  async parseKnowledgeDocx(clinicId: string, knowledgeFileId: string) {
    const [file] = await this.repos.platformOps.findKnowledgeFile(clinicId, knowledgeFileId);
    if (!file) {
      return { inserted: 0 };
    }

    const inserted = await this.repos.platformOps.insertKnowledgeEntries(
      DOCX_STUB_ENTRIES.map((entry) => ({
        clinicId,
        question: entry.question,
        answer: entry.answer,
        category: entry.category,
        alternativePhrasesJson: entry.alternativePhrases,
        status: 'pending_review',
        searchText: `${entry.question} ${entry.answer}`.toLowerCase(),
        sourceFileId: knowledgeFileId,
      })),
    );

    await this.repos.platformOps.updateKnowledgeFileStatus(clinicId, knowledgeFileId, 'processed');

    return { inserted: inserted.length };
  }
}

@Injectable()
export class DailyClinicReportStubService {
  async generateReport(_clinicId: string, _reportDate: string) {
    return { status: 'stub_generated' };
  }
}

@Injectable()
export class KnowledgeUploadService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(ADAPTER_TOKENS.QueueService) private readonly queueService: QueueService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async uploadKnowledgeDocx(input: {
    clinicId: string;
    fileName: string;
    uploadedByUserId?: string;
  }) {
    const [file] = await this.repos.platformOps.insertKnowledgeFile({
      clinicId: input.clinicId,
      fileName: input.fileName,
      fileType: 'docx',
      status: 'uploaded',
      ...(input.uploadedByUserId ? { uploadedByUserId: input.uploadedByUserId } : {}),
    });

    await this.queueService.enqueue({
      queue: JOB_QUEUE_MAP[JOB_TYPES.PARSE_KNOWLEDGE_DOCX],
      jobType: JOB_TYPES.PARSE_KNOWLEDGE_DOCX,
      clinicId: input.clinicId,
      payload: {
        clinic_id: input.clinicId,
        knowledge_file_id: file!.id,
      },
    });

    return file!;
  }

  async enqueueEmbeddingJob(clinicId: string, knowledgeEntryId: string) {
    await this.queueService.enqueue({
      queue: JOB_QUEUE_MAP[JOB_TYPES.GENERATE_KNOWLEDGE_EMBEDDING],
      jobType: JOB_TYPES.GENERATE_KNOWLEDGE_EMBEDDING,
      clinicId,
      payload: {
        clinic_id: clinicId,
        knowledge_entry_id: knowledgeEntryId,
      },
    });
  }
}
