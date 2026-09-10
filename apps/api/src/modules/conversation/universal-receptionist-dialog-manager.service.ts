import { Inject, Injectable } from '@nestjs/common';

import {
  ADAPTER_TOKENS,
  buildClinicCapabilitiesForDialogInput,
  parseActiveTask,
  parseLastCompletedTask,
  parseSuspendedTask,
  type ReceptionistDialogInput,
  type ReceptionistDialogPlan,
  type ReceptionistDialogPlannerAdapter,
  type ReceptionistConversationTurn,
} from '@vaidya/shared';

@Injectable()
export class UniversalReceptionistDialogManager {
  constructor(
    @Inject(ADAPTER_TOKENS.ReceptionistDialogPlannerAdapter)
    private readonly planner: ReceptionistDialogPlannerAdapter,
  ) {}

  async plan(input: ReceptionistDialogInput): Promise<ReceptionistDialogPlan | null> {
    return this.planner.plan(input);
  }

  buildInput(input: {
    clinicId: string;
    sessionId: string;
    messageText: string;
    languageCode: string;
    currentFlow: string;
    currentState: string;
    collected: Record<string, unknown>;
    clinicName: string;
    lastAssistantMessageText?: string | null;
    lastAssistantTemplateKey?: string | null;
    recentTurns?: ReceptionistConversationTurn[];
    activeServices?: ReceptionistDialogInput['clinicContextSummary']['activeServices'];
  }): ReceptionistDialogInput {
    return {
      clinicId: input.clinicId,
      sessionId: input.sessionId,
      messageText: input.messageText,
      languageCode: input.languageCode,
      currentFlow: input.currentFlow,
      currentState: input.currentState,
      lastAssistantMessageText: input.lastAssistantMessageText ?? null,
      lastAssistantTemplateKey: input.lastAssistantTemplateKey ?? null,
      recentTurns: input.recentTurns ?? [],
      collected: input.collected,
      activeTask: parseActiveTask(input.collected),
      suspendedTask: parseSuspendedTask(input.collected),
      lastCompletedTask: parseLastCompletedTask(input.collected),
      clinicCapabilities: buildClinicCapabilitiesForDialogInput(),
      clinicContextSummary: {
        clinicName: input.clinicName,
        defaultLanguageCode: input.languageCode,
        enabledLanguages: ['ta_tanglish', 'english'],
        activeServices: input.activeServices ?? [],
      },
    };
  }
}
