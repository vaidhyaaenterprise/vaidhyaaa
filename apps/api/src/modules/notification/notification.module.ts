import { Module, forwardRef } from '@nestjs/common';

import { AdaptersModule } from '../../common/adapters/adapters.module';
import { JobInfrastructureModule } from '../../common/jobs/job-infrastructure.module';
import { DatabaseModule } from '../database/database.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';

import {
  DailyClinicReportStubService,
  KnowledgeDocxParserService,
  KnowledgeUploadService,
} from './background-job-handlers.service';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationJobsRegistrar } from './notification-jobs.registrar';
import { NotificationOutboxService } from './notification-outbox.service';
import { RecordingCleanupService } from './recording-cleanup.service';
import { TranscriptCleanupService } from './transcript-cleanup.service';

@Module({
  imports: [DatabaseModule, AdaptersModule, JobInfrastructureModule, forwardRef(() => KnowledgeModule)],
  providers: [
    NotificationOutboxService,
    NotificationDeliveryService,
    RecordingCleanupService,
    TranscriptCleanupService,
    KnowledgeDocxParserService,
    KnowledgeUploadService,
    DailyClinicReportStubService,
    NotificationJobsRegistrar,
  ],
  exports: [
    NotificationOutboxService,
    NotificationDeliveryService,
    NotificationJobsRegistrar,
    KnowledgeUploadService,
  ],
})
export class NotificationModule {}
