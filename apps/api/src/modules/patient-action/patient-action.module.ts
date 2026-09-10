import { Module } from '@nestjs/common';

import { ActiveStateModule } from '../conversation/active-state.module';
import { TemplateModule } from '../conversation/template.module';
import { NotificationModule } from '../notification/notification.module';
import { SlotsModule } from '../slots/slots.module';
import { StructuredInfoModule } from '../structured-info/structured-info.module';

import { AppointmentLookupService } from './appointment-lookup.service';
import { CancelMachineService } from './cancel-machine.service';
import { EmergencyHandlerService } from './emergency-handler.service';
import { HandoffMachineService } from './handoff-machine.service';
import { RescheduleMachineService } from './reschedule-machine.service';
import { StaffNotificationService } from './staff-notification.service';

@Module({
  imports: [SlotsModule, TemplateModule, ActiveStateModule, NotificationModule, StructuredInfoModule],
  providers: [
    AppointmentLookupService,
    StaffNotificationService,
    EmergencyHandlerService,
    CancelMachineService,
    RescheduleMachineService,
    HandoffMachineService,
  ],
  exports: [
    EmergencyHandlerService,
    CancelMachineService,
    RescheduleMachineService,
    HandoffMachineService,
    StaffNotificationService,
    AppointmentLookupService,
  ],
})
export class PatientActionModule {}
