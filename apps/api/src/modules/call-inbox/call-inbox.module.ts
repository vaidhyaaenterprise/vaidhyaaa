import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { AdaptersModule } from '../../common/adapters/adapters.module';
import { JobInfrastructureModule } from '../../common/jobs/job-infrastructure.module';

import { CallInboxController } from './call-inbox.controller';
import { CallInboxService } from './call-inbox.service';
import { CallRetentionService } from './call-retention.service';
import { CallRetentionController } from './call-retention.controller';

@Module({
  imports: [DatabaseModule, AdaptersModule, JobInfrastructureModule],
  controllers: [CallInboxController, CallRetentionController],
  providers: [CallInboxService, CallRetentionService],
  exports: [CallInboxService],
})
export class CallInboxModule {}
