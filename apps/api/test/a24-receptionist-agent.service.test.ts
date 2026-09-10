import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { parseApiEnv } from '@vaidya/config';

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
  DEBUG_API: 'true',
});

describe('A24 receptionist agent service', () => {
  it('executes a tool call then returns the final LLM text as replyText', async () => {
    const llmChat = vi.fn<ReceptionistAgentLlmPort['chat']>();
    llmChat.mockResolvedValueOnce({
      model: 'mock-model',
      content: '',
      toolCalls: [
        {
          id: 'call_slots_1',
          type: 'function',
          function: {
            name: 'check_slot_availability',
            arguments: JSON.stringify({
              doctorName: 'Kumar',
              reasonForVisit: 'knee pain',
              date: '2026-07-11',
              timePreference: 'evening',
            }),
          },
        },
      ],
      finishReason: 'tool_calls',
    });
    llmChat.mockResolvedValueOnce({
      model: 'mock-model',
      content: 'Dr Kumar ku 6:30pm slot available. Edha choose panreenga?',
      finishReason: 'stop',
    });

    const toolsExecute = vi.fn().mockResolvedValue({
      slots: [
        {
          slotId: 'slot-abc',
          doctorName: 'Dr Kumar',
          dateDisplay: '2026-07-11',
          time: '6:30',
        },
      ],
      preferredDate: '2026-07-11',
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReceptionistAgentService,
        { provide: API_ENV, useValue: testEnv },
        { provide: RECEPTIONIST_AGENT_LLM_PORT, useValue: { chat: llmChat } },
        { provide: ReceptionistAgentToolsService, useValue: { execute: toolsExecute } },
        {
          provide: AgentTurnAuditService,
          useValue: { recordToolCall: vi.fn(), recordAgentReply: vi.fn() },
        },
      ],
    }).compile();

    const service = moduleRef.get(ReceptionistAgentService);
    const outcome = await service.handleTurn({
      clinicName: 'Demo Clinic',
      clinicId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000099',
      languageCode: 'ta_tanglish',
      recentTurns: [
        { role: 'assistant', text: 'Endha doctor-a paakanum?' },
        { role: 'patient', text: 'Dr Kumar' },
      ],
      collected: {},
      messageText: 'Tomorrow evening slot irukka?',
      patientPhone: '+919876543210',
    });

    expect(outcome.kind).toBe('agent');
    if (outcome.kind !== 'agent') {
      return;
    }

    expect(outcome.result.replyText).toContain('6:30pm');
    expect(outcome.result.toolsUsed).toEqual(['update_booking_state', 'check_slot_availability']);
    expect(toolsExecute).toHaveBeenCalledTimes(2);
    expect(toolsExecute).toHaveBeenCalledWith(
      'check_slot_availability',
      expect.objectContaining({ doctorName: 'Kumar', date: '2026-07-11' }),
      expect.objectContaining({
        clinicId: '00000000-0000-0000-0000-000000000001',
        sessionId: '00000000-0000-0000-0000-000000000099',
      }),
    );
    expect(llmChat).toHaveBeenCalledTimes(2);
    expect(outcome.result.updatedCollected.proposed_slots).toBeTruthy();
    expect(outcome.result.sessionStatus).toBe('active');
  });

  it('falls back instead of throwing when the LLM call fails', async () => {
    const llmChat = vi.fn().mockRejectedValue(new Error('provider_timeout'));

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReceptionistAgentService,
        { provide: API_ENV, useValue: testEnv },
        { provide: RECEPTIONIST_AGENT_LLM_PORT, useValue: { chat: llmChat } },
        {
          provide: ReceptionistAgentToolsService,
          useValue: { execute: vi.fn() },
        },
        {
          provide: AgentTurnAuditService,
          useValue: { recordToolCall: vi.fn(), recordAgentReply: vi.fn() },
        },
      ],
    }).compile();

    const service = moduleRef.get(ReceptionistAgentService);
    const outcome = await service.handleTurn({
      clinicName: 'Demo Clinic',
      clinicId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000099',
      languageCode: 'english',
      recentTurns: [],
      collected: {},
      messageText: 'Please help me book an appointment',
    });

    expect(outcome).toEqual({ kind: 'fallback', reason: 'provider_timeout' });
  });
});
