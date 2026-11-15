import { Module } from '@nestjs/common';

import { NotificationModule } from '../notification/notification.module';
import { SlotsModule } from '../slots/slots.module';
import { CallInboxModule } from '../call-inbox/call-inbox.module';
import { AppointmentModule } from '../appointment/appointment.module';

@Module({
  imports: [NotificationModule, SlotsModule, CallInboxModule, AppointmentModule],
  exports: [NotificationModule, SlotsModule],
})
export class JobsModule {}
