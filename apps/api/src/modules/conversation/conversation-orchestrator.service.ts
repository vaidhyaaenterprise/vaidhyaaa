import { Inject, Injectable, Logger } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import { type ConversationSessionRow } from '@vaidya/db';
import {
  ADAPTER_TOKENS,
  BOOKING_FLOW,
  CANCEL_FLOW,
  CANCEL_INTENTS,
  FEE_CLARIFICATION_FLOW,
  HANDOFF_FLOW,
  HANDOFF_INTENTS,
  RESCHEDULE_FLOW,
  RESCHEDULE_INTENTS,
  AppError,
  attachActivePrompt,
  buildActivePromptSnapshot,
  buildSafetyIntentClassification,
  detectMessageSafety,
  hasActiveBookingPrompt,
  isActiveFlowClassifierInterrupt,
  isActiveStateInterpreterContext,
  isCapabilityFlowInterrupt,
  isCapabilityLifecycleInterrupt,
  normalizeIntentClassification,
  parseActivePrompt,
  resolveCapabilityForIntent,
  shouldRouteToStructuredInfoHandler,
  type IntentClassifierAdapter,
  type IntentClassifierResult,
  type LanguageCode,
  parseBookingCollected,
  readAwaitingTerminalAck,
  hasBookingProgress,
  inferBookingState,
  isActiveReceptionistFlow,
  resumeBookingSession,
  resolveLlmRuntimeSettings,
  type ReceptionistConversationTurn,
  type ReceptionistDialogPlan,
  resolveTerminalAckOutcome,
  resolveGlobalIntentPolicy,
  skippedClassifierLlmDebug,
  summarizeLlmPath,
  templateKeyForIntent,
  tryDeterministicIntentClassification,
  type LlmInvocationDebug,
} from '@vaidya/shared';

import { isAgentModeEnabled } from '../../common/llm/agent-planner-client.factory';
import { API_ENV } from '../../config/api-config.module';
import { KnowledgeSearchService } from '../knowledge/knowledge-search.service';

import { BookingMachine } from '../booking/booking-machine.service';
import { CancelMachineService } from '../patient-action/cancel-machine.service';
import { EmergencyHandlerService } from '../patient-action/emergency-handler.service';
import { HandoffMachineService } from '../patient-action/handoff-machine.service';
import { RescheduleMachineService } from '../patient-action/reschedule-machine.service';
import { StructuredInfoHandler } from '../structured-info/structured-info-handler.service';
import { appendBookingResumeText } from '../structured-info/booking-resume.helper';
import { UnknownQuestionHandler } from '../structured-info/unknown-question-handler.service';

import { ActiveStateInterpretationService } from './active-state-interpretation.service';
import { LanguageManager } from './language-manager.service';
import { LlmFailureHandlerService } from './llm-failure-handler.service';
import { ReceptionistDialogExecutor } from './receptionist-dialog-executor.service';
import { syncTaskContextOnOrchestratorResult } from './conversation-task-context.helper';
import { TemplateRenderer } from './template-renderer.service';
import { ReceptionistAgentService } from './receptionist-agent.service';
import type { AgentTurnResult } from './receptionist-agent.types';
import { UniversalReceptionistDialogManager } from './universal-receptionist-dialog-manager.service';

export interface OrchestratorInput {
  session: ConversationSessionRow;
  clinicName: string;
  messageText: string;
  lastAssistantMessageText?: string | null;
  lastAssistantTemplateKey?: string | null;
  recentTurns?: import('@vaidya/shared').ReceptionistConversationTurn[];
}

export interface OrchestratorResult {
  intent: string;
  templateKey: string;
  templateVariables: Record<string, string>;
  flowBefore: string;
  stateBefore: string;
  flowAfter: string;
  stateAfter: string;
  languageCode: LanguageCode;
  languageSource?: 'patient_requested';
  collectedJson: Record<string, unknown>;
  sessionStatus?: 'active' | 'completed' | 'escalated';
  messageText?: string;
  debug?: Record<string, unknown>;
}

function resolveRoutingSession(
  session: ConversationSessionRow,
  reactivate: boolean,
): ConversationSessionRow {
  if (!reactivate) {
    return session;
  }
  return {
    ...session,
    status: 'active',
    currentFlow: 'none',
    currentState: 'IDLE',
    collectedJson: {},
  };
}

const BOOKING_INTENTS = new Set(['book_appointment']);

function buildActiveFlowClassification(languageCode: LanguageCode): IntentClassifierResult {
  return {
    intent: 'active_flow_answer',
    confidence: 1,
    languageCode,
    entities: {},
    safety: {
      isEmergency: false,
      isMedicalAdviceRequest: false,
      reason: null,
    },
    needsClarification: false,
  };
}

function isLifecycleInterruptIntent(intent: string): boolean {
  return isCapabilityLifecycleInterrupt(intent);
}

function buildSafetyClassification(
  languageCode: LanguageCode,
  safety: ReturnType<typeof detectMessageSafety>,
): IntentClassifierResult {
  return buildSafetyIntentClassification(languageCode, safety);
}
function isFlowInterrupt(
  intent: string,
  classification: { safety: { isEmergency: boolean; isMedicalAdviceRequest: boolean } },
): boolean {
  return isCapabilityFlowInterrupt(intent, classification.safety);
}

function clearCompletedLifecycleFlow(
  session: ConversationSessionRow,
  intent: string,
): ConversationSessionRow {
  if (session.currentState !== 'DONE') {
    return session;
  }

  if (session.currentFlow === CANCEL_FLOW && !CANCEL_INTENTS.has(intent)) {
    return {
      ...session,
      currentFlow: 'none',
      currentState: 'IDLE',
    };
  }

  if (session.currentFlow === RESCHEDULE_FLOW && !RESCHEDULE_INTENTS.has(intent)) {
    return {
      ...session,
      currentFlow: 'none',
      currentState: 'IDLE',
    };
  }

  if (session.currentFlow === HANDOFF_FLOW && !HANDOFF_INTENTS.has(intent)) {
    return {
      ...session,
      currentFlow: 'none',
      currentState: 'IDLE',
    };
  }

  return session;
}

function applyPromptAwareSession(session: ConversationSessionRow): ConversationSessionRow {
  const collected = (session.collectedJson ?? {}) as Record<string, unknown>;
  const prompt = parseActivePrompt(collected);
  if (!prompt) {
    return session;
  }
  if (session.currentFlow !== 'none' && session.currentFlow !== BOOKING_FLOW) {
    return session;
  }
  if (session.currentFlow === BOOKING_FLOW && session.currentState !== 'IDLE') {
    return session;
  }
  return {
    ...session,
    currentFlow: prompt.flow ?? BOOKING_FLOW,
    currentState: prompt.state,
  };
}

function isActiveLifecycleStep(flow: string, state: string): boolean {
  if (flow === CANCEL_FLOW || flow === RESCHEDULE_FLOW || flow === HANDOFF_FLOW) {
    return state !== 'IDLE' && state !== 'DONE';
  }
  return false;
}

function strengthenLlmRuntimeForDialogDelegation(
  runtime: import('@vaidya/shared').LlmRuntimeSettings,
): import('@vaidya/shared').LlmRuntimeSettings {
  return {
    ...runtime,
    profile: 'standard',
    skipActiveFlowClassifier: false,
    skipJsonRepair: false,
    maxOutputTokens: Math.max(runtime.maxOutputTokens, 512),
  };
}

@Injectable()
export class ConversationOrchestrator {
  private readonly logger = new Logger(ConversationOrchestrator.name);

  constructor(
    @Inject(LanguageManager) private readonly languageManager: LanguageManager,
    @Inject(TemplateRenderer) private readonly templateRenderer: TemplateRenderer,
    @Inject(ADAPTER_TOKENS.IntentClassifierAdapter)
    private readonly intentClassifier: IntentClassifierAdapter,
    @Inject(BookingMachine) private readonly bookingMachine: BookingMachine,
    @Inject(StructuredInfoHandler) private readonly structuredInfoHandler: StructuredInfoHandler,
    @Inject(UnknownQuestionHandler) private readonly unknownQuestionHandler: UnknownQuestionHandler,
    @Inject(EmergencyHandlerService) private readonly emergencyHandler: EmergencyHandlerService,
    @Inject(CancelMachineService) private readonly cancelMachine: CancelMachineService,
    @Inject(RescheduleMachineService) private readonly rescheduleMachine: RescheduleMachineService,
    @Inject(HandoffMachineService) private readonly handoffMachine: HandoffMachineService,
    @Inject(KnowledgeSearchService) private readonly knowledgeSearch: KnowledgeSearchService,
    @Inject(ActiveStateInterpretationService)
    private readonly activeStateService: ActiveStateInterpretationService,
    @Inject(LlmFailureHandlerService)
    private readonly llmFailureHandler: LlmFailureHandlerService,
    @Inject(UniversalReceptionistDialogManager)
    private readonly dialogManager: UniversalReceptionistDialogManager,
    @Inject(ReceptionistDialogExecutor)
    private readonly dialogExecutor: ReceptionistDialogExecutor,
    @Inject(ReceptionistAgentService)
    private readonly receptionistAgent: ReceptionistAgentService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private finalizeResult(result: OrchestratorResult): OrchestratorResult {
    return syncTaskContextOnOrchestratorResult(result);
  }

  private async tryReceptionistDialogRoute(input: {
    session: ConversationSessionRow;
    clinicName: string;
    messageText: string;
    languageCode: LanguageCode;
    languageSource?: 'patient_requested';
    flowBefore: string;
    stateBefore: string;
    lastAssistantMessageText?: string | null;
    lastAssistantTemplateKey?: string | null;
    recentTurns?: ReceptionistConversationTurn[];
  }): Promise<{ result: OrchestratorResult | null; delegatedPlan: ReceptionistDialogPlan | null }> {
    const collected = (input.session.collectedJson ?? {}) as Record<string, unknown>;
    const dialogInput = this.dialogManager.buildInput({
      clinicId: input.session.clinicId,
      sessionId: input.session.id,
      messageText: input.messageText,
      languageCode: input.languageCode,
      currentFlow: input.flowBefore,
      currentState: input.stateBefore,
      collected,
      clinicName: input.clinicName,
      lastAssistantMessageText: input.lastAssistantMessageText ?? null,
      lastAssistantTemplateKey: input.lastAssistantTemplateKey ?? null,
      recentTurns: input.recentTurns ?? [],
    });
    const plan = await this.dialogManager.plan(dialogInput);
    if (!plan) {
      return { result: null, delegatedPlan: null };
    }
    const executed = await this.dialogExecutor.tryExecute({
      session: input.session,
      clinicName: input.clinicName,
      messageText: input.messageText,
      languageCode: input.languageCode,
      flowBefore: input.flowBefore,
      stateBefore: input.stateBefore,
      plan,
      lastAssistantTemplateKey: input.lastAssistantTemplateKey ?? null,
      ...(input.languageSource ? { languageSource: input.languageSource } : {}),
    });
    if (!executed) {
      return { result: null, delegatedPlan: plan };
    }
    return { result: executed, delegatedPlan: null };
  }

  async handlePatientMessage(input: OrchestratorInput): Promise<OrchestratorResult> {
    try {
      return this.finalizeResult(await this.handlePatientMessageInternal(input));
    } catch (error) {
      if (this.llmFailureHandler.isLlmFailure(error)) {
        const session = input.session;
        return this.llmFailureHandler.handleFailure({
          session,
          clinicName: input.clinicName,
          languageCode: session.languageCode as LanguageCode,
          flowBefore: session.currentFlow,
          stateBefore: session.currentState,
          collectedJson: (session.collectedJson ?? {}) as Record<string, unknown>,
          error: error as AppError,
        });
      }
      throw error;
    }
  }

  private async handlePatientMessageInternal(input: OrchestratorInput): Promise<OrchestratorResult> {
    const { clinicName, messageText } = input;
    const session = applyPromptAwareSession(resumeBookingSession(input.session));

    let languageCode = session.languageCode as LanguageCode;
    let languageSource: 'patient_requested' | undefined;

    const switchedLanguage = this.languageManager.detectLanguageSwitch(messageText);
    if (switchedLanguage) {
      languageCode = switchedLanguage;
      languageSource = 'patient_requested';
    }

    if (isAgentModeEnabled(this.env)) {
      const agentAttempt = await this.tryAgentPatientMessage({
        session,
        clinicName,
        messageText,
        languageCode,
        flowBefore: session.currentFlow,
        stateBefore: session.currentState,
        recentTurns: input.recentTurns ?? [],
        lastAssistantMessageText: input.lastAssistantMessageText ?? null,
        ...(languageSource ? { languageSource } : {}),
      });
      if (agentAttempt.handled) {
        return agentAttempt.result;
      }

      const legacyResult = await this.handleLegacyPatientMessage(input, {
        session,
        clinicName,
        messageText,
        languageCode,
        switchedLanguage,
        ...(languageSource ? { languageSource } : {}),
      });

      if (agentAttempt.fallbackReason) {
        return this.attachAgentFallbackDebug(legacyResult, agentAttempt.fallbackReason);
      }
      return legacyResult;
    }

    return this.handleLegacyPatientMessage(input, {
      session,
      clinicName,
      messageText,
      languageCode,
      switchedLanguage,
      ...(languageSource ? { languageSource } : {}),
    });
  }

  private async tryAgentPatientMessage(input: {
    session: ConversationSessionRow;
    clinicName: string;
    messageText: string;
    languageCode: LanguageCode;
    flowBefore: string;
    stateBefore: string;
    recentTurns: ReceptionistConversationTurn[];
    lastAssistantMessageText?: string | null;
    languageSource?: 'patient_requested';
  }): Promise<
    | { handled: true; result: OrchestratorResult }
    | { handled: false; fallbackReason?: string }
  > {
    const safety = detectMessageSafety(input.messageText);
    if (safety.isEmergency) {
      const classification = buildSafetyClassification(input.languageCode, safety);
      const emergencyResult = await this.emergencyHandler.handle({
        session: input.session,
        messageText: input.messageText,
        classification,
        flowBefore: input.flowBefore,
        stateBefore: input.stateBefore,
        languageCode: input.languageCode,
      });
      return {
        handled: true,
        result: {
          ...emergencyResult,
          ...(input.languageSource ? { languageSource: input.languageSource } : {}),
          ...(this.env.DEBUG_API && this.env.NODE_ENV !== 'production'
            ? {
                debug: {
                  handler: 'a05_emergency_safety_first',
                  classification,
                  agent_attempted: true,
                  agent_llm_status: 'skipped_emergency',
                },
              }
            : {}),
        },
      };
    }

    const collected = (input.session.collectedJson ?? {}) as Record<string, unknown>;
    const agentOutcome = await this.receptionistAgent.handleTurn({
      clinicName: input.clinicName,
      clinicId: input.session.clinicId,
      sessionId: input.session.id,
      languageCode: input.languageCode,
      recentTurns: input.recentTurns.map((turn) => ({
        role: turn.role,
        text: turn.text,
      })),
      collected,
      messageText: input.messageText,
      patientPhone: input.session.patientPhone,
      lastAssistantMessageText: input.lastAssistantMessageText ?? null,
    });

    if (agentOutcome.kind !== 'agent') {
      this.logger.warn(
        JSON.stringify({
          event: 'orchestrator_agent_fallback',
          reason: agentOutcome.reason,
          sessionId: input.session.id,
        }),
      );
      return { handled: false, fallbackReason: agentOutcome.reason };
    }

    return {
      handled: true,
      result: this.buildAgentOrchestratorResult({
      flowBefore: input.flowBefore,
      stateBefore: input.stateBefore,
      languageCode: input.languageCode,
      agentResult: agentOutcome.result,
      ...(input.languageSource ? { languageSource: input.languageSource } : {}),
      }),
    };
  }

  private attachAgentFallbackDebug(
    result: OrchestratorResult,
    fallbackReason: string,
  ): OrchestratorResult {
    if (!this.env.DEBUG_API || this.env.NODE_ENV === 'production') {
      return result;
    }

    return {
      ...result,
      debug: {
        ...(result.debug ?? {}),
        agent_attempted: true,
        agent_llm_status: 'failed',
        agent_fallback: {
          reason: fallbackReason,
          message: `Agent LLM failed: ${fallbackReason}. Legacy handler used instead.`,
        },
      },
    };
  }

  private buildAgentOrchestratorResult(input: {
    flowBefore: string;
    stateBefore: string;
    languageCode: LanguageCode;
    agentResult: AgentTurnResult;
    languageSource?: 'patient_requested';
  }): OrchestratorResult {
    const collected = input.agentResult.updatedCollected;
    const parsed = parseBookingCollected(collected);

    let flowAfter = input.flowBefore;
    let stateAfter = input.stateBefore;
    let sessionStatus = input.agentResult.sessionStatus;

    if (sessionStatus === 'completed' || sessionStatus === 'escalated') {
      flowAfter = 'none';
      stateAfter = 'IDLE';
    } else if (hasBookingProgress(parsed) || collected.appointment_id) {
      flowAfter = BOOKING_FLOW;
      stateAfter =
        typeof collected.appointment_id === 'string' && collected.appointment_id.length > 0
          ? 'DONE'
          : inferBookingState(parsed);
    }

    return {
      intent: collected.appointment_id ? 'book_appointment' : 'agent_reply',
      templateKey: 'knowledge.answer',
      templateVariables: {},
      messageText: input.agentResult.replyText,
      flowBefore: input.flowBefore,
      stateBefore: input.stateBefore,
      flowAfter,
      stateAfter,
      languageCode: input.languageCode,
      collectedJson: collected,
      sessionStatus,
      ...(input.languageSource ? { languageSource: input.languageSource } : {}),
      debug: {
        handler: 'receptionist_agent',
        agent_attempted: true,
        agent_llm_status: 'success',
        tools_used: input.agentResult.toolsUsed,
        ...(input.agentResult.latencyMetrics
          ? { latency_metrics: input.agentResult.latencyMetrics }
          : {}),
        ...(input.agentResult.debug ?? {}),
      },
    };
  }

  private async handleLegacyPatientMessage(
    input: OrchestratorInput,
    context: {
      session: ConversationSessionRow;
      clinicName: string;
      messageText: string;
      languageCode: LanguageCode;
      switchedLanguage: LanguageCode | null;
      languageSource?: 'patient_requested';
    },
  ): Promise<OrchestratorResult> {
    const { clinicName, messageText } = input;
    const { languageCode, languageSource, switchedLanguage } = context;
    const session = applyPromptAwareSession(resumeBookingSession(input.session));
    const resumedCollected = parseBookingCollected(session.collectedJson);

    let routingSessionForDialog = applyPromptAwareSession(resumeBookingSession(input.session));
    const resumedCollectedForDialog = parseBookingCollected(routingSessionForDialog.collectedJson);
    if (
      hasBookingProgress(resumedCollectedForDialog) &&
      routingSessionForDialog.currentFlow !== BOOKING_FLOW &&
      routingSessionForDialog.currentFlow !== RESCHEDULE_FLOW &&
      routingSessionForDialog.currentFlow !== CANCEL_FLOW &&
      routingSessionForDialog.currentFlow !== HANDOFF_FLOW
    ) {
      routingSessionForDialog = {
        ...routingSessionForDialog,
        currentFlow: BOOKING_FLOW,
        currentState:
          routingSessionForDialog.currentState === 'IDLE' ||
          routingSessionForDialog.currentState === 'BOOKING_STARTED' ||
          routingSessionForDialog.currentState === 'DONE'
            ? inferBookingState(resumedCollectedForDialog)
            : routingSessionForDialog.currentState,
        collectedJson: routingSessionForDialog.collectedJson,
      };
    }

    const dialogRoute = await this.tryReceptionistDialogRoute({
      session: routingSessionForDialog,
      clinicName,
      messageText,
      languageCode,
      ...(languageSource ? { languageSource } : {}),
      flowBefore: routingSessionForDialog.currentFlow,
      stateBefore: routingSessionForDialog.currentState,
      lastAssistantMessageText: input.lastAssistantMessageText ?? null,
      lastAssistantTemplateKey: input.lastAssistantTemplateKey ?? null,
      recentTurns: input.recentTurns ?? [],
    });
    if (dialogRoute.result) {
      return dialogRoute.result;
    }

    const preRouteFlow = session.currentFlow;
    const preRouteState = session.currentState;
    const preRouteCollected = (session.collectedJson ?? {}) as Record<string, unknown>;
    const activePromptUsed = hasActiveBookingPrompt(preRouteCollected);
    let llmRuntime = resolveLlmRuntimeSettings(session.channel, this.env);
    if (!dialogRoute.result) {
      llmRuntime = strengthenLlmRuntimeForDialogDelegation(llmRuntime);
    }
    const useActiveStateInterpreter =
      isActiveStateInterpreterContext(preRouteFlow, preRouteState, preRouteCollected) &&
      !switchedLanguage;

    let classification: IntentClassifierResult;
    let genericClassifierCalled = false;
    let intentClassifierLlm: LlmInvocationDebug | null = null;

    if (useActiveStateInterpreter) {
      const safety = detectMessageSafety(messageText);
      if (safety.isEmergency || safety.isMedicalAdviceRequest) {
        classification = buildSafetyClassification(languageCode, safety);
        intentClassifierLlm = skippedClassifierLlmDebug('message_safety');
      } else if (llmRuntime.skipActiveFlowClassifier) {
        const quickClassification =
          tryDeterministicIntentClassification({
            clinicId: session.clinicId,
            sessionId: session.id,
            messageText,
            currentFlow: session.currentFlow,
            currentState: session.currentState,
            languageCode,
            knownCollectedFields: parseBookingCollected(session.collectedJson),
            llmRuntime,
          }) ?? buildActiveFlowClassification(languageCode);
        classification =
          isActiveFlowClassifierInterrupt(quickClassification.intent) ||
          quickClassification.safety.isEmergency ||
          quickClassification.safety.isMedicalAdviceRequest
            ? quickClassification
            : buildActiveFlowClassification(languageCode);
        intentClassifierLlm = skippedClassifierLlmDebug('active_flow_fast_mode');
      } else {
        genericClassifierCalled = true;
        const llmClassification = await this.intentClassifier.classify({
          clinicId: session.clinicId,
          sessionId: session.id,
          messageText,
          currentFlow: session.currentFlow,
          currentState: session.currentState,
          languageCode,
          knownCollectedFields: parseBookingCollected(session.collectedJson),
          llmRuntime,
        });
        intentClassifierLlm = llmClassification.llmDebug ?? null;
        classification =
          isActiveFlowClassifierInterrupt(llmClassification.intent) ||
          llmClassification.safety.isEmergency ||
          llmClassification.safety.isMedicalAdviceRequest
            ? llmClassification
            : buildActiveFlowClassification(languageCode);
      }
    } else {
      genericClassifierCalled = true;
      classification = await this.intentClassifier.classify({
        clinicId: session.clinicId,
        sessionId: session.id,
        messageText,
        currentFlow: session.currentFlow,
        currentState: session.currentState,
        languageCode,
        knownCollectedFields: parseBookingCollected(session.collectedJson),
        llmRuntime,
      });
      intentClassifierLlm = classification.llmDebug ?? null;
    }

    const normalization = normalizeIntentClassification(classification, {
      collected: preRouteCollected,
      currentFlow: preRouteFlow,
      currentState: preRouteState,
    });
    classification = normalization.classification;
    const nluTrace = {
      raw_llm_intent: normalization.rawIntent,
      normalized_intent: normalization.normalizedIntent,
      normalization_reason: normalization.normalizationReason,
      active_prompt_used: activePromptUsed,
      generic_classifier_called: genericClassifierCalled,
      state_entity_extractor_called: useActiveStateInterpreter,
    };

    let intent = classification.intent;
    if (switchedLanguage) {
      intent = 'language_switch';
    }
    if (
      hasBookingProgress(resumedCollected) &&
      (intent === 'greeting' || intent === 'greeting_smalltalk' || intent === 'unknown')
    ) {
      intent = 'book_appointment';
    }
    if (
      session.currentFlow === BOOKING_FLOW &&
      (intent === 'greeting' || intent === 'greeting_smalltalk' || intent === 'unknown')
    ) {
      intent = 'active_flow_answer';
    }

    const interruptsFlow = isFlowInterrupt(intent, classification);
    const reactivateCompletedSession = session.status === 'completed' && interruptsFlow;
    let routingSession = resolveRoutingSession(session, reactivateCompletedSession);
    routingSession = clearCompletedLifecycleFlow(routingSession, intent);
    if (
      hasBookingProgress(resumedCollected) &&
      routingSession.currentFlow !== BOOKING_FLOW &&
      routingSession.currentFlow !== RESCHEDULE_FLOW &&
      routingSession.currentFlow !== CANCEL_FLOW &&
      routingSession.currentFlow !== HANDOFF_FLOW
    ) {
      routingSession = {
        ...routingSession,
        currentFlow: BOOKING_FLOW,
        currentState:
          routingSession.currentState === 'IDLE' ||
          routingSession.currentState === 'BOOKING_STARTED' ||
          routingSession.currentState === 'DONE'
            ? inferBookingState(resumedCollected)
            : routingSession.currentState,
        collectedJson: session.collectedJson,
      };
    }
    const flowBefore = routingSession.currentFlow;
    const stateBefore = routingSession.currentState;

    const clinicIdentityAnswer = await this.unknownQuestionHandler.tryClinicIdentityAnswer({
      session: routingSession,
      clinicName,
      messageText,
      languageCode,
      flowBefore,
      stateBefore,
    });
    if (clinicIdentityAnswer) {
      return {
        ...clinicIdentityAnswer,
        ...(languageSource ? { languageSource } : {}),
      };
    }

    if (session.status === 'completed' && !interruptsFlow) {
      return {
        intent: 'acknowledgment',
        templateKey: 'booking.thank_you',
        templateVariables: { clinic_name: clinicName },
        flowBefore: session.currentFlow,
        stateBefore: session.currentState,
        flowAfter: 'none',
        stateAfter: 'IDLE',
        languageCode,
        collectedJson: {},
        sessionStatus: 'completed',
        ...(languageSource ? { languageSource } : {}),
      };
    }

    const collected = parseBookingCollected(routingSession.collectedJson);
    const rawCollected = (routingSession.collectedJson ?? {}) as Record<string, unknown>;
    const terminalAck = readAwaitingTerminalAck(collected) ?? readAwaitingTerminalAck(rawCollected);

    if (!interruptsFlow && !isActiveLifecycleStep(flowBefore, stateBefore) && terminalAck) {
      const interpretation = await this.activeStateService.interpret({
        clinicId: routingSession.clinicId,
        sessionId: routingSession.id,
        currentFlow: flowBefore,
        currentState: stateBefore,
        languageCode,
        messageText,
        timezone: 'Asia/Kolkata',
        collected: rawCollected,
        channel: routingSession.channel,
        llmRuntime,
        lastAssistantMessageText: input.lastAssistantMessageText ?? null,
        lastAssistantTemplateKey: input.lastAssistantTemplateKey ?? null,
        recentTurns: input.recentTurns ?? [],
      });
      const outcome = resolveTerminalAckOutcome(terminalAck, interpretation.result);
      if (outcome.kind === 'offer_help') {
        return {
          intent: 'acknowledgment',
          templateKey: 'booking.offer_help',
          templateVariables: { clinic_name: clinicName },
          flowBefore,
          stateBefore,
          flowAfter: 'none',
          stateAfter: 'IDLE',
          languageCode,
          collectedJson: { awaiting_terminal_ack: 'offer_help' },
          sessionStatus: 'active',
          ...(languageSource ? { languageSource } : {}),
        };
      }
      if (outcome.kind === 'thank_you') {
        return {
          intent: 'acknowledgment',
          templateKey: 'booking.thank_you',
          templateVariables: { clinic_name: clinicName },
          flowBefore,
          stateBefore,
          flowAfter: 'none',
          stateAfter: 'IDLE',
          languageCode,
          collectedJson: {},
          sessionStatus: 'completed',
          ...(languageSource ? { languageSource } : {}),
        };
      }
      if (outcome.kind === 'ask_what_help') {
        return {
          intent: 'acknowledgment',
          templateKey: 'booking.ask_what_help',
          templateVariables: { clinic_name: clinicName },
          flowBefore,
          stateBefore,
          flowAfter: 'none',
          stateAfter: 'IDLE',
          languageCode,
          collectedJson: { awaiting_terminal_ack: 'awaiting_help_topic' },
          sessionStatus: 'active',
          ...(languageSource ? { languageSource } : {}),
        };
      }
      if (outcome.kind === 'greeting') {
        return {
          intent: 'book_appointment',
          templateKey: 'booking.greeting',
          templateVariables: { clinic_name: clinicName },
          flowBefore,
          stateBefore,
          flowAfter: 'none',
          stateAfter: 'IDLE',
          languageCode,
          collectedJson: {},
          sessionStatus: 'active',
          ...(languageSource ? { languageSource } : {}),
        };
      }
    }

    if (classification.safety.isEmergency) {
      const emergencyResult = await this.emergencyHandler.handle({
        session: routingSession,
        messageText,
        classification,
        flowBefore,
        stateBefore,
        languageCode,
      });
      return {
        ...emergencyResult,
        ...(languageSource ? { languageSource } : {}),
        ...(this.env.DEBUG_API && this.env.NODE_ENV !== 'production'
          ? {
              debug: {
                handler: 'a05_emergency',
                classification,
                generic_classifier_called: genericClassifierCalled,
              },
            }
          : {}),
      };
    }

    if (classification.safety.isMedicalAdviceRequest) {
      const policy = resolveGlobalIntentPolicy({
        intent: 'medical_advice_request',
        flowBefore,
        safety: classification.safety,
      });
      if (policy?.resumeFlow) {
        const rendered = await this.templateRenderer.render(
          policy.templateKey,
          languageCode,
          { clinic_name: clinicName },
        );
        const answerText = await appendBookingResumeText(
          this.templateRenderer,
          rendered.message_text,
          routingSession,
          parseBookingCollected(routingSession.collectedJson) as Record<string, unknown>,
          { clinicName, resumeState: stateBefore },
        );
        return {
          intent: 'medical_advice_request',
          templateKey: 'knowledge.answer',
          templateVariables: { answer_text: answerText },
          flowBefore,
          stateBefore,
          flowAfter: flowBefore,
          stateAfter: stateBefore,
          languageCode,
          collectedJson: parseBookingCollected(routingSession.collectedJson) as Record<
            string,
            unknown
          >,
          ...(languageSource ? { languageSource } : {}),
          ...(this.env.DEBUG_API && this.env.NODE_ENV !== 'production'
            ? {
                debug: {
                  handler: 'a17_medical_advice_resume',
                  classification,
                  generic_classifier_called: genericClassifierCalled,
                },
              }
            : {}),
        };
      }
      return this.safetyResult({
        session: routingSession,
        flowBefore,
        stateBefore,
        languageCode,
        templateKey: isActiveReceptionistFlow(flowBefore)
          ? 'safety.medical_advice_refusal_resume'
          : 'safety.medical_advice_refusal',
        intent: 'medical_advice_request',
        classification,
        genericClassifierCalled,
        ...(languageSource ? { languageSource } : {}),
      });
    }

    if (useActiveStateInterpreter) {
      const activeResult = await this.routeActiveFlowMachine({
        routingSession,
        clinicName,
        messageText,
        classification,
        flowBefore,
        stateBefore,
        languageCode,
        intent,
        intentClassifierLlm,
        genericClassifierCalled,
        nluTrace,
        llmRuntime,
        lastAssistantMessageText: input.lastAssistantMessageText ?? null,
        lastAssistantTemplateKey: input.lastAssistantTemplateKey ?? null,
        recentTurns: input.recentTurns ?? [],
        ...(languageSource ? { languageSource } : {}),
      });
      if (activeResult) {
        return activeResult;
      }
    }

    const capability = resolveCapabilityForIntent(intent);
    const isStructuredOrKnowledgeIntent = shouldRouteToStructuredInfoHandler(intent);

    if (flowBefore === FEE_CLARIFICATION_FLOW || isStructuredOrKnowledgeIntent) {
      const structuredResult = await this.structuredInfoHandler.handle({
        session: routingSession,
        messageText,
        classification,
      });

      return {
        intent: structuredResult.intent,
        templateKey: structuredResult.templateKey,
        templateVariables: structuredResult.templateVariables,
        flowBefore: structuredResult.flowBefore,
        stateBefore: structuredResult.stateBefore,
        flowAfter: structuredResult.flowAfter,
        stateAfter: structuredResult.stateAfter,
        languageCode,
        collectedJson: structuredResult.collectedJson,
        ...(languageSource ? { languageSource } : {}),
        ...(this.env.DEBUG_API && this.env.NODE_ENV !== 'production'
          ? {
              debug: this.enrichDebugWithNlu(
                {
                  handler: 'a04_structured_info',
                  capability: capability.key,
                  source_of_truth: capability.sourceOfTruth,
                  classification,
                },
                { intentClassifierLlm, genericClassifierCalled },
              ),
            }
          : {}),
      };
    }

    const shouldRunCancel =
      flowBefore === CANCEL_FLOW ||
      (CANCEL_INTENTS.has(intent) && intent !== 'language_switch');

    if (shouldRunCancel && intent !== 'language_switch') {
      const cancelResult = await this.cancelMachine.handle({
        session: routingSession,
        clinicName,
        messageText,
        classification,
      });
      return this.wrapLifecycleResult(cancelResult, languageCode, languageSource, 'a05_cancel');
    }

    const shouldRunReschedule =
      flowBefore === RESCHEDULE_FLOW ||
      (RESCHEDULE_INTENTS.has(intent) && intent !== 'language_switch');

    if (shouldRunReschedule && intent !== 'language_switch') {
      const rescheduleResult = await this.rescheduleMachine.handle({
        session: routingSession,
        clinicName,
        messageText,
        classification,
      });
      return this.wrapLifecycleResult(rescheduleResult, languageCode, languageSource, 'a05_reschedule');
    }

    const shouldRunHandoff =
      flowBefore === HANDOFF_FLOW ||
      (HANDOFF_INTENTS.has(intent) && intent !== 'language_switch');

    if (shouldRunHandoff && intent !== 'language_switch') {
      const handoffResult = await this.handoffMachine.handle({
        session: routingSession,
        clinicName,
        messageText,
        classification,
      });
      return this.wrapLifecycleResult(handoffResult, languageCode, languageSource, 'a05_handoff');
    }

    if (
      (intent === 'greeting' || intent === 'greeting_smalltalk') &&
      flowBefore === 'none' &&
      stateBefore === 'IDLE' &&
      !classification.entities.reasonForVisit
    ) {
      const partialBooking = parseBookingCollected(rawCollected);
      if (hasBookingProgress(partialBooking)) {
        intent = 'book_appointment';
        routingSession = {
          ...routingSession,
          currentFlow: BOOKING_FLOW,
          currentState: inferBookingState(partialBooking),
        };
      } else {
        const collectedJson: Record<string, unknown> = attachActivePrompt(
          this.llmFailureHandler.clearFailureCount({}),
          buildActivePromptSnapshot('ASK_PROBLEM_OR_DOCTOR', 'booking.greeting', {
            flow: BOOKING_FLOW,
            expectedFields: ['reason', 'doctor', 'date', 'time_preference'],
          }),
        );
        if (classification.entities.patientName) {
          collectedJson.patient_name = classification.entities.patientName;
        }
        return {
          intent: 'greeting',
          templateKey: 'booking.greeting',
          templateVariables: { clinic_name: clinicName },
          flowBefore,
          stateBefore,
          flowAfter: BOOKING_FLOW,
          stateAfter: 'ASK_PROBLEM_OR_DOCTOR',
          languageCode,
          collectedJson,
          sessionStatus: 'active',
          ...(languageSource ? { languageSource } : {}),
          ...(this.env.DEBUG_API && this.env.NODE_ENV !== 'production'
            ? {
                debug: {
                  ...nluTrace,
                  final_handler: 'a01_classifier_greeting',
                  handler: 'a01_classifier',
                  llm_provider: this.env.PRIMARY_LLM_PROVIDER,
                  intent_classifier: 'called',
                  classification,
                  language_switch_detected: switchedLanguage !== null,
                },
              }
            : {}),
        };
      }
    }

    const shouldRunBooking =
      flowBefore === BOOKING_FLOW ||
      (BOOKING_INTENTS.has(intent) && intent !== 'language_switch');

    if (shouldRunBooking && intent !== 'language_switch') {
      const bookingResult = await this.bookingMachine.handle({
        session: routingSession,
        clinicName,
        messageText,
        classification,
        llmRuntime,
        lastAssistantMessageText: input.lastAssistantMessageText ?? null,
        lastAssistantTemplateKey: input.lastAssistantTemplateKey ?? null,
        recentTurns: input.recentTurns ?? [],
      });

      return this.wrapBookingOrchestratorResult(bookingResult, {
        languageCode,
        ...(languageSource ? { languageSource } : {}),
        intentClassifierLlm,
        genericClassifierCalled,
        nluTrace,
      });
    }

    if (
      flowBefore === 'none' &&
      stateBefore === 'IDLE' &&
      intent === 'acknowledgment'
    ) {
      return {
        intent: 'acknowledgment',
        templateKey: 'booking.offer_help',
        templateVariables: { clinic_name: clinicName },
        flowBefore,
        stateBefore,
        flowAfter: 'none',
        stateAfter: 'IDLE',
        languageCode,
        collectedJson: { awaiting_terminal_ack: 'offer_help' },
        sessionStatus: 'active',
        ...(languageSource ? { languageSource } : {}),
      };
    }

    let templateKey = templateKeyForIntent(intent);
    if (intent === 'unknown' && flowBefore === 'none' && stateBefore === 'IDLE') {
      const looksLikeQuestion = /[?？]\s*$/u.test(messageText);
      if (looksLikeQuestion) {
        const knowledgeHit = await this.knowledgeSearch.searchApprovedKnowledge(
          routingSession.clinicId,
          messageText,
        );
        const hasAnswer = Boolean(knowledgeHit?.meetsThreshold);
        const rendered = await this.templateRenderer.render(
          hasAnswer ? 'knowledge.answer' : 'knowledge.no_answer',
          languageCode,
          hasAnswer ? { answer_text: knowledgeHit!.answer } : {},
        );
        return {
          intent: hasAnswer ? 'ask_previsit_instruction' : 'unknown',
          templateKey: rendered.template_key,
          templateVariables: hasAnswer ? { answer_text: knowledgeHit!.answer } : {},
          flowBefore,
          stateBefore,
          flowAfter: 'none',
          stateAfter: 'IDLE',
          languageCode,
          collectedJson: parseBookingCollected(
            routingSession.collectedJson,
          ) as Record<string, unknown>,
          ...(languageSource ? { languageSource } : {}),
          ...(this.env.DEBUG_API && this.env.NODE_ENV !== 'production'
            ? {
                debug: {
                  handler: 'a01_classifier',
                  intent_classifier: 'called',
                  generic_classifier_called: genericClassifierCalled,
                  classification,
                  language_switch_detected: switchedLanguage !== null,
                  knowledge_fallback: 'unknown_question',
                },
              }
            : {}),
        };
      }
      templateKey = 'booking.greeting';
      intent = 'unknown';
    }

    templateKey = templateKeyForIntent(intent);
    if (intent === 'language_switch') {
      templateKey = switchedLanguage ? 'booking.greeting' : 'language.switched';
    }

    const rendered = await this.templateRenderer.render(templateKey, languageCode, {
      clinic_name: clinicName,
    });

    const verboseDebug = this.env.DEBUG_API && this.env.NODE_ENV !== 'production';
    const debug = verboseDebug
      ? this.enrichDebugWithNlu(
          {
            handler: 'a01_classifier',
            llm_provider: this.env.PRIMARY_LLM_PROVIDER,
            intent_classifier: 'called',
            classification,
            language_switch_detected: switchedLanguage !== null,
          },
          { intentClassifierLlm, genericClassifierCalled },
        )
      : {
          classification,
          handler: 'a01_classifier',
        };

    return {
      intent,
      templateKey: rendered.template_key,
      templateVariables: { clinic_name: clinicName },
      flowBefore,
      stateBefore,
      flowAfter: flowBefore,
      stateAfter: stateBefore,
      languageCode,
      collectedJson: this.llmFailureHandler.clearFailureCount(
        parseBookingCollected(routingSession.collectedJson) as Record<string, unknown>,
      ),
      ...(languageSource ? { languageSource } : {}),
      debug,
    };
  }

  private async routeActiveFlowMachine(input: {
    routingSession: ConversationSessionRow;
    clinicName: string;
    messageText: string;
    classification: IntentClassifierResult;
    flowBefore: string;
    stateBefore: string;
    languageCode: LanguageCode;
    languageSource?: 'patient_requested';
    intent: string;
    intentClassifierLlm: LlmInvocationDebug | null;
    genericClassifierCalled: boolean;
    nluTrace: Record<string, unknown>;
    llmRuntime: import('@vaidya/shared').LlmRuntimeSettings;
    lastAssistantMessageText?: string | null;
    lastAssistantTemplateKey?: string | null;
    recentTurns?: ReceptionistConversationTurn[];
  }): Promise<OrchestratorResult | null> {
    const {
      routingSession,
      clinicName,
      messageText,
      classification,
      flowBefore,
      languageCode,
      languageSource,
      intent,
      intentClassifierLlm,
      genericClassifierCalled,
      nluTrace,
      llmRuntime,
      lastAssistantMessageText,
      lastAssistantTemplateKey,
      recentTurns,
    } = input;

    if (CANCEL_INTENTS.has(intent) && intent !== 'active_flow_answer') {
      const cancelResult = await this.cancelMachine.handle({
        session: routingSession,
        clinicName,
        messageText,
        classification,
      });
      return this.wrapLifecycleResult(cancelResult, languageCode, languageSource, 'a05_cancel');
    }

    if (RESCHEDULE_INTENTS.has(intent) && intent !== 'active_flow_answer') {
      const rescheduleResult = await this.rescheduleMachine.handle({
        session: routingSession,
        clinicName,
        messageText,
        classification,
      });
      return this.wrapLifecycleResult(rescheduleResult, languageCode, languageSource, 'a05_reschedule');
    }

    if (HANDOFF_INTENTS.has(intent) && intent !== 'active_flow_answer') {
      const handoffResult = await this.handoffMachine.handle({
        session: routingSession,
        clinicName,
        messageText,
        classification,
      });
      return this.wrapLifecycleResult(handoffResult, languageCode, languageSource, 'a05_handoff');
    }

    if (flowBefore === CANCEL_FLOW) {
      const cancelResult = await this.cancelMachine.handle({
        session: routingSession,
        clinicName,
        messageText,
        classification,
      });
      return this.wrapLifecycleResult(cancelResult, languageCode, languageSource, 'a05_cancel');
    }

    if (flowBefore === RESCHEDULE_FLOW) {
      const rescheduleResult = await this.rescheduleMachine.handle({
        session: routingSession,
        clinicName,
        messageText,
        classification,
      });
      return this.wrapLifecycleResult(rescheduleResult, languageCode, languageSource, 'a05_reschedule');
    }

    if (flowBefore === HANDOFF_FLOW) {
      const handoffResult = await this.handoffMachine.handle({
        session: routingSession,
        clinicName,
        messageText,
        classification,
      });
      return this.wrapLifecycleResult(handoffResult, languageCode, languageSource, 'a05_handoff');
    }

    if (flowBefore === BOOKING_FLOW) {
      const bookingResult = await this.bookingMachine.handle({
        session: routingSession,
        clinicName,
        messageText,
        classification,
        llmRuntime,
        lastAssistantMessageText: lastAssistantMessageText ?? null,
        lastAssistantTemplateKey: lastAssistantTemplateKey ?? null,
        recentTurns: recentTurns ?? [],
      });
      return this.wrapBookingOrchestratorResult(bookingResult, {
        languageCode,
        ...(languageSource ? { languageSource } : {}),
        intentClassifierLlm,
        genericClassifierCalled,
        nluTrace: input.nluTrace,
        finalHandler: 'a02_booking_machine_active_flow',
      });
    }

    return null;
  }

  private wrapBookingOrchestratorResult(
    bookingResult: {
      intent: string;
      templateKey: string;
      templateVariables: Record<string, string>;
      flowBefore: string;
      stateBefore: string;
      flowAfter: string;
      stateAfter: string;
      collectedJson: Record<string, unknown>;
      sessionStatus?: 'active' | 'completed' | 'escalated';
      debug?: Record<string, unknown>;
    },
    input: {
      languageCode: LanguageCode;
      languageSource?: 'patient_requested' | undefined;
      intentClassifierLlm: LlmInvocationDebug | null;
      genericClassifierCalled: boolean;
      nluTrace: Record<string, unknown>;
      finalHandler?: string;
    },
  ): OrchestratorResult {
    const verboseDebug = this.env.DEBUG_API && this.env.NODE_ENV !== 'production';
    const debugPayload =
      verboseDebug || bookingResult.debug
        ? this.enrichDebugWithNlu(
            {
              ...(bookingResult.debug ?? {}),
              ...input.nluTrace,
              final_handler: input.finalHandler ?? 'a02_booking_machine',
            },
            {
              intentClassifierLlm: input.intentClassifierLlm,
              genericClassifierCalled: input.genericClassifierCalled,
            },
          )
        : undefined;

    return {
      intent: bookingResult.intent,
      templateKey: bookingResult.templateKey,
      templateVariables: bookingResult.templateVariables,
      flowBefore: bookingResult.flowBefore,
      stateBefore: bookingResult.stateBefore,
      flowAfter: bookingResult.flowAfter,
      stateAfter: bookingResult.stateAfter,
      languageCode: input.languageCode,
      collectedJson: this.llmFailureHandler.clearFailureCount(bookingResult.collectedJson),
      ...(bookingResult.sessionStatus ? { sessionStatus: bookingResult.sessionStatus } : {}),
      ...(input.languageSource ? { languageSource: input.languageSource } : {}),
      ...(debugPayload ? { debug: debugPayload } : {}),
    };
  }

  private wrapLifecycleResult(
    result: {
      intent: string;
      templateKey: string;
      templateVariables: Record<string, string>;
      flowBefore: string;
      stateBefore: string;
      flowAfter: string;
      stateAfter: string;
      collectedJson: Record<string, unknown>;
      sessionStatus?: 'active' | 'completed' | 'escalated';
    },
    languageCode: LanguageCode,
    languageSource: 'patient_requested' | undefined,
    handler: string,
  ): OrchestratorResult {
    return {
      intent: result.intent,
      templateKey: result.templateKey,
      templateVariables: result.templateVariables,
      flowBefore: result.flowBefore,
      stateBefore: result.stateBefore,
      flowAfter: result.flowAfter,
      stateAfter: result.stateAfter,
      languageCode,
      collectedJson: result.collectedJson,
      ...(result.sessionStatus ? { sessionStatus: result.sessionStatus } : {}),
      ...(languageSource ? { languageSource } : {}),
      ...(this.env.DEBUG_API && this.env.NODE_ENV !== 'production'
        ? {
            debug: {
              handler,
            },
          }
        : {}),
    };
  }

  private enrichDebugWithNlu(
    debug: Record<string, unknown>,
    input: {
      intentClassifierLlm: LlmInvocationDebug | null;
      genericClassifierCalled: boolean;
    },
  ): Record<string, unknown> {
    const stateEntityLlm =
      (debug.llm as LlmInvocationDebug | null | undefined) ??
      ((debug as { state_entity_extractor_llm?: LlmInvocationDebug | null }).state_entity_extractor_llm ??
        null);

    return {
      ...debug,
      generic_classifier_called: input.genericClassifierCalled,
      intent_classifier_llm: input.intentClassifierLlm,
      state_entity_extractor_llm: stateEntityLlm,
      llm_path_summary: summarizeLlmPath(input.intentClassifierLlm, stateEntityLlm),
    };
  }

  private safetyResult(input: {
    session: ConversationSessionRow;
    flowBefore: string;
    stateBefore: string;
    languageCode: LanguageCode;
    templateKey: 'safety.emergency' | 'safety.emergency_active_flow' | 'safety.medical_advice_refusal' | 'safety.medical_advice_refusal_resume';
    intent: string;
    classification: IntentClassifierResult;
    genericClassifierCalled?: boolean;
    languageSource?: 'patient_requested';
  }): OrchestratorResult {
    return {
      intent: input.intent,
      templateKey: input.templateKey,
      templateVariables: {},
      flowBefore: input.flowBefore,
      stateBefore: input.stateBefore,
      flowAfter: input.flowBefore,
      stateAfter: input.stateBefore,
      languageCode: input.languageCode,
      collectedJson: parseBookingCollected(input.session.collectedJson) as Record<string, unknown>,
      ...(input.languageSource ? { languageSource: input.languageSource } : {}),
      ...(this.env.DEBUG_API && this.env.NODE_ENV !== 'production'
        ? {
            debug: {
              handler: 'a01_classifier',
              classification: input.classification,
              generic_classifier_called: input.genericClassifierCalled ?? true,
            },
          }
        : {}),
    };
  }
}
