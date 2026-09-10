import { Module } from '@nestjs/common';

import { ClinicAdminGuard } from '../../common/guards/role.guards';
import { DatabaseModule } from '../database/database.module';
import { SlotsModule } from '../slots/slots.module';

import { ClinicClinicalController } from './clinic-clinical.controller';
import { ClinicClinicalService } from './clinic-clinical.service';
import {
  ClinicSubscriptionController,
  SupportedLanguagesController,
} from './clinic-subscription.controller';
import { ClinicSubscriptionService } from './clinic-subscription.service';
import {
  ClinicProfileController,
  ClinicSettingsController,
  ClinicUsersController,
  ClinicUsersLegacyController,
} from './clinic-setup.controller';
import { ClinicSettingsService } from './clinic-settings.service';
import { ClinicUsersService } from './clinic-users.service';
import { DoctorHistoryService } from './doctor-history.service';

@Module({
  imports: [DatabaseModule, SlotsModule],
  controllers: [
    ClinicProfileController,
    ClinicSettingsController,
    ClinicUsersController,
    ClinicUsersLegacyController,
    ClinicClinicalController,
    ClinicSubscriptionController,
    SupportedLanguagesController,
  ],
  providers: [
    ClinicSettingsService,
    ClinicUsersService,
    ClinicClinicalService,
    DoctorHistoryService,
    ClinicSubscriptionService,
    ClinicAdminGuard,
  ],
  exports: [
    ClinicSettingsService,
    ClinicUsersService,
    ClinicClinicalService,
    DoctorHistoryService,
    ClinicSubscriptionService,
  ],
})
export class ClinicSetupModule {}
