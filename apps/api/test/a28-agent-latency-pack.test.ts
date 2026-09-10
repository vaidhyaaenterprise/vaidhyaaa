import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { parseApiEnv } from '@vaidya/config';
import type { LlmChatRequest, LlmChatResponse } from '@vaidya/shared';

import { API_ENV } from '../src/config/api-config.module';
import { AgentTurnAuditService } from '../src/modules/conversation/agent-turn-audit.service';
import { ReceptionistAgentToolsService } from '../src/modules/conversation/receptionist-agent-tools';
import { ReceptionistAgentService } from '../src/modules/conversation/receptionist-agent.service';
import {
  RECEPTIONIST_AGENT_LLM_PORT,
  type ReceptionistAgentLlmPort,
} from '../src/modules/conversation/receptionist-agent.types';

const testEnv = parseApiEnv({
  NODE_ENV: 'test',
  APP_ENV: 'local',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/vaidya_test',
  JWT_SECRET: 'test-secret',
  RECEPTIONIST_AGENT_PROVIDER: 'sarvam',
  SARVAM_API_KEY: 'sk-test',
  RECEPTIONIST_AGENT_MAX_TOOL_ROUNDS: '4',
  RECEPTIONIST_AGENT_TURN_BUDGET_MS: '8000',
  RECEPTIONIST_AGENT_TIMEOUT_MS: '2000',
  DEBUG_API: 'true',
});

const auditMock = {
  recordToolCall: vi.fn(),
  recordAgentReply: vi.fn(),
};

function buildModule(llm: ReceptionistAgentLlmPort, toolsExecute = vi.fn()) {
  return Test.createTestingModule({
    providers: [
      ReceptionistAgentService,
      { provide: API_ENV, useValue: testEnv },
      { provide: RECEPTIONIST_AGENT_LLM_PORT, useValue: llm },
      { provide: ReceptionistAgentToolsService, useValue: { execute: toolsExecute } },
      { provide: AgentTurnAuditService, useValue: auditMock },
    ],
  }).compile();
}

describe('A28 agent latency pack', () => {
  it('streams final reply deltas and logs TTFT via stream handlers', async () => {
    const llmChat = vi.fn<ReceptionistAgentLlmPort['chat']>().mockResolvedValue({
      model: 'mock-model',
      content: 'Dr Kumar ku 6:30pm slot available.',
      finishReason: 'stop',
    });
    const llmStream = vi.fn<NonNullable<ReceptionistAgentLlmPort['chatStream']>>();

    const moduleRef = await buildModule({ chat: llmChat, chatStream: llmStream });
    const service = moduleRef.get(ReceptionistAgentService);

    const deltas: string[] = [];
    let ttftMs: number | null = null;

    const outcome = await service.handleTurn({
      clinicName: 'Demo Clinic',
      clinicId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000201',
      languageCode: 'ta_tanglish',
      recentTurns: [],
      collected: {},
      messageText: 'Tomorrow evening slot irukka?',
      streamHandlers: {
        onReplyToken: (token) => deltas.push(token),
        onFirstToken: (elapsed) => {
          ttftMs = elapsed;
        },
      },
    });

    expect(outcome.kind).toBe('agent');
    if (outcome.kind !== 'agent') {
      return;
    }

    expect(llmChat).toHaveBeenCalledTimes(1);
    expect(deltas.join('')).toContain('6:30pm');
    expect(ttftMs).not.toBeNull();
    expect(outcome.result.latencyMetrics?.llmCalls).toBe(1);
  });

  it('fast-path confirmation resolves with zero LLM calls', async () => {
    const llmChat = vi.fn<ReceptionistAgentLlmPort['chat']>();
    const toolsExecute = vi.fn().mockResolvedValue({
      appointmentId: '00000000-0000-0000-0000-000000000701',
    });

    const moduleRef = await buildModule({ chat: llmChat }, toolsExecute);
    const service = moduleRef.get(ReceptionistAgentService);

    const outcome = await service.handleTurn({
      clinicName: 'Demo Clinic',
      clinicId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000202',
      languageCode: 'english',
      recentTurns: [
        { role: 'assistant', text: 'Shall I confirm this booking for Friday at 6:30pm?' },
      ],
      collected: {
        patient_name: 'Priya',
        doctor_name: 'Kumar',
        reason_for_visit: 'knee pain',
        preferred_date: '2026-07-11',
        selected_slot_id: '00000000-0000-0000-0000-000000000501',
      },
      messageText: 'yes',
      patientPhone: '+919876543210',
      lastAssistantMessageText: 'Shall I confirm this booking for Friday at 6:30pm?',
    });

    expect(outcome.kind).toBe('agent');
    expect(llmChat).not.toHaveBeenCalled();
    if (outcome.kind !== 'agent') {
      return;
    }
    expect(outcome.result.latencyMetrics?.turnType).toBe('fast_path');
    expect(outcome.result.latencyMetrics?.llmCalls).toBe(0);
    expect(toolsExecute).toHaveBeenCalledWith(
      'create_appointment_request',
      expect.objectContaining({ confirmedByPatient: true }),
      expect.any(Object),
    );
  });

  it('ambiguous short reply falls through to the LLM', async () => {
    const llmChat = vi.fn<ReceptionistAgentLlmPort['chat']>().mockResolvedValue({
      model: 'mock-model',
      content: 'Could you tell me which slot works for you?',
      finishReason: 'stop',
    });

    const moduleRef = await buildModule({ chat: llmChat });
    const service = moduleRef.get(ReceptionistAgentService);

    const outcome = await service.handleTurn({
      clinicName: 'Demo Clinic',
      clinicId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000203',
      languageCode: 'english',
      recentTurns: [
        { role: 'assistant', text: 'Shall I confirm this booking for Friday at 6:30pm?' },
      ],
      collected: {},
      messageText: 'hmm ok',
      lastAssistantMessageText: 'Shall I confirm this booking for Friday at 6:30pm?',
    });

    expect(llmChat).toHaveBeenCalled();
    expect(outcome.kind).toBe('agent');
  });

  it('executes multiple tool calls concurrently', async () => {
    const llmChat = vi.fn<ReceptionistAgentLlmPort['chat']>();
    llmChat.mockResolvedValueOnce({
      model: 'mock-model',
      content: '',
      toolCalls: [
        {
          id: 'call_slots',
          type: 'function',
          function: {
            name: 'check_slot_availability',
            arguments: JSON.stringify({ doctorName: 'Kumar', date: '2026-07-11' }),
          },
        },
        {
          id: 'call_info',
          type: 'function',
          function: {
            name: 'get_clinic_info',
            arguments: JSON.stringify({ info_type: 'location' }),
          },
        },
      ],
      finishReason: 'tool_calls',
    });
    llmChat.mockResolvedValueOnce({
      model: 'mock-model',
      content: 'Here are the slots and clinic location details.',
      finishReason: 'stop',
    });

    const toolsExecute = vi.fn(async (toolName: string) => {
      await new Promise((resolve) => setTimeout(resolve, toolName === 'check_slot_availability' ? 80 : 40));
      if (toolName === 'check_slot_availability') {
        return { slots: [{ slotId: 'slot-1', doctorName: 'Dr Kumar', dateDisplay: '2026-07-11', time: '6:30' }] };
      }
      return { address: 'Chennai' };
    });

    const moduleRef = await buildModule({ chat: llmChat }, toolsExecute);
    const service = moduleRef.get(ReceptionistAgentService);
    const startedAt = Date.now();

    const outcome = await service.handleTurn({
      clinicName: 'Demo Clinic',
      clinicId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000204',
      languageCode: 'english',
      recentTurns: [],
      collected: {},
      messageText: 'Friday slot and clinic location please',
    });

    const elapsed = Date.now() - startedAt;
    expect(outcome.kind).toBe('agent');
    expect(toolsExecute).toHaveBeenCalledTimes(2);
    expect(elapsed).toBeLessThan(200);
  });

  it('returns template fallback when turn budget is exceeded', async () => {
    const slowEnv = parseApiEnv({
      NODE_ENV: 'test',
      APP_ENV: 'local',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/vaidya_test',
      JWT_SECRET: 'test-secret',
      RECEPTIONIST_AGENT_PROVIDER: 'sarvam',
      SARVAM_API_KEY: 'sk-test',
      RECEPTIONIST_AGENT_TURN_BUDGET_MS: '1',
      RECEPTIONIST_AGENT_TIMEOUT_MS: '5000',
    });

    const llmChat = vi.fn<ReceptionistAgentLlmPort['chat']>().mockImplementation(
      () =>
        new Promise<LlmChatResponse>((resolve) => {
          setTimeout(
            () =>
              resolve({
                model: 'mock-model',
                content: 'This should not be returned.',
                finishReason: 'stop',
              }),
            50,
          );
        }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReceptionistAgentService,
        { provide: API_ENV, useValue: slowEnv },
        { provide: RECEPTIONIST_AGENT_LLM_PORT, useValue: { chat: llmChat } },
        { provide: ReceptionistAgentToolsService, useValue: { execute: vi.fn() } },
        { provide: AgentTurnAuditService, useValue: auditMock },
      ],
    }).compile();

    const service = moduleRef.get(ReceptionistAgentService);
    const startedAt = Date.now();
    const outcome = await service.handleTurn({
      clinicName: 'Demo Clinic',
      clinicId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000205',
      languageCode: 'english',
      recentTurns: [],
      collected: {},
      messageText: 'I need an appointment',
    });

    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(outcome.kind).toBe('agent');
    if (outcome.kind !== 'agent') {
      return;
    }
    expect(outcome.result.replyText.toLowerCase()).toMatch(/give me one moment|staff member/);
    expect(outcome.result.guardrailFlags).toContain('turn_timeout');
  });
});
