import { Body, Controller, Get, Inject, Param, Put } from '@nestjs/common';

import {
  AppError,
  replaceClinicLanguagesSchema,
} from '@vaidya/shared';

import { ClinicAdmin } from '../../common/decorators/platform-admin.decorator';
import { ClinicScoped } from '../../common/decorators/clinic-scoped.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

import { ClinicSubscriptionService } from './clinic-subscription.service';

@Controller('clinics/:clinicId')
@ClinicScoped()
export class ClinicSubscriptionController {
  constructor(
    @Inject(ClinicSubscriptionService)
    private readonly subscriptionService: ClinicSubscriptionService,
  ) {}

  @Get('subscription')
  @Roles('clinic_admin', 'doctor')
  async getSubscription(@Param('clinicId') clinicId: string) {
    const subscription = await this.subscriptionService.getSubscription(clinicId);
    return { subscription };
  }

  @Get('usage/current-month')
  @Roles('clinic_admin', 'doctor')
  async getCurrentMonthUsage(@Param('clinicId') clinicId: string) {
    const usage = await this.subscriptionService.getCurrentMonthUsage(clinicId);
    return { usage };
  }

  @Get('languages')
  @Roles('clinic_admin', 'doctor')
  async getClinicLanguages(@Param('clinicId') clinicId: string) {
    const languages = await this.subscriptionService.getClinicLanguages(clinicId);
    return { languages };
  }

  @Put('languages')
  @ClinicAdmin()
  async replaceClinicLanguages(
    @Param('clinicId') clinicId: string,
    @Body() body: unknown,
  ) {
    const parsed = replaceClinicLanguagesSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid clinic languages payload.');
    }
    const languages = await this.subscriptionService.replaceClinicLanguages(clinicId, parsed.data);
    return { languages };
  }
}

@Controller('languages')
export class SupportedLanguagesController {
  constructor(
    @Inject(ClinicSubscriptionService)
    private readonly subscriptionService: ClinicSubscriptionService,
  ) {}

  @Get()
  async listSupportedLanguages() {
    const languages = await this.subscriptionService.listSupportedLanguages();
    return { languages };
  }
}
