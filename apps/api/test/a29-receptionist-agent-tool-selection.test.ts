import { describe, expect, it } from 'vitest';

import {
  buildReceptionistAgentSystemPrompt,
  buildReceptionistAgentSystemPromptForProvider,
  buildReceptionistAgentSystemPromptSarvam,
  RECEPTIONIST_AGENT_SYSTEM_PROMPT_SARVAM,
  SARVAM_AGENT_MAX_SYSTEM_PROMPT_CHARS,
} from '@vaidya/shared';

import { getReceptionistAgentToolsForRequest } from '../src/modules/conversation/receptionist-agent-tool-selection';

const CLINIC = 'Sri Murugan Clinic';

describe('A29 receptionist agent Sarvam payload strategy', () => {
  it('filters tools based on booking state', () => {
    const emptyCollect = getReceptionistAgentToolsForRequest('sarvam', { collected: {} });
    const openAiEmpty = getReceptionistAgentToolsForRequest('openai_compatible', { collected: {} });

    const alwaysAvailable = [
      'get_clinic_info',
      'search_knowledge_base',
      'get_appointment_status',
      'cancel_appointment',
      'reschedule_appointment',
      'request_human_callback',
    ];

    expect(emptyCollect).toHaveLength(6);
    for (const name of alwaysAvailable) {
      expect(emptyCollect.map((tool) => tool.function.name)).toContain(name);
    }
    expect(openAiEmpty).toHaveLength(6);

    const asDateCollected = getReceptionistAgentToolsForRequest('sarvam', {
      collected: { reason_for_visit: 'knee pain', preferred_date: '2026-07-27' },
    });
    const asDateNames = asDateCollected.map((tool) => tool.function.name);
    expect(asDateNames).toContain('update_booking_state');
    expect(asDateNames).toContain('check_slot_availability');
    expect(asDateNames).not.toContain('create_appointment_request');
    expect(asDateCollected).toHaveLength(8);

    const confirmCollected = getReceptionistAgentToolsForRequest('sarvam', {
      collected: {
        reason_for_visit: 'knee pain',
        preferred_date: '2026-07-27',
        selected_slot_id: 'slot-1',
        patient_name: 'Priya',
      },
    });
    const confirmNames = confirmCollected.map((tool) => tool.function.name);
    expect(confirmNames).toContain('create_appointment_request');
    expect(confirmNames).toContain('update_booking_state');
    expect(confirmNames).toContain('check_slot_availability');
    expect(confirmCollected).toHaveLength(9);
  });

  it('uses the maximal Sarvam-safe system prompt with all major policy sections', () => {
    const full = buildReceptionistAgentSystemPrompt(CLINIC);
    const sarvam = buildReceptionistAgentSystemPromptSarvam(CLINIC);

    expect(sarvam.length).toBeLessThanOrEqual(SARVAM_AGENT_MAX_SYSTEM_PROMPT_CHARS);
    expect(sarvam.length).toBeGreaterThan(RECEPTIONIST_AGENT_SYSTEM_PROMPT_SARVAM.length - 5);
    expect(sarvam.length).toBeLessThan(full.length);
    expect(sarvam).toContain('BOOKING');
    expect(sarvam).toContain('check_slot_availability');
  });

  it('uses full prompt for non-Sarvam providers', () => {
    const openAi = buildReceptionistAgentSystemPromptForProvider('openai_compatible', CLINIC);
    expect(openAi).toBe(buildReceptionistAgentSystemPrompt(CLINIC));
    expect(openAi).toContain('TONE EXAMPLES');
  });
});
