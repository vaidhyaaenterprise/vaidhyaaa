import { Module } from '@nestjs/common';

import { BookingModule } from '../booking/booking.module';
import { DatabaseModule } from '../database/database.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { PatientActionModule } from '../patient-action/patient-action.module';
import { SlotsModule } from '../slots/slots.module';
import { StructuredInfoModule } from '../structured-info/structured-info.module';

import { ActiveStateModule } from './active-state.module';
import { AgentNluFailureAuditService } from './agent-nlu-failure-audit.service';
import { AgentTurnAuditService } from './agent-turn-audit.service';
import { ConversationPolicyService } from './conversation-policy.service';
import { ConversationController } from './conversation.controller';
import { ConversationDevController } from '../../dev/conversation-dev.controller';
import { ConversationOrchestrator } from './conversation-orchestrator.service';
import { ConversationService } from './conversation.service';
import { LanguageManager } from './language-manager.service';
import { LlmFailureHandlerService } from './llm-failure-handler.service';
import { ReceptionistAgentToolsService } from './receptionist-agent-tools';
import { receptionistAgentLlmProvider } from './receptionist-agent-llm.provider';
import { ReceptionistAgentService } from './receptionist-agent.service';
import { ReceptionistDialogExecutor } from './receptionist-dialog-executor.service';
import { ReceptionistResponseComposer } from './receptionist-response-composer.service';
import { TemplateModule } from './template.module';
import { UniversalReceptionistDialogManager } from './universal-receptionist-dialog-manager.service';

@Module({
  imports: [
    DatabaseModule,
    BookingModule,
    KnowledgeModule,
    StructuredInfoModule,
    PatientActionModule,
    SlotsModule,
    TemplateModule,
    ActiveStateModule,
  ],
  controllers: [ConversationController, ConversationDevController],
  providers: [
    ConversationService,
    ConversationOrchestrator,
    ConversationPolicyService,
    LanguageManager,
    LlmFailureHandlerService,
    AgentNluFailureAuditService,
    AgentTurnAuditService,
    UniversalReceptionistDialogManager,
    ReceptionistAgentService,
    ReceptionistAgentToolsService,
    receptionistAgentLlmProvider,
    ReceptionistDialogExecutor,
    ReceptionistResponseComposer,
  ],
  exports: [ConversationService, TemplateModule],
})
export class ConversationModule {}
