import { Module } from '@nestjs/common';

import { NotificationModule } from '../notification/notification.module';
import { SlotsModule } from '../slots/slots.module';

@Module({
  imports: [NotificationModule, SlotsModule],
  exports: [NotificationModule, SlotsModule],
})
export class JobsModule {}
