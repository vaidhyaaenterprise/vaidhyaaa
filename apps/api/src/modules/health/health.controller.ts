import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { FastifyReply } from 'fastify';

import { Public } from '../../common/decorators/public.decorator';

import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Public()
  @Get()
  getHealth() {
    return {
      status: 'ok',
      service: 'vaidya-api',
    };
  }

  @Public()
  @Get('infra')
  async getInfraHealth(@Res({ passthrough: true }) response: FastifyReply) {
    const status = await this.healthService.getInfraStatus();
    const healthy = status.database === 'ok' && status.redis_connected !== false;

    if (!healthy) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return status;
  }
}
