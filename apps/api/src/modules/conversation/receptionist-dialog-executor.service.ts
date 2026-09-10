import { Inject, Injectable } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import type { ConversationSessionRow } from '@vaidya/db';
import {
  attachActiveTask,
  buildSafetyIntentClassification,
  capabilityToIntent,
  detectMessageSafety,
  markTaskCompleted,
  parseActiveTask,
  parseBookingCollected,
  resolveResumePromptTemplateKey,
  shouldRouteToStructuredInfoHandler,
  type IntentClassifierResult,
  type LanguageCode,
  type ReceptionistDialogPlan,
} from '@vaidya/shared';

import { API_ENV } from '../../config/api-config.module';
import { SlotHoldService } from '../slots/slot-hold.service';
import { StructuredInfoHandler } from '../structured-info/structured-info-handler.service';
import { EmergencyHandlerService } from '../patient-action/emergency-handler.service';
import { HandoffMachineService } from '../patient-action/handoff-machine.service';

import { ReceptionistResponseComposer } from './receptionist-response-composer.service';
import { TemplateRenderer } from './template-renderer.service';
import type { OrchestratorResult } from './conversation-orchestrator.service';

export type DialogExecutorInput = {
  session: ConversationSessionRow;
  clinicName: string;
  messageText: string;
  languageCode: LanguageCode;
  flowBefore: string;
  stateBefore: string;
  plan: ReceptionistDialogPlan;
  lastAssistantTemplateKey?: string | null;
  languageSource?: 'patient_requested';
};

@Injectable()
export class ReceptionistDialogExecutor {
  constructor(
    @Inject(ReceptionistResponseComposer)
    private readonly composer: ReceptionistResponseComposer,
    @Inject(TemplateRenderer) private readonly templateRenderer: TemplateRenderer,
    @Inject(StructuredInfoHandler) private readonly structuredInfoHandler: StructuredInfoHandler,
    @Inject(EmergencyHandlerService) private readonly emergencyHandler: EmergencyHandlerService,
    @Inject(HandoffMachineService) private readonly handoffMachine: HandoffMachineService,
    @Inject(SlotHoldService) private readonly slotHoldService: SlotHoldService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  shouldDelegateToLegacy(plan: ReceptionistDialogPlan): boolean {
    if (
      plan.turnType === 'continue_current_task' ||
      plan.turnType === 'start_new_task' ||
      plan.turnType === 'switch_task'
    ) {
      return true;
    }

    if (plan.turnType === 'answer_question' && !plan.taskPlan.shouldResumeActiveTask) {
      return true;
    }

    if (plan.turnType === 'out_of_scope_redirect' && !plan.taskPlan.shouldResumeActiveTask) {
      return true;
    }

    if (plan.turnType === 'unknown_safe_fallback') {
      // Mid-task utterances should be interpreted by the active-state LLM extractor.
      if (plan.taskPlan.shouldResumeActiveTask) {
        return true;
      }
      return plan.confidence < 0.55;
    }

    return false;
  }

  async tryExecute(input: DialogExecutorInput): Promise<OrchestratorResult | null> {
    if (this.shouldDelegateToLegacy(input.plan)) {
      return null;
    }

    const debugBase = this.buildDebug(input.plan);

    switch (input.plan.turnType) {
      case 'complete_acknowledgement':
        return this.handleCompleteAcknowledgement(input, debugBase);
      case 'ask_clarification':
      case 'ask_clarification_and_keep_task':
        return this.handleClarification(input, debugBase);
      case 'answer_question':
      case 'answer_question_and_resume':
        return this.handleAnswerQuestion(input, debugBase);
      case 'medical_advice_refusal':
        return this.handleMedicalAdviceRefusal(input, debugBase);
      case 'emergency_response':
        return this.handleEmergency(input, debugBase);
      case 'out_of_scope_redirect':
        return this.handleOutOfScope(input, debugBase);
      case 'handoff_to_staff':
        return this.handleHandoff(input, debugBase);
      case 'cancel_current_task':
        return this.handleCancelCurrentTask(input, debugBase);
      case 'unknown_safe_fallback':
        return this.handleUnknownFallback(input, debugBase);
      default:
        return null;
    }
  }

  private async handleCompleteAcknowledgement(
    input: DialogExecutorInput,
    debug: Record<string, unknown>,
  ): Promise<OrchestratorResult> {
    const ack = await this.composer.composeAcknowledgement(
      input.plan,
      input.languageCode,
      input.clinicName,
      input.messageText,
    );
    const collectedJson = markTaskCompleted(
      parseBookingCollected(input.session.collectedJson) as Record<string, unknown>,
      {
        flow: input.flowBefore === 'none' ? 'booking' : input.flowBefore,
        finalTemplateKey: input.lastAssistantTemplateKey ?? ack.templateKey,
      },
    );
    delete collectedJson.awaiting_terminal_ack;

    return {
      intent: 'acknowledgment',
      templateKey: ack.templateKey,
      templateVariables: ack.templateVariables,
      flowBefore: input.flowBefore,
      stateBefore: input.stateBefore,
      flowAfter: 'none',
      stateAfter: 'IDLE',
      languageCode: input.languageCode,
      collectedJson,
      sessionStatus: 'completed',
      ...(input.languageSource ? { languageSource: input.languageSource } : {}),
      debug: { ...debug, final_handler: 'a21_ack_handler' },
    };
  }

  private async handleClarification(
    input: DialogExecutorInput,
    debug: Record<string, unknown>,
  ): Promise<OrchestratorResult> {
    const activeTask = parseActiveTask(
      (input.session.collectedJson ?? {}) as Record<string, unknown>,
    );
    const resumeKey = resolveResumePromptTemplateKey(activeTask);
    const clarification = await this.composer.composeClarification(
      input.plan,
      input.languageCode,
      input.clinicName,
      resumeKey,
    );
    let collectedJson = (input.session.collectedJson ?? {}) as Record<string, unknown>;
    if (activeTask && input.plan.turnType === 'ask_clarification_and_keep_task') {
      collectedJson = attachActiveTask(collectedJson, activeTask);
    }

    return {
      intent: 'clarification',
      templateKey: clarification.templateKey,
      templateVariables: clarification.templateVariables,
      flowBefore: input.flowBefore,
      stateBefore: input.stateBefore,
      flowAfter: input.flowBefore,
      stateAfter: input.stateBefore,
      languageCode: input.languageCode,
      collectedJson,
      sessionStatus: 'active',
      ...(input.languageSource ? { languageSource: input.languageSource } : {}),
      debug: { ...debug, final_handler: 'a21_clarify_handler' },
    };
  }

  private async handleAnswerQuestion(
    input: DialogExecutorInput,
    debug: Record<string, unknown>,
  ): Promise<OrchestratorResult | null> {
    const intent = capabilityToIntent(input.plan.capability);
    if (!shouldRouteToStructuredInfoHandler(intent)) {
      return null;
    }

    const classification = this.planToClassification(input.plan, input.languageCode);
    const structuredResult = await this.structuredInfoHandler.handle({
      session: input.session,
      messageText: input.messageText,
      classification,
    });

    if (input.plan.taskPlan.shouldResumeActiveTask) {
      const activeTask = parseActiveTask(structuredResult.collectedJson);
      const resumeState = activeTask?.state ?? input.stateBefore;
      const answerText = await this.composer.composeAnswerWithResume({
        answerText: structuredResult.templateVariables.answer_text ?? '',
        session: {
          ...input.session,
          collectedJson: structuredResult.collectedJson,
          currentFlow: structuredResult.flowAfter,
          currentState: structuredResult.stateAfter,
        },
        clinicName: input.clinicName,
        languageCode: input.languageCode,
        resumeTemplateKey: input.plan.taskPlan.resumePromptKey ?? null,
        resumeState,
      });

      return {
        intent: structuredResult.intent,
        templateKey: 'knowledge.answer',
        templateVariables: { answer_text: answerText },
        flowBefore: structuredResult.flowBefore,
        stateBefore: structuredResult.stateBefore,
        flowAfter: structuredResult.flowAfter,
        stateAfter: structuredResult.stateAfter,
        languageCode: input.languageCode,
        collectedJson: structuredResult.collectedJson,
        ...(input.languageSource ? { languageSource: input.languageSource } : {}),
        debug: {
          ...debug,
          final_handler: 'a21_structured_handler',
          structured_handler_called: true,
        },
      };
    }

    return {
      intent: structuredResult.intent,
      templateKey: structuredResult.templateKey,
      templateVariables: structuredResult.templateVariables,
      flowBefore: structuredResult.flowBefore,
      stateBefore: structuredResult.stateBefore,
      flowAfter: structuredResult.flowAfter,
      stateAfter: structuredResult.stateAfter,
      languageCode: input.languageCode,
      collectedJson: structuredResult.collectedJson,
      ...(input.languageSource ? { languageSource: input.languageSource } : {}),
      debug: { ...debug, final_handler: 'a21_structured_handler', structured_handler_called: true },
    };
  }

  private async handleMedicalAdviceRefusal(
    input: DialogExecutorInput,
    debug: Record<string, unknown>,
  ): Promise<OrchestratorResult> {
    const resume = input.plan.taskPlan.shouldResumeActiveTask;
    const templateKey = resume ? 'safety.medical_advice_refusal_resume' : 'safety.medical_advice_refusal';

    if (resume) {
      const activeTask = parseActiveTask((input.session.collectedJson ?? {}) as Record<string, unknown>);
      const answerText = await this.composer.composeAnswerWithResume({
        answerText: (
          await this.templateRenderer.render('safety.medical_advice_refusal', input.languageCode, {
            clinic_name: input.clinicName,
          })
        ).message_text,
        session: input.session,
        clinicName: input.clinicName,
        languageCode: input.languageCode,
        resumeTemplateKey: input.plan.taskPlan.resumePromptKey ?? null,
        resumeState: activeTask?.state ?? input.stateBefore,
      });

      return {
        intent: 'medical_advice_request',
        templateKey: 'knowledge.answer',
        templateVariables: { answer_text: answerText },
        flowBefore: input.flowBefore,
        stateBefore: input.stateBefore,
        flowAfter: input.flowBefore,
        stateAfter: input.stateBefore,
        languageCode: input.languageCode,
        collectedJson: parseBookingCollected(input.session.collectedJson) as Record<string, unknown>,
        ...(input.languageSource ? { languageSource: input.languageSource } : {}),
        debug: { ...debug, final_handler: 'a21_medical_advice_handler', knowledge_search_called: false },
      };
    }

    return {
      intent: 'medical_advice_request',
      templateKey,
      templateVariables: { clinic_name: input.clinicName },
      flowBefore: input.flowBefore,
      stateBefore: input.stateBefore,
      flowAfter: input.flowBefore,
      stateAfter: input.stateBefore,
      languageCode: input.languageCode,
      collectedJson: parseBookingCollected(input.session.collectedJson) as Record<string, unknown>,
      ...(input.languageSource ? { languageSource: input.languageSource } : {}),
      debug: { ...debug, final_handler: 'a21_medical_advice_handler', knowledge_search_called: false },
    };
  }

  private async handleEmergency(
    input: DialogExecutorInput,
    debug: Record<string, unknown>,
  ): Promise<OrchestratorResult> {
    if (input.plan.taskPlan.shouldReleaseActiveHold) {
      await this.slotHoldService.releaseSessionHolds(input.session.clinicId, input.session.id);
    }
    const safety = detectMessageSafety(input.messageText);
    const classification = buildSafetyIntentClassification(input.languageCode, safety);
    const emergencyResult = await this.emergencyHandler.handle({
      session: input.session,
      messageText: input.messageText,
      classification,
      flowBefore: input.flowBefore,
      stateBefore: input.stateBefore,
      languageCode: input.languageCode,
    });
    return {
      ...emergencyResult,
      ...(input.languageSource ? { languageSource: input.languageSource } : {}),
      debug: { ...debug, final_handler: 'a21_emergency_handler' },
    };
  }

  private async handleOutOfScope(
    input: DialogExecutorInput,
    debug: Record<string, unknown>,
  ): Promise<OrchestratorResult> {
    const resume = input.plan.taskPlan.shouldResumeActiveTask;
    const scopeText = (
      await this.templateRenderer.render(
        resume ? 'scope.out_of_scope_resume' : 'scope.out_of_scope',
        input.languageCode,
        { clinic_name: input.clinicName, resume_prompt: '' },
      )
    ).message_text;

    let answerText = scopeText;
    if (resume) {
      const activeTask = parseActiveTask((input.session.collectedJson ?? {}) as Record<string, unknown>);
      answerText = await this.composer.composeAnswerWithResume({
        answerText: (
          await this.templateRenderer.render('scope.out_of_scope', input.languageCode, {
            clinic_name: input.clinicName,
          })
        ).message_text,
        session: input.session,
        clinicName: input.clinicName,
        languageCode: input.languageCode,
        resumeTemplateKey: input.plan.taskPlan.resumePromptKey ?? null,
        resumeState: activeTask?.state ?? input.stateBefore,
      });
    }

    return {
      intent: 'out_of_scope',
      templateKey: 'knowledge.answer',
      templateVariables: { answer_text: answerText },
      flowBefore: input.flowBefore,
      stateBefore: input.stateBefore,
      flowAfter: input.flowBefore,
      stateAfter: input.stateBefore,
      languageCode: input.languageCode,
      collectedJson: parseBookingCollected(input.session.collectedJson) as Record<string, unknown>,
      ...(input.languageSource ? { languageSource: input.languageSource } : {}),
      debug: { ...debug, final_handler: 'a21_scope_handler' },
    };
  }

  private async handleHandoff(
    input: DialogExecutorInput,
    debug: Record<string, unknown>,
  ): Promise<OrchestratorResult> {
    if (input.plan.taskPlan.shouldReleaseActiveHold) {
      await this.slotHoldService.releaseSessionHolds(input.session.clinicId, input.session.id);
    }
    const classification = this.planToClassification(input.plan, input.languageCode);
    const handoffResult = await this.handoffMachine.handle({
      session: input.session,
      clinicName: input.clinicName,
      messageText: input.messageText,
      classification,
    });
    return {
      intent: handoffResult.intent,
      templateKey: handoffResult.templateKey,
      templateVariables: handoffResult.templateVariables,
      flowBefore: handoffResult.flowBefore,
      stateBefore: handoffResult.stateBefore,
      flowAfter: handoffResult.flowAfter,
      stateAfter: handoffResult.stateAfter,
      languageCode: input.languageCode,
      collectedJson: handoffResult.collectedJson,
      ...(handoffResult.sessionStatus ? { sessionStatus: handoffResult.sessionStatus } : {}),
      ...(input.languageSource ? { languageSource: input.languageSource } : {}),
      debug: { ...debug, final_handler: 'a21_handoff_handler' },
    };
  }

  private async handleCancelCurrentTask(
    input: DialogExecutorInput,
    debug: Record<string, unknown>,
  ): Promise<OrchestratorResult> {
    if (input.plan.taskPlan.shouldReleaseActiveHold) {
      await this.slotHoldService.releaseSessionHolds(input.session.clinicId, input.session.id);
    }
    const rendered = await this.templateRenderer.render('booking.flow_cancelled', input.languageCode, {
      clinic_name: input.clinicName,
    });
    return {
      intent: 'cancel_booking',
      templateKey: 'booking.flow_cancelled',
      templateVariables: { clinic_name: input.clinicName },
      flowBefore: input.flowBefore,
      stateBefore: input.stateBefore,
      flowAfter: 'none',
      stateAfter: 'IDLE',
      languageCode: input.languageCode,
      collectedJson: {},
      sessionStatus: 'active',
      ...(input.languageSource ? { languageSource: input.languageSource } : {}),
      debug: { ...debug, final_handler: 'a21_cancel_task_handler', message_text: rendered.message_text },
    };
  }

  private async handleUnknownFallback(
    input: DialogExecutorInput,
    debug: Record<string, unknown>,
  ): Promise<OrchestratorResult | null> {
    if (input.plan.taskPlan.shouldResumeActiveTask) {
      return null;
    }
    const rendered = await this.templateRenderer.render('unknown.help_options', input.languageCode, {
      clinic_name: input.clinicName,
    });
    return {
      intent: 'unknown',
      templateKey: 'unknown.help_options',
      templateVariables: { clinic_name: input.clinicName },
      flowBefore: input.flowBefore,
      stateBefore: input.stateBefore,
      flowAfter: input.flowBefore,
      stateAfter: input.stateBefore,
      languageCode: input.languageCode,
      collectedJson: (input.session.collectedJson ?? {}) as Record<string, unknown>,
      ...(input.languageSource ? { languageSource: input.languageSource } : {}),
      debug: { ...debug, final_handler: 'a21_unknown_handler' },
    };
  }

  private planToClassification(
    plan: ReceptionistDialogPlan,
    languageCode: LanguageCode,
  ): IntentClassifierResult {
    const intent = capabilityToIntent(plan.capability);
    return {
      intent,
      confidence: plan.confidence,
      languageCode,
      entities: {
        patientName: plan.extractedEntities.patientName ?? null,
        doctorName: plan.extractedEntities.doctorName ?? null,
        reasonForVisit: plan.extractedEntities.reasonForVisit ?? null,
        date: plan.extractedEntities.date ?? null,
        timePreference: (plan.extractedEntities.timePreference as 'morning' | 'afternoon' | 'evening' | null) ?? null,
        visitType: null,
        dayName: null,
        feeCategory: null,
        topic: plan.extractedEntities.topic ?? null,
        requestedLanguageCode: plan.extractedEntities.requestedLanguageCode ?? null,
      },
      safety: { isEmergency: false, isMedicalAdviceRequest: false, reason: null },
      needsClarification: false,
    };
  }

  private buildDebug(plan: ReceptionistDialogPlan): Record<string, unknown> {
    if (!this.env.DEBUG_API || this.env.NODE_ENV === 'production') {
      return {};
    }
    return {
      dialog_manager: {
        called: true,
        provider: this.env.RECEPTIONIST_DIALOG_PLANNER_PROVIDER,
        turn_type: plan.turnType,
        user_move: plan.userMove,
        capability: plan.capability,
        confidence: plan.confidence,
        source_of_truth: plan.answerPlan?.sourceOfTruth ?? null,
        handler: plan.answerPlan?.handler ?? null,
        response_composition: plan.responseComposition,
        raw_plan: plan,
      },
      llm_free_text_used: false,
    };
  }
}
