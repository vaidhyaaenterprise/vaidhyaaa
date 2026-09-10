import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { ActiveStateModule } from '../conversation/active-state.module';
import { TemplateModule } from '../conversation/template.module';
import { NotificationModule } from '../notification/notification.module';
import { StructuredInfoModule } from '../structured-info/structured-info.module';
import { SlotsModule } from '../slots/slots.module';

import { BookingActionValidator } from './booking-action-validator';
import { BookingAppointmentService } from './booking-appointment.service';
import { BookingMachine } from './booking-machine.service';
import { PatientVisitService } from './patient-visit.service';

@Module({
  imports: [DatabaseModule, SlotsModule, ActiveStateModule, StructuredInfoModule, NotificationModule, TemplateModule],
  providers: [
    BookingMachine,
    BookingAppointmentService,
    BookingActionValidator,
    PatientVisitService,
  ],
  exports: [BookingMachine, BookingAppointmentService, PatientVisitService, BookingActionValidator],
})
export class BookingModule {}
