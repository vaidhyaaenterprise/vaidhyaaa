import { Module } from '@nestjs/common';

import { PlatformAdminGuard } from '../../common/guards/role.guards';
import { DatabaseModule } from '../database/database.module';
import { ClinicSetupModule } from '../clinic-setup/clinic-setup.module';
import { NotificationAdminService } from '../notification/notification-admin.service';

import { PlatformClinicsController, PlatformUsersController } from './platform.controller';
import { PlatformMonitoringController } from './platform-monitoring.controller';
import { PlatformOnboardingService } from './platform-onboarding.service';

@Module({
  imports: [DatabaseModule, ClinicSetupModule],
  controllers: [PlatformClinicsController, PlatformUsersController, PlatformMonitoringController],
  providers: [PlatformOnboardingService, PlatformAdminGuard, NotificationAdminService],
})
export class PlatformModule {}
