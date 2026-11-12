import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';

import { SlotGenerationService } from './slot-generation.service';
import { SlotHoldExpiryService } from './slot-hold-expiry.service';
import { SlotHoldService } from './slot-hold.service';
import { SlotJobsRegistrar } from './slot-jobs.registrar';
import { ScheduleChangeImpactService } from './schedule-change-impact.service';
import { SlotRuleChangeImpactService } from './slot-rule-change-impact.service';
import { SlotService } from './slot.service';
import { SlotReconciliationService } from './slot-reconciliation.service';
import { SlotReconciliationController } from './slot-reconciliation.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [SlotReconciliationController],
  providers: [
    SlotReconciliationService,
    SlotService,
    SlotHoldService,
    SlotGenerationService,
    SlotRuleChangeImpactService,
    ScheduleChangeImpactService,
    SlotHoldExpiryService,
    SlotJobsRegistrar,
  ],
  exports: [
    SlotReconciliationService,
    SlotService,
    SlotHoldService,
    SlotGenerationService,
    SlotRuleChangeImpactService,
    ScheduleChangeImpactService,
    SlotHoldExpiryService,
  ],
})
export class SlotsModule {}
