import { Module } from '@nestjs/common';

import { NotificationModule } from '../notification/notification.module';
import { SlotsModule } from '../slots/slots.module';
import { CallInboxModule } from '../call-inbox/call-inbox.module';

@Module({
  imports: [NotificationModule, SlotsModule, CallInboxModule],
  exports: [NotificationModule, SlotsModule],
})
export class JobsModule {}
