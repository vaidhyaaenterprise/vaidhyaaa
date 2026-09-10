import { Inject, Injectable, OnModuleInit } from '@nestjs/common';

import { ADAPTER_TOKENS, JOB_TYPES, type JobRegistry } from '@vaidya/shared';

import { SlotGenerationService } from './slot-generation.service';
import { SlotHoldExpiryService } from './slot-hold-expiry.service';

@Injectable()
export class SlotJobsRegistrar implements OnModuleInit {
  constructor(
    @Inject(ADAPTER_TOKENS.JobRegistry) private readonly registry: JobRegistry,
    @Inject(SlotGenerationService) private readonly slotGenerationService: SlotGenerationService,
    @Inject(SlotHoldExpiryService) private readonly slotHoldExpiryService: SlotHoldExpiryService,
  ) {}

  onModuleInit(): void {
    this.registry.register(JOB_TYPES.GENERATE_SLOTS, async (payload) => {
      const input: Parameters<SlotGenerationService['generateSlots']>[0] = {};
      if (typeof payload.clinic_id === 'string') {
        input.clinicId = payload.clinic_id;
      }
      if (typeof payload.doctor_id === 'string') {
        input.doctorId = payload.doctor_id;
      }
      if (typeof payload.clinic_service_id === 'string') {
        input.clinicServiceId = payload.clinic_service_id;
      }
      if (typeof payload.horizon_days === 'number') {
        input.horizonDays = payload.horizon_days;
      }
      await this.slotGenerationService.generateSlots(input);
    });

    this.registry.register(JOB_TYPES.EXPIRE_SLOT_HOLDS, async (payload) => {
      const input: Parameters<SlotHoldExpiryService['expireSlotHolds']>[0] = {};
      if (typeof payload.clinic_id === 'string') {
        input.clinicId = payload.clinic_id;
      }
      if (typeof payload.batch_limit === 'number') {
        input.batchLimit = payload.batch_limit;
      }
      await this.slotHoldExpiryService.expireSlotHolds(input);
    });
  }
}
