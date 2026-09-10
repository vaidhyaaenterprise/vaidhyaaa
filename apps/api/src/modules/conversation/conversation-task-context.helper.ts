import {
  attachActiveTask,
  buildActiveTaskForTemplate,
  isFinalAssistantTemplate,
  markTaskCompleted,
  parseActiveTask,
} from '@vaidya/shared';

import type { OrchestratorResult } from './conversation-orchestrator.service';

export function syncTaskContextOnOrchestratorResult(
  result: OrchestratorResult,
): OrchestratorResult {
  const collected = (result.collectedJson ?? {}) as Record<string, unknown>;
  const synced = applyTaskContextFromTemplate(
    result.templateKey,
    result.flowAfter,
    result.stateAfter,
    collected,
  );
  if (synced === collected) {
    return result;
  }
  return { ...result, collectedJson: synced };
}

export function applyTaskContextFromTemplate(
  templateKey: string,
  flowAfter: string,
  stateAfter: string,
  collectedJson: Record<string, unknown>,
): Record<string, unknown> {
  if (isFinalAssistantTemplate(templateKey)) {
    const flow =
      flowAfter !== 'none'
        ? flowAfter
        : (parseActiveTask(collectedJson)?.flow ?? 'booking');
    const next = markTaskCompleted(collectedJson, {
      flow,
      finalTemplateKey: templateKey,
    });
    if (collectedJson.awaiting_terminal_ack) {
      next.awaiting_terminal_ack = collectedJson.awaiting_terminal_ack;
    }
    return next;
  }

  const task = buildActiveTaskForTemplate(templateKey, flowAfter, stateAfter);
  if (task) {
    return attachActiveTask(collectedJson, task);
  }

  return collectedJson;
}
