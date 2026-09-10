import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';

import { SlotGenerationService } from './slot-generation.service';
import { SlotHoldExpiryService } from './slot-hold-expiry.service';
import { SlotHoldService } from './slot-hold.service';
import { SlotJobsRegistrar } from './slot-jobs.registrar';
import { ScheduleChangeImpactService } from './schedule-change-impact.service';
import { SlotRuleChangeImpactService } from './slot-rule-change-impact.service';
import { SlotService } from './slot.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    SlotService,
    SlotHoldService,
    SlotGenerationService,
    SlotRuleChangeImpactService,
    ScheduleChangeImpactService,
    SlotHoldExpiryService,
    SlotJobsRegistrar,
  ],
  exports: [
    SlotService,
    SlotHoldService,
    SlotGenerationService,
    SlotRuleChangeImpactService,
    ScheduleChangeImpactService,
    SlotHoldExpiryService,
  ],
})
export class SlotsModule {}
