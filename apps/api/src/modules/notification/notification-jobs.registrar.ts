import { Inject, Injectable, OnModuleInit } from '@nestjs/common';

import { ADAPTER_TOKENS, JOB_TYPES, type JobRegistry } from '@vaidya/shared';

import {
  DailyClinicReportStubService,
  KnowledgeDocxParserService,
} from './background-job-handlers.service';
import { KnowledgeEmbeddingService } from '../knowledge/knowledge-embedding.service';
import { NotificationDeliveryService } from './notification-delivery.service';
import { RecordingCleanupService } from './recording-cleanup.service';
import { TranscriptCleanupService } from './transcript-cleanup.service';

@Injectable()
export class NotificationJobsRegistrar implements OnModuleInit {
  constructor(
    @Inject(ADAPTER_TOKENS.JobRegistry) private readonly registry: JobRegistry,
    @Inject(NotificationDeliveryService)
    private readonly notificationDelivery: NotificationDeliveryService,
    @Inject(RecordingCleanupService) private readonly recordingCleanup: RecordingCleanupService,
    @Inject(TranscriptCleanupService) private readonly transcriptCleanup: TranscriptCleanupService,
    @Inject(KnowledgeDocxParserService) private readonly knowledgeDocxParser: KnowledgeDocxParserService,
    @Inject(KnowledgeEmbeddingService)
    private readonly knowledgeEmbeddingService: KnowledgeEmbeddingService,
    @Inject(DailyClinicReportStubService)
    private readonly dailyClinicReportStub: DailyClinicReportStubService,
  ) {}

  onModuleInit(): void {
    this.registry.register(JOB_TYPES.SEND_NOTIFICATION, async (payload) => {
      const clinicId = String(payload.clinic_id);
      const notificationEventId = String(payload.notification_event_id);
      const result = await this.notificationDelivery.deliverNotificationEvent(
        clinicId,
        notificationEventId,
      );
      if (result?.status === 'pending') {
        throw new Error(result.lastError ?? 'notification_delivery_retry');
      }
    });

    this.registry.register(JOB_TYPES.CLEANUP_EXPIRED_RECORDINGS, async (payload) => {
      await this.recordingCleanup.cleanupExpiredRecordings({
        ...(typeof payload.clinic_id === 'string' ? { clinicId: payload.clinic_id } : {}),
      });
    });

    this.registry.register(JOB_TYPES.CLEANUP_EXPIRED_TRANSCRIPTS, async (payload) => {
      await this.transcriptCleanup.cleanupExpiredTranscripts({
        ...(typeof payload.clinic_id === 'string' ? { clinicId: payload.clinic_id } : {}),
        ...(typeof payload.retention_days === 'number'
          ? { retentionDays: payload.retention_days }
          : {}),
      });
    });

    this.registry.register(JOB_TYPES.PARSE_KNOWLEDGE_DOCX, async (payload) => {
      await this.knowledgeDocxParser.parseKnowledgeDocx(
        String(payload.clinic_id),
        String(payload.knowledge_file_id),
      );
    });

    this.registry.register(JOB_TYPES.GENERATE_KNOWLEDGE_EMBEDDING, async (payload) => {
      await this.knowledgeEmbeddingService.generateEmbedding(
        String(payload.clinic_id),
        String(payload.knowledge_entry_id),
      );
    });

    this.registry.register(JOB_TYPES.GENERATE_DAILY_CLINIC_REPORT, async (payload) => {
      await this.dailyClinicReportStub.generateReport(
        String(payload.clinic_id),
        String(payload.report_date),
      );
    });
  }
}
