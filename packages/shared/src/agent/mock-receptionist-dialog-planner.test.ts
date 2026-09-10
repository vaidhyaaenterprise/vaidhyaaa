import { describe, expect, it } from 'vitest';

import { attachActiveTask } from './receptionist-task-context';
import { planReceptionistDialogMock } from './mock-receptionist-dialog-planner';
import type { ReceptionistDialogInput } from './receptionist-dialog-types';

function baseInput(overrides: Partial<ReceptionistDialogInput> = {}): ReceptionistDialogInput {
  return {
    clinicId: 'clinic-1',
    sessionId: 'session-1',
    messageText: 'hello',
    languageCode: 'ta_tanglish',
    currentFlow: 'none',
    currentState: 'IDLE',
    collected: {},
    clinicCapabilities: [],
    clinicContextSummary: {
      clinicName: 'Test Clinic',
      defaultLanguageCode: 'ta_tanglish',
      enabledLanguages: ['ta_tanglish', 'english'],
      activeServices: [],
    },
    ...overrides,
  };
}

describe('planReceptionistDialogMock', () => {
  it('acknowledges thanks after booking.created_pending', () => {
    const plan = planReceptionistDialogMock(
      baseInput({
        currentFlow: 'booking',
        currentState: 'DONE',
        lastAssistantTemplateKey: 'booking.created_pending',
        collected: { awaiting_terminal_ack: 'booking_complete' },
        messageText: 'thanks',
      }),
    );
    expect(plan.turnType).toBe('complete_acknowledgement');
    expect(plan.capability).toBe('thanks_acknowledgement');
  });

  it('asks which detail for vague information during booking', () => {
    const plan = planReceptionistDialogMock(
      baseInput({
        currentFlow: 'booking',
        currentState: 'ASK_PROBLEM_OR_DOCTOR',
        collected: attachActiveTask({}, {
          flow: 'booking',
          state: 'ASK_PROBLEM_OR_DOCTOR',
          promptKey: 'booking.ask_problem_or_doctor',
          expectedFields: ['reason_for_visit'],
        }),
        messageText: 'I need some details',
      }),
    );
    expect(plan.turnType).toBe('ask_clarification_and_keep_task');
    expect(plan.userMove).toBe('vague_information_request');
  });

  it('answers timing side question and resumes booking', () => {
    const plan = planReceptionistDialogMock(
      baseInput({
        currentFlow: 'booking',
        currentState: 'ASK_PROBLEM_OR_DOCTOR',
        collected: attachActiveTask({}, {
          flow: 'booking',
          state: 'ASK_PROBLEM_OR_DOCTOR',
          promptKey: 'booking.ask_problem_or_doctor',
          expectedFields: ['reason_for_visit'],
        }),
        messageText: 'clinic timing enna?',
      }),
    );
    expect(plan.turnType).toBe('answer_question_and_resume');
    expect(plan.capability).toBe('ask_timing');
    expect(plan.answerPlan?.handler).toBe('TimingHandler');
    expect(plan.taskPlan.shouldResumeActiveTask).toBe(true);
  });
});
