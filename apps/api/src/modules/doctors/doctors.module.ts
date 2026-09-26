import { Module } from '@nestjs/common';

import { ClinicAdminGuard } from '../../common/guards/role.guards';
import { DatabaseModule } from '../database/database.module';
import { ClinicSetupModule } from '../clinic-setup/clinic-setup.module';

import { ClinicMembersController, DoctorsController } from './doctors.controller';
import { DoctorsService } from './doctors.service';

@Module({
  imports: [DatabaseModule, ClinicSetupModule],
  controllers: [DoctorsController, ClinicMembersController],
  providers: [DoctorsService, ClinicAdminGuard],
  exports: [DoctorsService],
})
export class DoctorsModule {}
