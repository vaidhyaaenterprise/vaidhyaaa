import { Inject, Injectable, Logger } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import { formatDateInTimezone } from '@vaidya/db';
import {
  ADAPTER_TOKENS,
  expectedFieldsForState,
  isActiveStateInterpreterContext,
  resolveInterpreterContext,
  resolveLlmRuntimeSettings,
  type LlmRuntimeSettings,
  type ReceptionistConversationTurn,
  type StateEntityExtractorAdapter,
  type StateEntityExtractorInput,
  type StateEntityExtractorResult,
} from '@vaidya/shared';

import { API_ENV } from '../../config/api-config.module';

export type ActiveStateInterpretation = {
  result: StateEntityExtractorResult;
  debug: {
    flow: string;
    state: string;
    interpreter: 'state_entity_extractor';
    recognized_as: string;
    generic_classifier_called: false;
    state_entity_extractor_provider: 'mock' | 'sarvam' | 'composite';
    deterministic_parser_used: boolean;
    llm_call_skipped: boolean;
    confidence: number;
    side_question: boolean;
    entities: StateEntityExtractorResult['entities'];
    llm: import('@vaidya/shared').LlmInvocationDebug | null;
  };
};

@Injectable()
export class ActiveStateInterpretationLogger {
  private readonly logger = new Logger(ActiveStateInterpretationLogger.name);

  log(input: {
    clinicId: string;
    sessionId: string;
    currentFlow: string;
    currentState: string;
    provider: 'mock' | 'sarvam' | 'composite';
    result: StateEntityExtractorResult;
    deterministicParserUsed?: boolean;
    llmCallSkipped?: boolean;
    safetyOverride?: boolean;
  }): void {
    this.logger.log(
      JSON.stringify({
        clinic_id: input.clinicId,
        session_id: input.sessionId,
        current_flow: input.currentFlow,
        current_state: input.currentState,
        active_state_interpreter_called: true,
        generic_intent_classifier_called: false,
        state_entity_extractor_provider: input.provider,
        deterministic_parser_used: input.deterministicParserUsed ?? false,
        llm_call_skipped: input.llmCallSkipped ?? false,
        recognized_as: input.result.recognizedAs,
        confidence: input.result.confidence,
        safety_override: input.safetyOverride ?? false,
        side_question: input.result.recognizedAs === 'side_question',
      }),
    );
  }
}

@Injectable()
export class ActiveStateInterpretationService {
  constructor(
    @Inject(ADAPTER_TOKENS.StateEntityExtractorAdapter)
    private readonly extractor: StateEntityExtractorAdapter,
    @Inject(ActiveStateInterpretationLogger)
    private readonly interpretationLogger: ActiveStateInterpretationLogger,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  shouldInterpret(
    flow: string,
    state: string,
    collected?: Record<string, unknown>,
  ): boolean {
    return isActiveStateInterpreterContext(flow, state, collected);
  }

  async interpret(input: {
    clinicId: string;
    sessionId: string;
    currentFlow: string;
    currentState: string;
    languageCode: string;
    messageText: string;
    timezone: string;
    collected: Record<string, unknown>;
    channel?: string;
    llmRuntime?: LlmRuntimeSettings;
    offeredSlots?: StateEntityExtractorInput['offeredSlots'];
    lastAssistantMessageText?: string | null;
    lastAssistantTemplateKey?: string | null;
    recentTurns?: ReceptionistConversationTurn[];
  }): Promise<ActiveStateInterpretation> {
    const llmRuntime =
      input.llmRuntime ??
      resolveLlmRuntimeSettings(input.channel ?? 'web_demo', this.env);
    const referenceDate = formatDateInTimezone(new Date(), input.timezone);
    const resolved = resolveInterpreterContext({
      currentFlow: input.currentFlow,
      currentState: input.currentState,
      collected: input.collected,
    });
    const extractorInput: StateEntityExtractorInput = {
      clinicId: input.clinicId,
      sessionId: input.sessionId,
      currentFlow: resolved.flow,
      currentState: resolved.state,
      languageCode: input.languageCode,
      messageText: input.messageText,
      timezone: input.timezone,
      referenceDate,
      collected: input.collected,
      expectedFields: expectedFieldsForState(resolved.flow, resolved.state),
      llmRuntime,
      ...(input.offeredSlots ? { offeredSlots: input.offeredSlots } : {}),
      ...(input.lastAssistantMessageText
        ? { lastAssistantMessageText: input.lastAssistantMessageText }
        : {}),
      ...(input.lastAssistantTemplateKey
        ? { lastAssistantTemplateKey: input.lastAssistantTemplateKey }
        : {}),
      ...(input.recentTurns?.length ? { recentTurns: input.recentTurns } : {}),
    };

    const provider =
      this.env.ACTIVE_STATE_INTERPRETER_PROVIDER === 'composite'
        ? 'composite'
        : this.env.STATE_ENTITY_EXTRACTOR_PROVIDER;
    const result = await this.extractor.extract(extractorInput);
    const llmDebug = result.llmDebug;
    const deterministicParserUsed = llmDebug?.provider === 'deterministic';
    const llmCallSkipped = llmDebug?.llm_called === false;

    this.interpretationLogger.log({
      clinicId: input.clinicId,
      sessionId: input.sessionId,
      currentFlow: resolved.flow,
      currentState: resolved.state,
      provider,
      result,
      deterministicParserUsed,
      llmCallSkipped,
    });

    return {
      result,
      debug: {
        flow: resolved.flow,
        state: resolved.state,
        interpreter: 'state_entity_extractor',
        recognized_as: result.recognizedAs,
        generic_classifier_called: false,
        state_entity_extractor_provider: provider,
        deterministic_parser_used: deterministicParserUsed,
        llm_call_skipped: llmCallSkipped,
        confidence: result.confidence,
        side_question: result.recognizedAs === 'side_question',
        entities: result.entities,
        llm: llmDebug ?? null,
      },
    };
  }
}
