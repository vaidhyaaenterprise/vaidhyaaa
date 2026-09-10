import { Controller, Get, Inject } from '@nestjs/common';

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
  async getInfraHealth() {
    return this.healthService.getInfraStatus();
  }
}
