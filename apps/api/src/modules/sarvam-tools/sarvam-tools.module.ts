import { Module } from '@nestjs/common';
import { AdaptersModule } from '../../common/adapters/adapters.module';
import { BookingModule } from '../booking/booking.module';
import { DatabaseModule } from '../database/database.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { PatientActionModule } from '../patient-action/patient-action.module';
import { SlotsModule } from '../slots/slots.module';
import { SarvamToolsController } from './sarvam-tools.controller';

@Module({
  imports: [
    DatabaseModule,
    SlotsModule,
    BookingModule,
    KnowledgeModule,
    PatientActionModule,
    AdaptersModule,
  ],
  controllers: [SarvamToolsController],
})
export class SarvamToolsModule {}
