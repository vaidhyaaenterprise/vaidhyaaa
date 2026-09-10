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
  SARVAM_API_KEY: 'sk-test',
  RECEPTIONIST_AGENT_MAX_TOOL_ROUNDS: '4',
});

const proposedSlots = [
  {
    slot_id: '00000000-0000-0000-0000-000000000501',
    display_time: '8:00',
    start_time: '2026-07-13 20:00',
    end_time: '2026-07-13 20:15',
  },
  {
    slot_id: '00000000-0000-0000-0000-000000000502',
    display_time: '7:00',
    start_time: '2026-07-13 19:00',
    end_time: '2026-07-13 19:15',
  },
];

describe('A34 agent slot selection follow-up', () => {
  it('does not re-list slots after the patient already selected one', async () => {
    const llmChat = vi.fn<ReceptionistAgentLlmPort['chat']>();
    const toolsExecute = vi.fn();

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
        {
          role: 'assistant',
          text: 'Got it — 8:00. Shall I confirm the booking?',
        },
      ],
      collected: {
        reason_for_visit: 'knee pain',
        doctor_name: 'Murugan',
        preferred_date: '2026-07-13',
        time_preference: 'evening',
        proposed_slots: proposedSlots,
        selected_slot_id: '00000000-0000-0000-0000-000000000501',
      },
      messageText: '8:00',
      lastAssistantMessageText: 'Got it — 8:00. Shall I confirm the booking?',
    });

    expect(outcome.kind).toBe('agent');
    if (outcome.kind !== 'agent') {
      return;
    }

    expect(llmChat).not.toHaveBeenCalled();
    expect(toolsExecute).not.toHaveBeenCalled();
    expect(outcome.result.replyText).toBe('Got it — 8:00. Shall I confirm the booking?');
    expect(outcome.result.replyText).not.toContain('slots irukku');
    expect(outcome.result.debug?.booking_guided).toBeUndefined();
    expect(outcome.result.updatedCollected.selected_slot_id).toBe(
      '00000000-0000-0000-0000-000000000501',
    );
  });
});
