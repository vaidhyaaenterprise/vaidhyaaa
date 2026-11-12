import { Controller, Get, Headers, Inject } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { AppError } from '@vaidya/shared';
import { Public } from '../../common/decorators/public.decorator';
import { CallRetentionService } from './call-retention.service';

@Controller('internal/jobs/call-retention')
export class CallRetentionController {
  constructor(@Inject(CallRetentionService) private readonly retention: CallRetentionService) {}

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
    return this.retention.cleanup();
  }
}
