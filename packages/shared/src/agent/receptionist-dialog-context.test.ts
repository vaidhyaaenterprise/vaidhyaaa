import { describe, expect, it } from 'vitest';

import { buildReceptionistDialogUserPayload } from './receptionist-dialog-payload';
import { shouldPreserveActiveTaskOnTemplate } from './receptionist-task-context';

describe('shouldPreserveActiveTaskOnTemplate', () => {
  it('preserves active task for clarify and knowledge side-answer templates', () => {
    expect(shouldPreserveActiveTaskOnTemplate('clarify.which_detail_resume')).toBe(true);
    expect(shouldPreserveActiveTaskOnTemplate('knowledge.answer')).toBe(true);
    expect(shouldPreserveActiveTaskOnTemplate('booking.ask_problem_or_doctor')).toBe(false);
  });
});

describe('buildReceptionistDialogUserPayload', () => {
  it('includes assistant context and recent turns', () => {
    const payload = buildReceptionistDialogUserPayload({
      clinicId: 'c1',
      sessionId: 's1',
      messageText: 'doctor Kumar ah paakanum',
      languageCode: 'ta_tanglish',
      currentFlow: 'booking',
      currentState: 'ASK_PROBLEM_OR_DOCTOR',
      lastAssistantMessageText: 'Endha doctor-a paakanum?',
      lastAssistantTemplateKey: 'booking.ask_problem_or_doctor',
      recentTurns: [
        { role: 'assistant', text: 'Endha doctor-a paakanum?', templateKey: 'booking.ask_problem_or_doctor' },
        { role: 'patient', text: 'doctor Kumar ah paakanum' },
      ],
      collected: {},
      clinicCapabilities: [],
      clinicContextSummary: {
        clinicName: 'Demo Clinic',
        defaultLanguageCode: 'ta_tanglish',
        enabledLanguages: ['ta_tanglish'],
        activeServices: [],
      },
    });

    expect(payload.lastAssistantMessageText).toBe('Endha doctor-a paakanum?');
    expect(payload.recentTurns).toHaveLength(2);
    expect(payload.currentState).toBe('ASK_PROBLEM_OR_DOCTOR');
  });
});
