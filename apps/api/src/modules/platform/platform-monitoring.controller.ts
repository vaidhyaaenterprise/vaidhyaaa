import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';

import { AppError, platformSubscriptionChangeSchema } from '@vaidya/shared';

import { PlatformAdmin } from '../../common/decorators/platform-admin.decorator';

import { ClinicClinicalService } from '../clinic-setup/clinic-clinical.service';
import { ClinicSubscriptionService } from '../clinic-setup/clinic-subscription.service';
import { NotificationAdminService } from '../notification/notification-admin.service';

@Controller('internal/platform')
export class PlatformMonitoringController {
  constructor(
    @Inject(ClinicClinicalService) private readonly clinicalService: ClinicClinicalService,
    @Inject(NotificationAdminService)
    private readonly notificationAdminService: NotificationAdminService,
    @Inject(ClinicSubscriptionService)
    private readonly subscriptionService: ClinicSubscriptionService,
  ) {}

  @Get('notifications')
  @PlatformAdmin()
  async listNotifications() {
    const notifications = await this.clinicalService.listPlatformNotifications();
    return { notifications };
  }

  @Post('notifications/:notificationId/retry')
  @PlatformAdmin()
  async retryNotification(@Param('notificationId') notificationId: string) {
    return this.notificationAdminService.retryNotification(notificationId);
  }

  @Post('notifications/:notificationId/cancel')
  @PlatformAdmin()
  async cancelNotification(@Param('notificationId') notificationId: string) {
    return this.notificationAdminService.cancelNotification(notificationId);
  }

  @Get('jobs/health')
  @PlatformAdmin()
  async jobHealth() {
    return this.clinicalService.listJobHealth();
  }

  @Get('subscription-plans')
  @PlatformAdmin()
  async listSubscriptionPlans() {
    const plans = await this.subscriptionService.listSubscriptionPlans();
    return { plans };
  }

  @Post('clinics/:clinicId/subscription/change')
  @PlatformAdmin()
  async changeClinicSubscription(@Param('clinicId') clinicId: string, @Body() body: unknown) {
    const parsed = platformSubscriptionChangeSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid subscription change payload.');
    }
    return this.subscriptionService.changeClinicSubscription(clinicId, parsed.data);
  }
}
