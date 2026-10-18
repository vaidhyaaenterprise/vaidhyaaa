import { Controller, Get, Headers, Inject, Param, Post } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { AppError } from '@vaidya/shared';
import { ClinicScoped } from '../../common/decorators/clinic-scoped.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SlotReconciliationService } from './slot-reconciliation.service';

@Controller()
export class SlotReconciliationController {
  constructor(
    @Inject(SlotReconciliationService) private readonly jobs: SlotReconciliationService,
  ) {}

  @Post('clinics/:clinicId/slot-reconciliation/run')
  @ClinicScoped()
  @Roles('clinic_admin', 'doctor')
  async runClinic(@Param('clinicId') clinicId: string) {
    const processed = await this.jobs.drain(clinicId);
    return { processed, remaining: await this.jobs.pendingCount(clinicId) };
  }

  @Get('internal/jobs/slot-reconciliation')
  @Public()
  async recover(@Headers('authorization') authorization?: string) {
    const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : '';
    if (
      !expected ||
      !authorization ||
      Buffer.byteLength(authorization) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(authorization), Buffer.from(expected))
    ) {
      throw new AppError('UNAUTHORIZED', 'A valid cron secret is required.');
    }
    return { processed: await this.jobs.drain() };
  }
}
