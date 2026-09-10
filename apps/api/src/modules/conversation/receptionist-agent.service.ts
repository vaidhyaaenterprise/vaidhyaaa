import { Inject, Injectable, Logger } from '@nestjs/common';

import { type ApiEnv } from '@vaidya/config';
import { formatDateInTimezone } from '@vaidya/db';
import {
  buildReceptionistAgentBookingContext,
  buildBookingContextForCollected,
  buildReceptionistAgentSystemPromptForProvider,
  detectMessageSafety,
  extractActiveExactTime,
  extractAgentBookingFieldPatch,
  inferBookingState,
  parseBookingCollected,
  resolveBookingGuidedReply,
  shouldSteerBookingReply,
  type LlmChatMessage,
  type LlmToolCall,
  type LlmToolDefinition,
} from '@vaidya/shared';

import { API_ENV } from '../../config/api-config.module';

import { AgentTurnAuditService } from './agent-turn-audit.service';
import {
  evaluateAgentFastPath,
  type AgentFastPathMatch,
} from './receptionist-agent-fast-path';
import { isAmbiguousShortReply } from './receptionist-agent-confirmation';
import { getReceptionistAgentToolsForRequest } from './receptionist-agent-tool-selection';
import {
  RECEPTIONIST_AGENT_TOOL_NAMES,
  ReceptionistAgentToolsService,
  type ReceptionistAgentToolContext,
  type ReceptionistAgentToolName,
} from './receptionist-agent-tools';
import {
  buildAllowedFactSnapshot,
  detectUngroundedFacts,
  UNGROUNDED_REPLY_FALLBACK,
  type AgentToolResultRecord,
} from './receptionist-agent-output-guard';
import {
  RECEPTIONIST_AGENT_LLM_PORT,
  type AgentTurnInput,
  type AgentTurnLatencyMetrics,
  type AgentTurnOutcome,
  type AgentSessionStatus,
  type ReceptionistAgentLlmPort,
} from './receptionist-agent.types';

const AGENT_TEMPERATURE = 0.3;
const MAX_RECENT_TURNS = 8;
const MIN_LLM_TIMEOUT_MS = 500;

const MEDICAL_ADVICE_REFUSAL_REPLY =
  "I can't advise on medicines or medical questions, but I can book you with a doctor. Shall I check available slots?";

const TURN_TIMEOUT_FALLBACK =
  'Give me one moment — a clinic staff member will follow up with you shortly.';

function isVaguePatientMessage(messageText: string): boolean {
  return isAmbiguousShortReply(messageText);
}

function isAgentToolName(name: string): name is ReceptionistAgentToolName {
  return (RECEPTIONIST_AGENT_TOOL_NAMES as readonly string[]).includes(name);
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function resolveLastAssistantMessage(input: AgentTurnInput): string | null {
  if (input.lastAssistantMessageText) {
    return input.lastAssistantMessageText;
  }
  for (let index = input.recentTurns.length - 1; index >= 0; index -= 1) {
    const turn = input.recentTurns[index];
    if (turn?.role === 'assistant') {
      return turn.text;
    }
  }
  return null;
}

@Injectable()
export class ReceptionistAgentService {
  private readonly logger = new Logger(ReceptionistAgentService.name);

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(RECEPTIONIST_AGENT_LLM_PORT) private readonly llm: ReceptionistAgentLlmPort,
    @Inject(ReceptionistAgentToolsService) private readonly tools: ReceptionistAgentToolsService,
    @Inject(AgentTurnAuditService) private readonly audit: AgentTurnAuditService,
  ) {}

  buildSystemPrompt(clinicName: string): string {
    return buildReceptionistAgentSystemPromptForProvider(
      this.env.RECEPTIONIST_AGENT_PROVIDER,
      clinicName,
    );
  }

  async handleTurn(input: AgentTurnInput): Promise<AgentTurnOutcome> {
    const turnStartedAt = Date.now();
    let llmCalls = 0;

    try {
      const safety = detectMessageSafety(input.messageText);
      if (safety.isMedicalAdviceRequest) {
        return this.finishTurn(input, {
          replyText: MEDICAL_ADVICE_REFUSAL_REPLY,
          updatedCollected: input.collected,
          toolsUsed: [],
          sessionStatus: 'active',
          guardrailFlags: ['medical_advice_refusal'],
          latencyMetrics: this.buildLatencyMetrics('trivial', turnStartedAt, 0, null),
        });
      }

      if (isVaguePatientMessage(input.messageText) && Number(input.collected.agent_clarify_count ?? 0) >= 2) {
        const escalated = await this.runForcedCallback(input);
        return this.finishTurn(input, {
          ...escalated,
          guardrailFlags: ['vague_input_callback'],
          latencyMetrics: this.buildLatencyMetrics('trivial', turnStartedAt, 0, null),
        });
      }

      const fastPath = evaluateAgentFastPath({
        messageText: input.messageText,
        lastAssistantMessageText: resolveLastAssistantMessage(input),
        collected: input.collected,
        languageCode: input.languageCode,
      });
      if (fastPath) {
        const fastResult = await this.executeFastPath(input, fastPath);
        if (fastResult) {
          return this.finishTurn(input, {
            ...fastResult,
            latencyMetrics: this.buildLatencyMetrics(
              'fast_path',
              turnStartedAt,
              0,
              null,
              fastPath.kind,
            ),
          });
        }
      }

      const preflight = await this.applyBookingPreflight(input);
      const guidedTurn = this.tryBookingGuidedTurn(input, preflight);
      if (guidedTurn) {
        return this.finishTurn(input, {
          ...guidedTurn,
          latencyMetrics: this.buildLatencyMetrics('fast_path', turnStartedAt, 0, null, 'booking_guided'),
        });
      }

      const loopResult = await this.runToolLoop(
        {
          ...input,
          collected: preflight.collected,
        },
        turnStartedAt,
        (count) => {
          llmCalls = count;
        },
      ).catch((error) => {
        if (this.isTurnTimeoutError(error)) {
          return this.buildTimeoutResult({
            collected: preflight.collected,
            toolsUsed: preflight.toolsUsed,
            toolResults: preflight.toolResults,
            sessionStatus: 'active',
            debugTrace: [],
            round: 0,
            ttftMs: null,
          });
        }
        throw error;
      });
      const steered = this.applyBookingReplySteering(input, {
        ...loopResult,
        toolsUsed: [...preflight.toolsUsed, ...loopResult.toolsUsed],
      });
      const guarded = this.applyOutputGuard(steered);
      const result = this.finalizeAgentTurnResult(input, guarded);
      if (!result.replyText.trim()) {
        return { kind: 'fallback', reason: 'empty_agent_reply' };
      }

      const turnType =
        result.toolsUsed.length === 0
          ? 'trivial'
          : result.toolsUsed.length === 1
            ? 'single_tool'
            : 'multi_tool';

      return this.finishTurn(input, {
        ...result,
        latencyMetrics: this.buildLatencyMetrics(
          turnType,
          turnStartedAt,
          llmCalls,
          steered.ttftMs ?? null,
        ),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'agent_turn_failed';
      this.logger.warn(JSON.stringify({ event: 'agent_turn_fallback', reason, sessionId: input.sessionId }));
      return { kind: 'fallback', reason };
    }
  }

  private buildLatencyMetrics(
    turnType: AgentTurnLatencyMetrics['turnType'],
    turnStartedAt: number,
    llmCalls: number,
    ttftMs: number | null,
    fastPathKind?: string,
  ): AgentTurnLatencyMetrics {
    return {
      turnType,
      totalMs: Date.now() - turnStartedAt,
      ttftMs,
      llmCalls,
      ...(fastPathKind ? { fastPathKind } : {}),
    };
  }

  private async finishTurn(
    input: AgentTurnInput,
    result: {
      replyText: string;
      updatedCollected: Record<string, unknown>;
      toolsUsed: string[];
      sessionStatus: AgentSessionStatus;
      guardrailFlags?: string[];
      latencyMetrics?: AgentTurnLatencyMetrics;
      debug?: Record<string, unknown>;
    },
  ): Promise<AgentTurnOutcome> {
    await this.audit.recordAgentReply({
      clinicId: input.clinicId,
      sessionId: input.sessionId,
      replyText: result.replyText,
      toolsUsed: result.toolsUsed,
      guardrailFlags: result.guardrailFlags ?? [],
    });

    if (result.latencyMetrics) {
      this.logger.log(
        JSON.stringify({
          event: 'agent_turn_latency',
          sessionId: input.sessionId,
          ...result.latencyMetrics,
        }),
      );
    }

    return { kind: 'agent', result };
  }

  private async executeFastPath(
    input: AgentTurnInput,
    match: AgentFastPathMatch,
  ): Promise<{
    replyText: string;
    updatedCollected: Record<string, unknown>;
    toolsUsed: string[];
    sessionStatus: AgentSessionStatus;
  } | null> {
    if (match.kind === 'greeting' || match.kind === 'thanks') {
      return {
        replyText: match.replyText,
        updatedCollected: input.collected,
        toolsUsed: [],
        sessionStatus: 'active',
      };
    }

    if (match.kind === 'confirmation_no') {
      return {
        replyText: match.replyText,
        updatedCollected: input.collected,
        toolsUsed: [],
        sessionStatus: 'active',
      };
    }

    if (match.kind === 'slot_pick') {
      return {
        replyText: `Got it — ${match.displayTime}. Shall I confirm the booking?`,
        updatedCollected: {
          ...input.collected,
          selected_slot_id: match.slotId,
        },
        toolsUsed: [],
        sessionStatus: 'active',
      };
    }

    if (match.kind === 'confirmation_yes') {
      const collected = parseBookingCollected(input.collected);
      const slotId = collected.selected_slot_id ?? null;
      const ctx: ReceptionistAgentToolContext = {
        clinicId: input.clinicId,
        sessionId: input.sessionId,
        collected: input.collected,
        patientPhone: input.patientPhone ?? null,
        patientMessageText: input.messageText,
        lastAssistantMessageText: resolveLastAssistantMessage(input),
      };
      const result = await this.tools.execute(
        'create_appointment_request',
        {
          patientName: collected.patient_name,
          phone: input.patientPhone,
          doctorName: collected.doctor_name,
          reasonForVisit: collected.reason_for_visit,
          date: collected.preferred_date,
          slotId,
          confirmedByPatient: true,
        },
        ctx,
      );

      if (result.error) {
        return null;
      }

      return {
        replyText: 'Your appointment request has been submitted. The clinic will confirm shortly.',
        updatedCollected: {
          ...input.collected,
          appointment_id: result.appointmentId,
        },
        toolsUsed: ['create_appointment_request'],
        sessionStatus: 'active',
      };
    }

    return null;
  }

  private isTurnBudgetExceeded(turnStartedAt: number): boolean {
    return Date.now() - turnStartedAt >= this.env.RECEPTIONIST_AGENT_TURN_BUDGET_MS;
  }

  private isTurnTimeoutError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AgentTurnTimeoutError';
  }

  private async withTurnBudget<T>(turnStartedAt: number, task: () => Promise<T>): Promise<T> {
    const remaining = this.env.RECEPTIONIST_AGENT_TURN_BUDGET_MS - (Date.now() - turnStartedAt);
    if (remaining <= 0) {
      const error = new Error('agent_turn_budget_exceeded');
      error.name = 'AgentTurnTimeoutError';
      throw error;
    }
    return Promise.race([
      task(),
      new Promise<T>((_resolve, reject) => {
        const error = new Error('agent_turn_budget_exceeded');
        error.name = 'AgentTurnTimeoutError';
        setTimeout(() => reject(error), remaining);
      }),
    ]);
  }

  private async runToolLoop(
    input: AgentTurnInput,
    turnStartedAt: number,
    onLlmCalls: (count: number) => void,
  ) {
    const maxRounds = this.env.RECEPTIONIST_AGENT_MAX_TOOL_ROUNDS;
    const systemPrompt = this.buildSystemPrompt(input.clinicName);
    const prefetch = await this.maybePrefetchSlots(input);
    const messages: LlmChatMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify(this.buildTurnPayload(input, prefetch)),
      },
    ];

    let collected = { ...input.collected };
    const toolsUsed: string[] = [];
    const toolResults: AgentToolResultRecord[] = [...prefetch];
    let sessionStatus: AgentSessionStatus = 'active';
    const debugTrace: Array<Record<string, unknown>> = [];
    let llmCalls = 0;
    let ttftMs: number | null = null;

    for (let round = 0; round < maxRounds; round += 1) {
      if (this.isTurnBudgetExceeded(turnStartedAt)) {
        return this.buildTimeoutResult({
          collected,
          toolsUsed,
          toolResults,
          sessionStatus,
          debugTrace,
          round,
          ttftMs,
        });
      }

      const offeredTools = getReceptionistAgentToolsForRequest(this.env.RECEPTIONIST_AGENT_PROVIDER, {
        collected,
      });

      const response = await this.callLlm(messages, input, round, debugTrace, turnStartedAt, {
        streamFinal: false,
        tools: offeredTools,
        modelTier: 'tool_loop',
      });
      llmCalls += 1;
      onLlmCalls(llmCalls);

      const toolCalls = response.response.toolCalls ?? [];

      if (toolCalls.length === 0) {
        const ttftMs = this.deliverFinalReply(input, response.response.content, turnStartedAt);
        const debug = this.buildDebug(debugTrace, round + 1);
        return {
          replyText: response.response.content,
          updatedCollected: collected,
          toolsUsed,
          toolResults,
          sessionStatus,
          ttftMs,
          ...(debug ? { debug } : {}),
        };
      }

      messages.push({
        role: 'assistant',
        content: response.response.content || null,
        tool_calls: toolCalls,
      });

      const executedCalls = await Promise.all(
        toolCalls.map((toolCall) => this.executeToolCall(toolCall, input, collected, debugTrace)),
      );

      for (const [index, executed] of executedCalls.entries()) {
        toolsUsed.push(executed.toolName);
        toolResults.push({ toolName: executed.toolName, result: executed.result });
        collected = { ...collected, ...executed.collected };
        sessionStatus = this.mergeSessionStatus(sessionStatus, executed.sessionStatus);

        messages.push({
          role: 'tool',
          content: JSON.stringify(executed.result),
          tool_call_id: toolCalls[index]!.id,
          name: executed.toolName,
        });
      }
    }

    if (this.isTurnBudgetExceeded(turnStartedAt)) {
      return this.buildTimeoutResult({
        collected,
        toolsUsed,
        toolResults,
        sessionStatus,
        debugTrace,
        round: maxRounds,
        ttftMs,
      });
    }

    messages.push({
      role: 'user',
      content:
        'You have reached the tool call limit for this turn. Reply to the patient now in plain text using what you already know. Do not call any more tools.',
    });

    const forced = await this.callLlm(messages, input, maxRounds, debugTrace, turnStartedAt, {
      forceTextOnly: true,
      streamFinal: true,
      tools: [],
      modelTier: 'fastpath',
    });
    llmCalls += 1;
    onLlmCalls(llmCalls);
    if (forced.ttftMs !== undefined) {
      ttftMs = forced.ttftMs;
    }

    const debug = this.buildDebug(debugTrace, maxRounds + 1, true);
    return {
      replyText: forced.response.content,
      updatedCollected: collected,
      toolsUsed,
      toolResults,
      sessionStatus,
      ttftMs,
      ...(debug ? { debug } : {}),
    };
  }

  private buildTimeoutResult(input: {
    collected: Record<string, unknown>;
    toolsUsed: string[];
    toolResults: AgentToolResultRecord[];
    sessionStatus: AgentSessionStatus;
    debugTrace: Array<Record<string, unknown>>;
    round: number;
    ttftMs: number | null;
  }) {
    this.logger.warn(JSON.stringify({ event: 'agent_turn_timeout', round: input.round }));
    const debug = this.buildDebug(input.debugTrace, input.round, true);
    return {
      replyText: TURN_TIMEOUT_FALLBACK,
      updatedCollected: input.collected,
      toolsUsed: input.toolsUsed,
      toolResults: input.toolResults,
      sessionStatus: input.sessionStatus,
      ttftMs: input.ttftMs,
      guardrailFlags: ['turn_timeout'],
      ...(debug ? { debug } : {}),
    };
  }

  private async maybePrefetchSlots(input: AgentTurnInput): Promise<AgentToolResultRecord[]> {
    const proposed = input.collected.proposed_slots;
    if (!Array.isArray(proposed) || proposed.length === 0) {
      return [];
    }

    const parsed = parseBookingCollected(input.collected);
    if (!parsed.doctor_name || !parsed.preferred_date) {
      return [];
    }

    const ctx: ReceptionistAgentToolContext = {
      clinicId: input.clinicId,
      sessionId: input.sessionId,
      collected: input.collected,
      patientPhone: input.patientPhone ?? null,
      patientMessageText: input.messageText,
      lastAssistantMessageText: resolveLastAssistantMessage(input),
    };

    const result = await this.tools.execute(
      'check_slot_availability',
      {
        doctorName: parsed.doctor_name,
        reasonForVisit: parsed.reason_for_visit ?? undefined,
        date: parsed.preferred_date,
        timePreference: parsed.time_preference ?? undefined,
      },
      ctx,
    );

    return [{ toolName: 'check_slot_availability', result }];
  }

  private async applyBookingPreflight(input: AgentTurnInput): Promise<{
    collected: Record<string, unknown>;
    toolsUsed: string[];
    toolResults: AgentToolResultRecord[];
    extractedFields: string[];
    slotReplyText: string | null;
  }> {
    const referenceDate = formatDateInTimezone(new Date(), 'Asia/Kolkata');
    const parsed = parseBookingCollected(input.collected);
    const patch = extractAgentBookingFieldPatch({
      messageText: input.messageText,
      collected: parsed,
      referenceDate,
    });

    let collected = { ...input.collected };
    const toolsUsed: string[] = [];
    const toolResults: AgentToolResultRecord[] = [];
    const extractedFields = Object.keys(patch);

    if (extractedFields.length > 0) {
      const executed = await this.runServerTool(
        'update_booking_state',
        { fields: patch },
        input,
        collected,
        [],
      );
      collected = executed.collected;
      toolsUsed.push(executed.toolName);
      toolResults.push({ toolName: executed.toolName, result: executed.result });
    }

    if (
      patch.reason_for_visit ||
      (parsed.reason_for_visit && !parsed.doctor_id && !parsed.doctor_name)
    ) {
      const ctx: ReceptionistAgentToolContext = {
        clinicId: input.clinicId,
        sessionId: input.sessionId,
        collected,
        patientPhone: input.patientPhone ?? null,
        patientMessageText: input.messageText,
        lastAssistantMessageText: resolveLastAssistantMessage(input),
      };
      const mapped = await this.tools.tryAutoMapDoctor(ctx, parseBookingCollected(collected));
      if (mapped) {
        const executed = await this.runServerTool(
          'update_booking_state',
          { fields: { doctor_id: mapped.doctorId, doctor_name: mapped.doctorName, clinic_service_id: mapped.clinicServiceId } },
          input,
          collected,
          [],
        );
        collected = executed.collected;
        toolsUsed.push(executed.toolName);
        toolResults.push({ toolName: executed.toolName, result: executed.result });
      }
    }

    const stateAfterPatch = inferBookingState(parseBookingCollected(collected));
    const collectedAfterPatch = parseBookingCollected(collected);
    let slotReplyText: string | null = null;
    if (
      stateAfterPatch === 'PROPOSE_SLOTS' &&
      !collectedAfterPatch.selected_slot_id &&
      !toolsUsed.includes('check_slot_availability')
    ) {
      const slotExecuted = await this.runServerTool(
        'check_slot_availability',
        {},
        input,
        collected,
        [],
      );
      collected = slotExecuted.collected;
      toolsUsed.push(slotExecuted.toolName);
      toolResults.push({ toolName: slotExecuted.toolName, result: slotExecuted.result });
      const slotResultCollected = parseBookingCollected(collected);
      const displaySlots = slotResultCollected.proposed_slots;
      if (Array.isArray(displaySlots) && displaySlots.length > 3) {
        const exactTime = extractActiveExactTime(input.messageText);
        const isBefore = /\b(before|munn|munadi|munnadi|before\s+that)\b/i.test(input.messageText);
        const parseSlotHour = (s: Record<string, unknown>): number => {
          const t = String(s.display_time ?? '');
          const p = t.split(/[:.]/);
          return Number(p[0] ?? 0);
        };
        const parseSlotMin = (s: Record<string, unknown>): number => {
          const t = String(s.display_time ?? '');
          const p = t.split(/[:.]/);
          return Number(p[1] ?? 0);
        };
        if (isBefore && exactTime) {
          const timeParts = exactTime.split(':').map(Number);
          const beforeH = timeParts[0] ?? 0;
          const beforeM = timeParts[1] ?? 0;
          const beforeIdx = displaySlots.findIndex((s) => {
            const h = parseSlotHour(s);
            const m = parseSlotMin(s);
            return h > beforeH || (h === beforeH && m >= beforeM);
          });
          const start = Math.max(0, beforeIdx - 3);
          const beforeLimited = displaySlots.slice(start, beforeIdx);
          slotResultCollected.proposed_slots = beforeLimited.slice(0, 3);
        } else if (exactTime) {
          const timeParts = exactTime.split(':').map(Number);
          const fromH = timeParts[0] ?? 0;
          const fromM = timeParts[1] ?? 0;
          const fromIdx = displaySlots.findIndex((s) => {
            const h = parseSlotHour(s);
            const m = parseSlotMin(s);
            return h > fromH || (h === fromH && m >= fromM);
          });
          const fromLimited = displaySlots.slice(Math.max(0, fromIdx));
          slotResultCollected.proposed_slots = fromLimited.slice(0, 3);
        } else {
          slotResultCollected.proposed_slots = displaySlots.slice(0, 3);
        }
      }
      slotReplyText = this.formatSlotProposalReply(
        slotResultCollected,
        input.languageCode,
      );

      if (!slotReplyText) {
        const slotResult = slotExecuted.result as Record<string, unknown>;
        const noSlots = !Array.isArray(slotResult.slots) || (slotResult.slots as unknown[]).length === 0;
        if (noSlots) {
          const dateDisplay = String(collectedAfterPatch.preferred_date ?? '')
            .replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1');
          slotReplyText = input.languageCode !== 'english'
            ? `${dateDisplay} appointment ille. Vera date select panreengala?`
            : `No appointments available on ${dateDisplay}. Would you like to check another date?`;
        }
      }
    }

    return { collected, toolsUsed, toolResults, extractedFields, slotReplyText };
  }

  private tryBookingGuidedTurn(
    input: AgentTurnInput,
    preflight: {
      collected: Record<string, unknown>;
      toolsUsed: string[];
      extractedFields: string[];
      slotReplyText: string | null;
    },
  ): {
    replyText: string;
    updatedCollected: Record<string, unknown>;
    toolsUsed: string[];
    sessionStatus: AgentSessionStatus;
    guardrailFlags?: string[];
    debug?: Record<string, unknown>;
  } | null {
    const parsed = parseBookingCollected(preflight.collected);
    const normalized = input.messageText.trim().toLowerCase();
    const isAffirmative = /^(ok|okay|okkey|aama|ama|sari|avasarama|kalandhudu)$/i.test(normalized) || normalized.length <= 2;
    const isThanks = /^(thanks|thank you|txs|thx)$/i.test(normalized);
    const isNegative = /^(no|illai|ila|ille|poidu|poyidu|venam|vendam|bye|byee|po\s+po)$/i.test(normalized) || /(thanks|thank you).*(bye|po)/i.test(normalized);

    if (parsed.appointment_id) {
      const terminal = parsed.awaiting_terminal_ack;
      if (terminal === 'offer_help') {
        if (isNegative || isThanks) {
          return this.buildDoneResult(input, preflight, 'booking_completed');
        }
        const isHelpYes = /\b(yes|aama|aam|ama|ok|okay|okkey|sari|venum)\b/i.test(normalized) && normalized.length > 2;
        if (isHelpYes) {
          const replyText = input.languageCode !== 'english'
            ? 'Enna help venum?'
            : 'What help do you need?';
          return {
            replyText,
            updatedCollected: { ...preflight.collected, awaiting_terminal_ack: 'awaiting_help_topic' },
            toolsUsed: preflight.toolsUsed,
            sessionStatus: 'active',
            guardrailFlags: ['ask_help_topic'],
            debug: {
              booking_guided: true,
              booking_state: 'AWAITING_CONFIRMATION',
              guided_reason: 'ask_help_topic',
              extracted_fields: preflight.extractedFields,
            },
          };
        }
        return {
          replyText: '',
          updatedCollected: { ...preflight.collected, awaiting_terminal_ack: undefined },
          toolsUsed: preflight.toolsUsed,
          sessionStatus: 'active',
          guardrailFlags: ['released_offer_help'],
          debug: {
            booking_guided: true,
            booking_state: 'AWAITING_CONFIRMATION',
            guided_reason: 'released_offer_help',
            extracted_fields: preflight.extractedFields,
          },
        };
      }
      if (terminal === 'awaiting_help_topic') {
        return null;
      }
      if (normalized.includes('epo') || normalized.includes('when') || normalized.includes('time') || normalized.includes('eppo') ||
          normalized.includes('status') || normalized.includes('enna') || normalized.includes('appointment')) {
        const replyText = input.languageCode !== 'english'
          ? 'Unga appointment pending confirmation-la irukku. Staff soon contact pannuvaanga, confirm aagum. Vera enna help venum?'
          : 'Your appointment is pending confirmation. Staff will contact you soon. What else can I help you with?';
        return {
          replyText,
          updatedCollected: { ...preflight.collected, awaiting_terminal_ack: 'offer_help' },
          toolsUsed: preflight.toolsUsed,
          sessionStatus: 'active',
          guardrailFlags: ['pending_confirmation_info'],
          debug: {
            booking_guided: true,
            booking_state: 'AWAITING_CONFIRMATION',
            guided_reason: 'confirmation_timing',
            extracted_fields: preflight.extractedFields,
          },
        };
      }
      if (isAffirmative || isThanks) {
        const replyText = input.languageCode !== 'english'
          ? 'Need any other help?'
          : 'Vera edhavadhu help venumaa?';
        return {
          replyText,
          updatedCollected: { ...preflight.collected, awaiting_terminal_ack: 'offer_help' },
          toolsUsed: preflight.toolsUsed,
          sessionStatus: 'active',
          guardrailFlags: ['offer_further_help'],
          debug: {
            booking_guided: true,
            booking_state: 'AWAITING_CONFIRMATION',
            guided_reason: 'offer_further_help',
            extracted_fields: preflight.extractedFields,
          },
        };
      }
      if (isNegative) {
        return this.buildDoneResult(input, preflight, 'booking_completed');
      }
      return null;
    }

    const bookingState = inferBookingState(parsed);

    if (bookingState === 'CONFIRM_DOCTOR') {
      if (isAffirmative || isThanks) {
        return {
          replyText: '',
          updatedCollected: preflight.collected,
          toolsUsed: preflight.toolsUsed,
          sessionStatus: 'active',
          guardrailFlags: ['booking_confirm_yes'],
          debug: {
            booking_guided: true,
            booking_state: 'CONFIRM_DOCTOR',
            guided_reason: 'confirmation_yes',
            extracted_fields: preflight.extractedFields,
          },
        };
      }
      if (isNegative) {
        return {
          replyText: input.languageCode !== 'english'
            ? 'No problem. Tell me if you want a different slot or need anything else.'
            : 'No problem. Let me know if you need anything else.',
          updatedCollected: { ...preflight.collected, selected_slot_id: undefined, hold_id: undefined },
          toolsUsed: preflight.toolsUsed,
          sessionStatus: 'active',
          guardrailFlags: ['booking_confirm_no'],
          debug: {
            booking_guided: true,
            booking_state: 'CONFIRM_DOCTOR',
            guided_reason: 'confirmation_no',
            extracted_fields: preflight.extractedFields,
          },
        };
      }
      return null;
    }

    if (!preflight.slotReplyText) {
      return null;
    }

    const alreadyPresented = input.lastAssistantMessageText
      ? /\b(slots irukku|which one do you|choose panreenga)\b/i.test(input.lastAssistantMessageText)
      : false;
    if (alreadyPresented) {
      const normalized = input.messageText.trim().toLowerCase();
      if (normalized.length <= 2) {
        return null;
      }
      const replyText = input.languageCode !== 'english'
        ? 'Sari, edha choose panreenga?'
        : 'Okay, which slot would you like?';
      return {
        replyText,
        updatedCollected: preflight.collected,
        toolsUsed: preflight.toolsUsed,
        sessionStatus: 'active',
        guardrailFlags: ['booking_slot_prompt'],
        debug: {
          booking_guided: true,
          booking_state: bookingState,
          guided_reason: 'slot_prompt',
          extracted_fields: preflight.extractedFields,
        },
      };
    }

    return {
      replyText: preflight.slotReplyText,
      updatedCollected: preflight.collected,
      toolsUsed: preflight.toolsUsed,
      sessionStatus: 'active',
      guardrailFlags: ['booking_slot_presentation'],
      debug: {
        booking_guided: true,
        booking_state: bookingState,
        guided_reason: 'slot_presentation',
        extracted_fields: preflight.extractedFields,
      },
    };
  }

  private buildDoneResult(
    input: AgentTurnInput,
    preflight: {
      collected: Record<string, unknown>;
      toolsUsed: string[];
      extractedFields: string[];
    },
    reason: string,
  ) {
    const replyText = input.languageCode !== 'english'
      ? 'Thanks, have a nice day!'
      : 'Thank you, have a nice day!';
    return {
      replyText,
      updatedCollected: preflight.collected,
      toolsUsed: preflight.toolsUsed,
      sessionStatus: 'completed' as AgentSessionStatus,
      guardrailFlags: ['booking_completed'],
      debug: {
        booking_guided: true,
        booking_state: 'DONE',
        guided_reason: reason,
        extracted_fields: preflight.extractedFields,
      },
    };
  }

  private applyBookingReplySteering(
    input: AgentTurnInput,
    result: {
      replyText: string;
      updatedCollected: Record<string, unknown>;
      toolsUsed: string[];
      toolResults: AgentToolResultRecord[];
      sessionStatus: AgentSessionStatus;
      debug?: Record<string, unknown>;
      ttftMs?: number | null;
      guardrailFlags?: string[];
    },
  ) {
    const bookingContext = buildBookingContextForCollected({
      messageText: input.messageText,
      languageCode: input.languageCode,
      collected: parseBookingCollected(result.updatedCollected),
      patientPhone: input.patientPhone ?? null,
      lastAssistantMessageText: resolveLastAssistantMessage(input),
    });

    if (
      !shouldSteerBookingReply({
        replyText: result.replyText,
        bookingContext,
      }) ||
      !bookingContext
    ) {
      return result;
    }

    return {
      ...result,
      replyText: resolveBookingGuidedReply(
        bookingContext,
        parseBookingCollected(result.updatedCollected),
      ),
      guardrailFlags: [...(result.guardrailFlags ?? []), 'booking_reply_steered'],
      debug: {
        ...(result.debug ?? {}),
        booking_reply_steered: true,
        booking_state: bookingContext.state,
      },
    };
  }

  private formatSlotProposalReply(
    collected: ReturnType<typeof parseBookingCollected>,
    languageCode: AgentTurnInput['languageCode'],
  ): string | null {
    const proposed = collected.proposed_slots;
    if (!Array.isArray(proposed) || proposed.length === 0) {
      return null;
    }
    const slotList = proposed
      .map((slot) => slot.display_time)
      .filter((value): value is string => typeof value === 'string')
      .join(', ');
    const doctorName = collected.doctor_name ?? 'Doctor';
    const dateDisplay = collected.preferred_date ?? '';
    if (languageCode !== 'english') {
      return `${doctorName} ${dateDisplay} ${slotList} slots irukku. Edha choose panreenga?`;
    }
    return `${doctorName} has these slots on ${dateDisplay}: ${slotList}. Which one do you prefer?`;
  }

  private async runServerTool(
    toolName: ReceptionistAgentToolName,
    args: Record<string, unknown>,
    input: AgentTurnInput,
    collected: Record<string, unknown>,
    debugTrace: Array<Record<string, unknown>>,
  ) {
    const toolCall: LlmToolCall = {
      id: `server_${toolName}_${Date.now()}`,
      type: 'function',
      function: {
        name: toolName,
        arguments: JSON.stringify(args),
      },
    };
    return this.executeToolCall(toolCall, input, collected, debugTrace);
  }

  private applyOutputGuard(result: {
    replyText: string;
    updatedCollected: Record<string, unknown>;
    toolsUsed: string[];
    toolResults: AgentToolResultRecord[];
    sessionStatus: AgentSessionStatus;
    debug?: Record<string, unknown>;
    guardrailFlags?: string[];
  }) {
    const snapshot = buildAllowedFactSnapshot({
      toolResults: result.toolResults,
      collected: result.updatedCollected,
    });
    const violations = detectUngroundedFacts(result.replyText, snapshot);
    if (violations.length === 0) {
      return { ...result, guardrailFlags: result.guardrailFlags ?? [] };
    }

    this.logger.warn(
      JSON.stringify({ event: 'agent_output_guardrail', violations }),
    );

    return {
      ...result,
      replyText: UNGROUNDED_REPLY_FALLBACK,
      guardrailFlags: violations,
    };
  }

  private buildTurnPayload(
    input: AgentTurnInput,
    prefetch: AgentToolResultRecord[],
  ): Record<string, unknown> {
    const recentTurns = input.recentTurns.slice(-MAX_RECENT_TURNS).map((turn) => ({
      role: turn.role,
      text: turn.text,
    }));
    const parsed = parseBookingCollected(input.collected);
    const raw = input.collected;
    const lastAssistantMessage = resolveLastAssistantMessage(input);
    const bookingContext = buildReceptionistAgentBookingContext({
      messageText: input.messageText,
      languageCode: input.languageCode,
      collected: parsed,
      patientPhone: input.patientPhone ?? null,
      lastAssistantMessageText: lastAssistantMessage,
    });
    return {
      clinic_name: input.clinicName,
      clinic_id: input.clinicId,
      session_id: input.sessionId,
      language_code: input.languageCode,
      patient_message: input.messageText,
      recent_turns: recentTurns,
      ...(lastAssistantMessage ? { last_assistant_message: lastAssistantMessage } : {}),
      ...(bookingContext ? { booking_context: bookingContext } : {}),
      ...(prefetch.length > 0
        ? {
            warm_tool_results: prefetch.map((entry) => ({
              tool_name: entry.toolName,
              result: entry.result,
            })),
          }
        : {}),
      collected: {
        ...parsed,
        ...(input.patientPhone ? { known_patient_phone: input.patientPhone } : {}),
        ...(typeof raw.patient_phone === 'string' ? { patient_phone: raw.patient_phone } : {}),
        ...(typeof raw.agent_clarify_count === 'number'
          ? { agent_clarify_count: raw.agent_clarify_count }
          : {}),
        ...(typeof raw.last_clarify_reply === 'string'
          ? { last_clarify_reply: raw.last_clarify_reply }
          : {}),
      },
    };
  }

  private finalizeAgentTurnResult(
    input: AgentTurnInput,
    result: {
      replyText: string;
      updatedCollected: Record<string, unknown>;
      toolsUsed: string[];
      sessionStatus: AgentSessionStatus;
      guardrailFlags?: string[];
      debug?: Record<string, unknown>;
    },
  ) {
    if (!isVaguePatientMessage(input.messageText) || result.toolsUsed.length > 0) {
      return result;
    }

    const prevCount = Number(input.collected.agent_clarify_count ?? 0);
    let replyText = result.replyText;
    const lastReply =
      typeof input.collected.last_clarify_reply === 'string'
        ? input.collected.last_clarify_reply.trim()
        : '';
    if (lastReply && lastReply === replyText.trim()) {
      replyText =
        prevCount >= 1
          ? 'Sorry, I still did not catch that. Shall I have a clinic staff member call you back?'
          : replyText;
    }

    return {
      ...result,
      replyText,
      updatedCollected: {
        ...result.updatedCollected,
        agent_clarify_count: prevCount + 1,
        last_clarify_reply: replyText,
      },
    };
  }

  private async runForcedCallback(input: AgentTurnInput) {
    const ctx: ReceptionistAgentToolContext = {
      clinicId: input.clinicId,
      sessionId: input.sessionId,
      collected: input.collected,
      patientPhone: input.patientPhone ?? null,
      patientMessageText: input.messageText,
      lastAssistantMessageText: resolveLastAssistantMessage(input),
    };
    await this.tools.execute(
      'request_human_callback',
      { reason: 'patient_input_unclear_after_clarify_attempts' },
      ctx,
    );
    const prevCount = Number(input.collected.agent_clarify_count ?? 0);
    return {
      replyText:
        'No problem — I will have a clinic staff member call you back shortly to help.',
      updatedCollected: {
        ...input.collected,
        agent_clarify_count: prevCount + 1,
      },
      toolsUsed: ['request_human_callback'],
      sessionStatus: 'completed' as AgentSessionStatus,
    };
  }

  private resolveLlmTimeoutMs(turnStartedAt: number): number {
    const elapsed = Date.now() - turnStartedAt;
    const remaining = Math.max(MIN_LLM_TIMEOUT_MS, this.env.RECEPTIONIST_AGENT_TURN_BUDGET_MS - elapsed);
    return Math.min(this.env.RECEPTIONIST_AGENT_TIMEOUT_MS, remaining);
  }

  private async callLlm(
    messages: LlmChatMessage[],
    input: AgentTurnInput,
    round: number,
    debugTrace: Array<Record<string, unknown>>,
    turnStartedAt: number,
    options?: {
      forceTextOnly?: boolean;
      streamFinal?: boolean;
      tools?: LlmToolDefinition[];
      modelTier?: 'tool_loop' | 'fastpath';
    },
  ): Promise<{
    response: { content: string; toolCalls?: LlmToolCall[]; finishReason?: string | null; model: string };
    ttftMs?: number;
  }> {
    const request = this.buildLlmRequest(messages, options);
    const runtime = {
      timeoutMs: this.resolveLlmTimeoutMs(turnStartedAt),
      maxOutputTokens: this.env.RECEPTIONIST_AGENT_MAX_TOKENS,
    };
    const toolsOffered =
      options?.forceTextOnly || !options?.tools
        ? []
        : options.tools.map((tool) => tool.function.name);

    this.logger.log(
      JSON.stringify({
        event: 'agent_llm_request',
        sessionId: input.sessionId,
        round,
        model: request.model,
        model_tier: options?.modelTier ?? 'tool_loop',
        message_count: messages.length,
        force_text_only: Boolean(options?.forceTextOnly),
        stream: Boolean(options?.streamFinal),
        timeout_ms: runtime.timeoutMs,
        max_tokens: this.env.RECEPTIONIST_AGENT_MAX_TOKENS,
        tools_offered: toolsOffered,
        tools_count: toolsOffered.length,
        tool_choice: request.toolChoice ?? null,
      }),
    );

    let response;
    let ttftMs: number | undefined;
    const streamHandlers = options?.streamFinal ? this.buildStreamHandlers(input) : undefined;

    try {
      if (options?.streamFinal && this.llm.chatStream) {
        response = await this.withTurnBudget(turnStartedAt, () =>
          this.llm.chatStream!(request, runtime, {
            ...streamHandlers,
            onFirstToken: (elapsedMs) => {
              ttftMs = elapsedMs;
              streamHandlers?.onFirstToken?.(elapsedMs);
            },
            onDelta: (delta) => {
              if (delta.content) {
                input.streamHandlers?.onReplyToken?.(delta.content);
                input.streamHandlers?.onTtsChunk?.(delta.content);
              }
            },
          }),
        );
      } else {
        response = await this.withTurnBudget(turnStartedAt, () => this.llm.chat(request, runtime));
      }
    } catch (primaryError) {
      if (this.isTurnTimeoutError(primaryError)) {
        throw primaryError;
      }
      if (!this.env.RECEPTIONIST_AGENT_ENABLE_FALLBACK) {
        throw primaryError;
      }
      response = await this.withTurnBudget(turnStartedAt, () =>
        this.llm.chat({ ...request, model: this.env.RECEPTIONIST_AGENT_FALLBACK_MODEL }, runtime),
      );
      debugTrace.push({ event: 'agent_llm_fallback_model', model: this.env.RECEPTIONIST_AGENT_FALLBACK_MODEL });
    }

    debugTrace.push({
      event: 'agent_llm_response',
      round,
      model: response.model,
      finish_reason: response.finishReason ?? null,
      tool_calls: (response.toolCalls ?? []).map((call) => call.function.name),
      content_preview: response.content.slice(0, 240),
      ...(ttftMs !== undefined ? { ttft_ms: ttftMs } : {}),
    });

    return {
      response: {
        model: response.model,
        content: response.content,
        ...(response.toolCalls ? { toolCalls: response.toolCalls } : {}),
        ...(response.finishReason !== undefined ? { finishReason: response.finishReason } : {}),
      },
      ...(ttftMs !== undefined ? { ttftMs } : {}),
    };
  }

  private deliverFinalReply(
    input: AgentTurnInput,
    replyText: string,
    turnStartedAt: number,
  ): number | null {
    const handlers = input.streamHandlers;
    if (!handlers) {
      return null;
    }
    const ttftMs = Date.now() - turnStartedAt;
    handlers.onFirstToken?.(ttftMs);
    for (const token of replyText.match(/\S+\s*|\s+/g) ?? [replyText]) {
      handlers.onReplyToken?.(token);
      handlers.onTtsChunk?.(token);
    }
    return ttftMs;
  }

  private buildLlmRequest(
    messages: LlmChatMessage[],
    options?: {
      forceTextOnly?: boolean;
      tools?: LlmToolDefinition[];
      modelTier?: 'tool_loop' | 'fastpath';
    },
  ) {
    const tools =
      options?.forceTextOnly || !options?.tools || options.tools.length === 0
        ? undefined
        : options.tools;
    const model =
      options?.modelTier === 'fastpath'
        ? this.env.RECEPTIONIST_AGENT_FASTPATH_MODEL
        : this.env.RECEPTIONIST_AGENT_MODEL;

    return {
      model,
      messages,
      temperature: AGENT_TEMPERATURE,
      maxTokens: this.env.RECEPTIONIST_AGENT_MAX_TOKENS,
      ...(tools ? { tools, toolChoice: 'auto' as const } : {}),
    };
  }

  private buildStreamHandlers(input: AgentTurnInput) {
    if (!input.streamHandlers) {
      return undefined;
    }
    return {
      onDelta: (delta: { content?: string }) => {
        if (!delta.content) {
          return;
        }
        input.streamHandlers?.onReplyToken?.(delta.content);
        input.streamHandlers?.onTtsChunk?.(delta.content);
      },
      onFirstToken: input.streamHandlers.onFirstToken,
    };
  }

  private async executeToolCall(
    toolCall: LlmToolCall,
    input: AgentTurnInput,
    collected: Record<string, unknown>,
    debugTrace: Array<Record<string, unknown>>,
  ): Promise<{
    toolName: string;
    result: Record<string, unknown>;
    collected: Record<string, unknown>;
    sessionStatus: AgentSessionStatus | null;
  }> {
    const toolName = toolCall.function.name;
    const args = parseToolArguments(toolCall.function.arguments);

    if (!isAgentToolName(toolName)) {
      const result = { error: 'unsupported_tool', toolName };
      debugTrace.push({ event: 'agent_tool_call', toolName, args, result });
      return { toolName, result, collected, sessionStatus: null };
    }

    const ctx: ReceptionistAgentToolContext = {
      clinicId: input.clinicId,
      sessionId: input.sessionId,
      collected,
      patientPhone: input.patientPhone ?? null,
      patientMessageText: input.messageText,
      lastAssistantMessageText: resolveLastAssistantMessage(input),
    };

    const result = await this.tools.execute(toolName, args, ctx);
    let nextCollected = collected;
    let sessionStatus: AgentSessionStatus | null = null;

    if (toolName === 'update_booking_state' && result.collected && typeof result.collected === 'object') {
      nextCollected = result.collected as Record<string, unknown>;
    } else if (toolName === 'create_appointment_request' && result.appointmentId) {
      nextCollected = {
        ...nextCollected,
        appointment_id: result.appointmentId,
        patient_name: args.patientName ?? nextCollected.patient_name,
        reason_for_visit: args.reasonForVisit ?? nextCollected.reason_for_visit,
        preferred_date: args.date ?? nextCollected.preferred_date,
        selected_slot_id: args.slotId ?? nextCollected.selected_slot_id,
        doctor_name: args.doctorName ?? nextCollected.doctor_name,
      };
      sessionStatus = 'active';
    } else if (toolName === 'request_human_callback' && result.submitted) {
      sessionStatus = 'completed';
    } else if (toolName === 'cancel_appointment' && result.cancelled) {
      sessionStatus = 'active';
    } else if (toolName === 'reschedule_appointment' && result.submitted) {
      sessionStatus = 'active';
    } else if (toolName === 'check_slot_availability' && Array.isArray(result.slots)) {
      nextCollected = {
        ...nextCollected,
        proposed_slots: (result.slots as Array<Record<string, unknown>>).map((slot) => ({
          slot_id: slot.slotId,
          display_time: slot.time,
          start_time: `${slot.dateDisplay} ${slot.time}`,
          end_time: `${slot.dateDisplay} ${slot.time}`,
        })),
        preferred_date: result.preferredDate ?? nextCollected.preferred_date,
        doctor_id: result.doctorId ?? nextCollected.doctor_id,
        clinic_service_id: result.clinicServiceId ?? nextCollected.clinic_service_id,
      };
    }

    debugTrace.push({ event: 'agent_tool_call', toolName, args, result });
    await this.audit.recordToolCall({
      clinicId: input.clinicId,
      sessionId: input.sessionId,
      toolName,
      args,
      result,
    });

    return { toolName, result, collected: nextCollected, sessionStatus };
  }

  private mergeSessionStatus(
    current: AgentSessionStatus,
    next: AgentSessionStatus | null,
  ): AgentSessionStatus {
    if (!next) {
      return current;
    }
    if (next === 'completed' || next === 'escalated') {
      return next;
    }
    return current;
  }

  private buildDebug(
    trace: Array<Record<string, unknown>>,
    rounds: number,
    forcedFinal = false,
  ): Record<string, unknown> | undefined {
    if (!this.env.DEBUG_API || this.env.NODE_ENV === 'production') {
      return undefined;
    }
    return {
      agent_planner: {
        provider: this.env.RECEPTIONIST_AGENT_PROVIDER,
        model: this.env.RECEPTIONIST_AGENT_MODEL,
        rounds,
        forced_final: forcedFinal,
        trace,
      },
    };
  }
}
