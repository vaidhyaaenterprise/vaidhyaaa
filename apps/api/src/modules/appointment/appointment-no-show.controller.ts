import { Controller, Get, Headers, Inject } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { AppError } from '@vaidya/shared';

import { Public } from '../../common/decorators/public.decorator';
import { AppointmentNoShowService } from './appointment-no-show.service';

@Controller('internal/jobs/appointment-no-shows')
export class AppointmentNoShowController {
  constructor(
    @Inject(AppointmentNoShowService) private readonly noShows: AppointmentNoShowService,
  ) {}

  @Get()
  @Public()
  run(@Headers('authorization') authorization?: string) {
    const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : '';
    if (
      !expected ||
      !authorization ||
      Buffer.byteLength(authorization) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(authorization), Buffer.from(expected))
    ) {
      throw new AppError('UNAUTHORIZED', 'A valid cron secret is required.');
    }
    return this.noShows.reconcile();
  }
}
