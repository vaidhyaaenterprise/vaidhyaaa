import { Module } from '@nestjs/common';

import { JobInfrastructureModule } from '../../common/jobs/job-infrastructure.module';
import { DatabaseModule } from '../database/database.module';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [DatabaseModule, JobInfrastructureModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
