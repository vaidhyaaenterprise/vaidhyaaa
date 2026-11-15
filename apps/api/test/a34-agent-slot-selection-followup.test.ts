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
  it('rechecks a nearby time selected after the requested time was unavailable', async () => {
    const llmChat = vi.fn<ReceptionistAgentLlmPort['chat']>();
    const toolsExecute = vi.fn().mockImplementation(
      async (toolName: string, args: Record<string, unknown>) => {
        expect(toolName).toBe('check_slot_availability');
        const requestedTime = String(args.time);
        if (requestedTime === '10:45') {
          return {
            slots: [
              {
                slotId: '00000000-0000-0000-0000-000000000503',
                doctorName: 'Murugan',
                dateDisplay: '2026-11-20',
                time: '10:30',
                startTime: '2026-11-20 10:30:00',
                endTime: '2026-11-20 11:00:00',
              },
              {
                slotId: '00000000-0000-0000-0000-000000000504',
                doctorName: 'Murugan',
                dateDisplay: '2026-11-20',
                time: '11:00',
                startTime: '2026-11-20 11:00:00',
                endTime: '2026-11-20 11:30:00',
              },
            ],
            doctorId: '00000000-0000-0000-0000-000000000401',
            doctorName: 'Murugan',
            clinicServiceId: '00000000-0000-0000-0000-000000000301',
            preferredDate: '2026-11-20',
            availabilityStatus: 'same_day_alternative',
            requestedTime,
            requestedTimeAvailable: false,
            nearbySlotsText: '10:30, 11:00',
          };
        }

        expect(requestedTime).toBe('10:30');
        return {
          slots: [
            {
              slotId: '00000000-0000-0000-0000-000000000503',
              doctorName: 'Murugan',
              dateDisplay: '2026-11-20',
              time: '10:30',
              startTime: '2026-11-20 10:30:00',
              endTime: '2026-11-20 11:00:00',
            },
          ],
          doctorId: '00000000-0000-0000-0000-000000000401',
          doctorName: 'Murugan',
          clinicServiceId: '00000000-0000-0000-0000-000000000301',
          preferredDate: '2026-11-20',
          availabilityStatus: 'matched',
          requestedTime,
          requestedTimeAvailable: true,
          nearbySlotsText: '',
        };
      },
    );

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
    const baseInput = {
      clinicName: 'Demo Clinic',
      clinicId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000099',
      languageCode: 'english' as const,
      patientPhone: '+919876543210',
    };

    const unavailable = await service.handleTurn({
      ...baseInput,
      recentTurns: [],
      collected: {
        reason_for_visit: 'knee pain',
        doctor_id: '00000000-0000-0000-0000-000000000401',
        doctor_name: 'Murugan',
        clinic_service_id: '00000000-0000-0000-0000-000000000301',
        preferred_date: '2026-11-20',
      },
      messageText: '10:45',
    });

    expect(unavailable.kind).toBe('agent');
    if (unavailable.kind !== 'agent') {
      return;
    }
    expect(unavailable.result.replyText).toContain('Nearby times are 10:30, 11:00');
    expect(toolsExecute).toHaveBeenCalledTimes(1);

    const selectedNearby = await service.handleTurn({
      ...baseInput,
      recentTurns: [{ role: 'assistant' as const, text: unavailable.result.replyText }],
      lastAssistantMessageText: unavailable.result.replyText,
      collected: unavailable.result.updatedCollected,
      messageText: '10:30',
    });

    expect(selectedNearby.kind).toBe('agent');
    expect(toolsExecute).toHaveBeenCalledTimes(2);
    expect(toolsExecute).toHaveBeenLastCalledWith(
      'check_slot_availability',
      { time: '10:30' },
      expect.any(Object),
    );
    if (selectedNearby.kind === 'agent') {
      expect(selectedNearby.result.updatedCollected.selected_slot_id).toBe(
        '00000000-0000-0000-0000-000000000503',
      );
    }
    expect(llmChat).not.toHaveBeenCalled();
  });

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
