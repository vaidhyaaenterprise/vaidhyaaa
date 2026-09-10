import { readAwaitingTerminalAck } from './terminal-ack';
import { resolveDialogCapabilityHandler } from './dialog-capability-handlers';
import {
  detectDialogSafety,
  detectSideQuestionCapability,
  extractDialogEntities,
  isBookingIntent,
  isComplaintOrFrustration,
  isConfirmationUtterance,
  isCorrectionUtterance,
  isGreetingUtterance,
  isHumanStaffRequest,
  isLifecycleIntent,
  isOutOfScopeUtterance,
  isRejectionUtterance,
  isThanksOrClosing,
  isVagueInformationRequest,
} from './receptionist-dialog-move-detectors';
import type { ReceptionistDialogInput, ReceptionistDialogPlan } from './receptionist-dialog-types';
import { isFinalAssistantTemplate, parseActiveTask, resolveResumePromptTemplateKey } from './receptionist-task-context';

const CONFIRMATION_STATES = new Set([
  'CONFIRM_DETAILS',
  'CONFIRM_DOCTOR',
  'CONFIRM_CANCEL_REQUEST',
  'CONFIRM_RESCHEDULE_REQUEST',
]);

function basePlan(
  partial: Omit<ReceptionistDialogPlan, 'extractedEntities'> & {
    extractedEntities?: ReceptionistDialogPlan['extractedEntities'];
  },
): ReceptionistDialogPlan {
  return {
    extractedEntities: {},
    ...partial,
  };
}

function withHandler(
  capability: ReceptionistDialogPlan['capability'],
): NonNullable<ReceptionistDialogPlan['answerPlan']> {
  const meta = resolveDialogCapabilityHandler(capability);
  return {
    sourceOfTruth: meta.sourceOfTruth === 'none' ? 'fixed_template' : meta.sourceOfTruth,
    handler: meta.handler,
    mustNotUseKnowledge:
      capability === 'medical_advice_request' || capability === 'emergency',
    mustNotUseLLMFreeText: true,
  };
}

function hasActiveTask(input: ReceptionistDialogInput): boolean {
  return Boolean(input.activeTask) || (input.currentFlow !== 'none' && input.currentState !== 'IDLE');
}

function afterFinalMessage(input: ReceptionistDialogInput): boolean {
  const terminalAck = readAwaitingTerminalAck(input.collected);
  return (
    Boolean(input.lastCompletedTask) ||
    terminalAck === 'booking_complete' ||
    isFinalAssistantTemplate(input.lastAssistantTemplateKey)
  );
}

export function planReceptionistDialogMock(
  input: ReceptionistDialogInput,
  referenceDate = new Date().toISOString().slice(0, 10),
): ReceptionistDialogPlan {
  const text = input.messageText.trim();
  const entities = extractDialogEntities(text, referenceDate);
  const safety = detectDialogSafety(text);

  if (safety.isEmergency) {
    return basePlan({
      turnType: 'emergency_response',
      userMove: 'emergency_symptom',
      capability: 'emergency',
      confidence: 0.98,
      extractedEntities: entities,
      answerPlan: withHandler('emergency'),
      taskPlan: {
        shouldResumeActiveTask: false,
        shouldSuspendActiveTask: false,
        shouldEndActiveTask: true,
        shouldReleaseActiveHold: true,
        nextFlow: 'none',
        nextState: 'IDLE',
      },
      responseComposition: 'safety_reply_only',
    });
  }

  if (safety.isMedicalAdviceRequest) {
    const resume = hasActiveTask(input);
    return basePlan({
      turnType: 'medical_advice_refusal',
      userMove: 'medical_question',
      capability: 'medical_advice_request',
      confidence: 0.95,
      extractedEntities: entities,
      answerPlan: withHandler('medical_advice_request'),
      taskPlan: {
        shouldResumeActiveTask: resume,
        shouldSuspendActiveTask: false,
        shouldEndActiveTask: false,
        shouldReleaseActiveHold: false,
        resumePromptKey: resume ? resolveResumePromptTemplateKey(input.activeTask) : null,
      },
      responseComposition: resume ? 'answer_then_resume_prompt' : 'safety_reply_only',
    });
  }

  if (isThanksOrClosing(text)) {
    if (afterFinalMessage(input)) {
      return basePlan({
        turnType: 'complete_acknowledgement',
        userMove: 'thanks_or_closing',
        capability: 'thanks_acknowledgement',
        confidence: 0.95,
        answerPlan: withHandler('thanks_acknowledgement'),
        taskPlan: {
          shouldResumeActiveTask: false,
          shouldSuspendActiveTask: false,
          shouldEndActiveTask: true,
          shouldReleaseActiveHold: false,
          nextFlow: 'none',
          nextState: 'IDLE',
        },
        responseComposition: 'ack_then_offer_help',
      });
    }
    if (input.lastAssistantTemplateKey === 'unknown.clarify') {
      return basePlan({
        turnType: 'complete_acknowledgement',
        userMove: 'thanks_or_closing',
        capability: 'thanks_acknowledgement',
        confidence: 0.9,
        answerPlan: withHandler('thanks_acknowledgement'),
        taskPlan: {
          shouldResumeActiveTask: false,
          shouldSuspendActiveTask: false,
          shouldEndActiveTask: false,
          shouldReleaseActiveHold: false,
        },
        responseComposition: 'ack_then_offer_help',
      });
    }
    if (input.activeTask && CONFIRMATION_STATES.has(input.activeTask.state) && isConfirmationUtterance(text)) {
      return basePlan({
        turnType: 'continue_current_task',
        userMove: 'confirmation',
        capability: 'book_appointment',
        confidence: 0.9,
        extractedEntities: entities,
        answerPlan: withHandler('book_appointment'),
        taskPlan: {
          shouldResumeActiveTask: true,
          shouldSuspendActiveTask: false,
          shouldEndActiveTask: false,
          shouldReleaseActiveHold: false,
        },
        responseComposition: 'single_reply',
      });
    }
  }

  if (isHumanStaffRequest(text)) {
    return basePlan({
      turnType: 'handoff_to_staff',
      userMove: 'human_request',
      capability: 'ask_human_agent',
      confidence: 0.92,
      extractedEntities: entities,
      answerPlan: withHandler('ask_human_agent'),
      taskPlan: {
        shouldResumeActiveTask: false,
        shouldSuspendActiveTask: hasActiveTask(input),
        shouldEndActiveTask: true,
        shouldReleaseActiveHold: true,
        nextFlow: 'handoff',
        nextState: 'ASK_REASON_OPTIONAL',
      },
      responseComposition: 'single_reply',
    });
  }

  if (isOutOfScopeUtterance(text)) {
    const resume = hasActiveTask(input);
    return basePlan({
      turnType: 'out_of_scope_redirect',
      userMove: 'out_of_scope',
      capability: 'out_of_scope',
      confidence: 0.9,
      extractedEntities: { ...entities, topic: text },
      answerPlan: withHandler('out_of_scope'),
      taskPlan: {
        shouldResumeActiveTask: resume,
        shouldSuspendActiveTask: false,
        shouldEndActiveTask: false,
        shouldReleaseActiveHold: false,
        resumePromptKey: resume ? resolveResumePromptTemplateKey(input.activeTask) : null,
      },
      responseComposition: resume ? 'answer_then_resume_prompt' : 'single_reply',
    });
  }

  if (isVagueInformationRequest(text)) {
    const keepTask = hasActiveTask(input);
    return basePlan({
      turnType: keepTask ? 'ask_clarification_and_keep_task' : 'ask_clarification',
      userMove: 'vague_information_request',
      capability: 'unknown',
      confidence: 0.88,
      extractedEntities: entities,
      answerPlan: {
        sourceOfTruth: 'fixed_template',
        handler: 'UnknownHandler',
        mustNotUseLLMFreeText: true,
      },
      taskPlan: {
        shouldResumeActiveTask: false,
        shouldSuspendActiveTask: false,
        shouldEndActiveTask: false,
        shouldReleaseActiveHold: false,
      },
      responseComposition: 'clarify_then_wait',
      clarificationReason: 'vague_information_request',
    });
  }

  const sideCapability = detectSideQuestionCapability(text);
  if (sideCapability) {
    const resume = hasActiveTask(input);
    return basePlan({
      turnType: resume ? 'answer_question_and_resume' : 'answer_question',
      userMove: 'side_question',
      capability: sideCapability,
      confidence: 0.9,
      extractedEntities: entities,
      answerPlan: withHandler(sideCapability),
      taskPlan: {
        shouldResumeActiveTask: resume,
        shouldSuspendActiveTask: false,
        shouldEndActiveTask: false,
        shouldReleaseActiveHold: false,
        resumePromptKey: resume ? resolveResumePromptTemplateKey(input.activeTask) : null,
      },
      responseComposition: resume ? 'answer_then_resume_prompt' : 'single_reply',
    });
  }

  if (isCorrectionUtterance(text)) {
    return basePlan({
      turnType: 'continue_current_task',
      userMove: 'correction',
      capability: 'book_appointment',
      confidence: 0.85,
      extractedEntities: {
        ...entities,
        correctionField: entities.date ? 'date' : entities.doctorName ? 'doctor' : 'reason',
        correctionValue: entities.date ?? entities.doctorName ?? entities.reasonForVisit ?? text,
      },
      answerPlan: withHandler('book_appointment'),
      taskPlan: {
        shouldResumeActiveTask: true,
        shouldSuspendActiveTask: false,
        shouldEndActiveTask: false,
        shouldReleaseActiveHold: false,
      },
      responseComposition: 'single_reply',
    });
  }

  const lifecycle = isLifecycleIntent(text);
  if (lifecycle && !hasActiveTask(input)) {
    return basePlan({
      turnType: 'start_new_task',
      userMove: 'new_request',
      capability: lifecycle,
      confidence: 0.88,
      extractedEntities: entities,
      answerPlan: withHandler(lifecycle),
      taskPlan: {
        shouldResumeActiveTask: false,
        shouldSuspendActiveTask: false,
        shouldEndActiveTask: false,
        shouldReleaseActiveHold: false,
        nextFlow: lifecycle === 'cancel_appointment' ? 'cancel' : 'reschedule',
        nextState: 'IDLE',
      },
      responseComposition: 'single_reply',
    });
  }

  const activeTaskSnapshot = input.activeTask ?? parseActiveTask(input.collected);

  if (activeTaskSnapshot && isRejectionUtterance(text)) {
    if (activeTaskSnapshot.state === 'CONFIRM_CANCEL_REQUEST') {
      return basePlan({
        turnType: 'continue_current_task',
        userMove: 'rejection',
        capability: 'cancel_appointment',
        confidence: 0.9,
        answerPlan: withHandler('cancel_appointment'),
        taskPlan: {
          shouldResumeActiveTask: true,
          shouldSuspendActiveTask: false,
          shouldEndActiveTask: false,
          shouldReleaseActiveHold: false,
        },
        responseComposition: 'single_reply',
      });
    }
    if (activeTaskSnapshot.flow === 'booking') {
      return basePlan({
        turnType: 'cancel_current_task',
        userMove: 'rejection',
        capability: 'book_appointment',
        confidence: 0.88,
        answerPlan: withHandler('book_appointment'),
        taskPlan: {
          shouldResumeActiveTask: false,
          shouldSuspendActiveTask: false,
          shouldEndActiveTask: true,
          shouldReleaseActiveHold: true,
          nextFlow: 'none',
          nextState: 'IDLE',
        },
        responseComposition: 'single_reply',
      });
    }
  }

  if (hasActiveTask(input)) {
    if (entities.reasonForVisit || entities.date || entities.timePreference || entities.doctorName) {
      return basePlan({
        turnType: 'continue_current_task',
        userMove: 'answer_to_previous_question',
        capability: 'book_appointment',
        confidence: 0.86,
        extractedEntities: entities,
        answerPlan: withHandler('book_appointment'),
        taskPlan: {
          shouldResumeActiveTask: true,
          shouldSuspendActiveTask: false,
          shouldEndActiveTask: false,
          shouldReleaseActiveHold: false,
        },
        responseComposition: 'single_reply',
      });
    }
    if (isComplaintOrFrustration(text)) {
      return basePlan({
        turnType: 'ask_clarification_and_keep_task',
        userMove: 'complaint',
        capability: 'unknown',
        confidence: 0.75,
        answerPlan: withHandler('unknown'),
        taskPlan: {
          shouldResumeActiveTask: false,
          shouldSuspendActiveTask: false,
          shouldEndActiveTask: false,
          shouldReleaseActiveHold: false,
        },
        responseComposition: 'clarify_then_wait',
        clarificationReason: 'frustration_detected',
      });
    }
  }

  if (!hasActiveTask(input)) {
    if (isGreetingUtterance(text)) {
      return basePlan({
        turnType: 'start_new_task',
        userMove: 'smalltalk',
        capability: 'greeting_smalltalk',
        confidence: 0.9,
        answerPlan: withHandler('greeting_smalltalk'),
        taskPlan: {
          shouldResumeActiveTask: false,
          shouldSuspendActiveTask: false,
          shouldEndActiveTask: false,
          shouldReleaseActiveHold: false,
          nextFlow: 'booking',
          nextState: 'ASK_PROBLEM_OR_DOCTOR',
        },
        responseComposition: 'single_reply',
      });
    }
    if (isBookingIntent(text)) {
      return basePlan({
        turnType: 'start_new_task',
        userMove: 'new_request',
        capability: 'book_appointment',
        confidence: 0.88,
        extractedEntities: entities,
        answerPlan: withHandler('book_appointment'),
        taskPlan: {
          shouldResumeActiveTask: false,
          shouldSuspendActiveTask: false,
          shouldEndActiveTask: false,
          shouldReleaseActiveHold: false,
          nextFlow: 'booking',
          nextState: 'ASK_PROBLEM_OR_DOCTOR',
        },
        responseComposition: 'single_reply',
      });
    }
  }

  return basePlan({
    turnType: 'unknown_safe_fallback',
    userMove: 'unknown',
    capability: 'unknown',
    confidence: 0.35,
    extractedEntities: entities,
    answerPlan: withHandler('unknown'),
    taskPlan: {
      shouldResumeActiveTask: hasActiveTask(input),
      shouldSuspendActiveTask: false,
      shouldEndActiveTask: false,
      shouldReleaseActiveHold: false,
      resumePromptKey: hasActiveTask(input)
        ? resolveResumePromptTemplateKey(input.activeTask)
        : null,
    },
    responseComposition: hasActiveTask(input) ? 'clarify_then_wait' : 'single_reply',
    clarificationReason: 'unrecognized_utterance',
  });
}
