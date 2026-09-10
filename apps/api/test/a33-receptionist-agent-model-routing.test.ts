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
  RECEPTIONIST_AGENT_MODEL: 'sarvam-105b',
  RECEPTIONIST_AGENT_FASTPATH_MODEL: 'sarvam-30b',
  RECEPTIONIST_AGENT_MAX_TOOL_ROUNDS: '1',
  SARVAM_API_KEY: 'sk-test',
});

describe('A33 receptionist agent fastpath model routing', () => {
  it('uses sarvam-30b for the forced text-only final round', async () => {
    const llmChat = vi
      .fn<ReceptionistAgentLlmPort['chat']>()
      .mockResolvedValueOnce({
        model: 'sarvam-105b',
        content: '',
        toolCalls: [
          {
            id: 'call_slots',
            type: 'function',
            function: {
              name: 'check_slot_availability',
              arguments: JSON.stringify({ doctorName: 'Kumar', date: '2026-07-12' }),
            },
          },
        ],
        finishReason: 'tool_calls',
      })
      .mockResolvedValueOnce({
        model: 'sarvam-30b',
        content: 'Dr Kumar has 6:30pm open tomorrow.',
        finishReason: 'stop',
      });

    const toolsExecute = vi.fn().mockResolvedValue({
      slots: [{ slotId: 'slot-1', doctorName: 'Dr Kumar', dateDisplay: '2026-07-12', time: '6:30' }],
      preferredDate: '2026-07-12',
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
      languageCode: 'english',
      recentTurns: [],
      collected: {
        reason_for_visit: 'knee pain',
        doctor_name: 'Kumar',
        preferred_date: '2026-07-12',
        time_preference: 'evening',
      },
      messageText: 'Any evening slots?',
    });

    expect(outcome.kind).toBe('agent');
    expect(llmChat).toHaveBeenCalledTimes(2);
    expect(llmChat.mock.calls[0]?.[0]?.model).toBe('sarvam-105b');
    expect(llmChat.mock.calls[1]?.[0]?.model).toBe('sarvam-30b');
  });
});
