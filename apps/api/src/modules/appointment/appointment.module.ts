import { Module } from '@nestjs/common';

import { DoctorOwnershipGuard } from '../../common/guards/doctor-ownership.guard';
import { DatabaseModule } from '../database/database.module';
import { NotificationModule } from '../notification/notification.module';
import { SlotsModule } from '../slots/slots.module';

import { AppointmentAdminService } from './appointment-admin.service';
import { AppointmentLifecycleService } from './appointment-lifecycle.service';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

@Module({
  imports: [DatabaseModule, NotificationModule, SlotsModule],
  controllers: [AppointmentsController],
  providers: [
    AppointmentsService,
    AppointmentLifecycleService,
    AppointmentAdminService,
    DoctorOwnershipGuard,
  ],
  exports: [AppointmentsService, AppointmentLifecycleService, AppointmentAdminService],
})
export class AppointmentModule {}
