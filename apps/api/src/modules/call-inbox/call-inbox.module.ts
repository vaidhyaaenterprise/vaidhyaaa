import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';

import { CallInboxController } from './call-inbox.controller';
import { CallInboxService } from './call-inbox.service';

@Module({
  imports: [DatabaseModule],
  controllers: [CallInboxController],
  providers: [CallInboxService],
  exports: [CallInboxService],
})
export class CallInboxModule {}
