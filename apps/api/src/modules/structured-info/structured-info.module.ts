import { Module } from '@nestjs/common';

import { SlotsModule } from '../slots/slots.module';
import { TemplateModule } from '../conversation/template.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';

import { DoctorAvailabilityHandler } from './doctor-availability-handler.service';
import { FeeHandler } from './fee-handler.service';
import { LocationHandler } from './location-handler.service';
import { StructuredInfoHandler } from './structured-info-handler.service';
import { TimingHandler } from './timing-handler.service';
import { UnknownQuestionHandler } from './unknown-question-handler.service';

@Module({
  imports: [SlotsModule, KnowledgeModule, TemplateModule],
  providers: [
    FeeHandler,
    TimingHandler,
    LocationHandler,
    DoctorAvailabilityHandler,
    StructuredInfoHandler,
    UnknownQuestionHandler,
  ],
  exports: [StructuredInfoHandler, UnknownQuestionHandler],
})
export class StructuredInfoModule {}
