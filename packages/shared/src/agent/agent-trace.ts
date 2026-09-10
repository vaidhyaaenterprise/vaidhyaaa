export type AgentTrace = {
  messageId: string;
  sessionId: string;
  clinicId: string;
  currentFlowBefore: string;
  currentStateBefore: string;
  currentFlowAfter: string;
  currentStateAfter: string;
  globalIntent: string;
  globalIntentConfidence: number | null;
  activeStateInterpreterCalled: boolean;
  activeStateRecognizedAs: string | null;
  serviceRouterCalled: boolean;
  serviceRouterMatchedServiceId: string | null;
  knowledgeSearchCalled: boolean;
  fallbackReason: string | null;
  replyTemplateKey: string;
  actionsProposed: string[];
  actionsExecuted: string[];
};

export type BuildAgentTraceInput = {
  messageId: string;
  sessionId: string;
  clinicId: string;
  flowBefore: string;
  stateBefore: string;
  flowAfter: string;
  stateAfter: string;
  intent: string;
  templateKey: string;
  debug?: Record<string, unknown> | null;
};

function readClassification(debug: Record<string, unknown> | null | undefined): {
  confidence: number | null;
} {
  const classification = debug?.classification;
  if (!classification || typeof classification !== 'object') {
    return { confidence: null };
  }
  const confidence = (classification as { confidence?: unknown }).confidence;
  return {
    confidence: typeof confidence === 'number' ? confidence : null,
  };
}

export function buildAgentTrace(input: BuildAgentTraceInput): AgentTrace {
  const debug = input.debug ?? {};
  const { confidence } = readClassification(debug);
  const recognizedAs =
    typeof debug.recognized_as === 'string'
      ? debug.recognized_as
      : typeof debug.recognizedAs === 'string'
        ? debug.recognizedAs
        : null;

  const activeStateInterpreterCalled =
    debug.interpreter === 'state_entity_extractor' ||
    debug.active_state_interpreter_called === true ||
    recognizedAs !== null;

  const serviceRouterCalled = debug.service_router_called === true;
  const serviceRouterMatchedServiceId =
    typeof debug.service_router_matched_service_id === 'string'
      ? debug.service_router_matched_service_id
      : null;

  const knowledgeSearchCalled =
    debug.knowledge_search_called === true ||
    debug.source === 'knowledge_base' ||
    typeof debug.knowledge_id === 'string';

  const fallbackReason =
    typeof debug.fallback_reason === 'string'
      ? debug.fallback_reason
      : typeof debug.skipped_reason === 'string'
        ? debug.skipped_reason
        : input.templateKey === 'unknown.clarify'
          ? 'unknown_intent'
          : null;

  const actionsProposed = Array.isArray(debug.actions_proposed)
    ? debug.actions_proposed.filter((value): value is string => typeof value === 'string')
    : [];
  const actionsExecuted = Array.isArray(debug.actions_executed)
    ? debug.actions_executed.filter((value): value is string => typeof value === 'string')
    : [];

  return {
    messageId: input.messageId,
    sessionId: input.sessionId,
    clinicId: input.clinicId,
    currentFlowBefore: input.flowBefore,
    currentStateBefore: input.stateBefore,
    currentFlowAfter: input.flowAfter,
    currentStateAfter: input.stateAfter,
    globalIntent: input.intent,
    globalIntentConfidence: confidence,
    activeStateInterpreterCalled,
    activeStateRecognizedAs: recognizedAs,
    serviceRouterCalled,
    serviceRouterMatchedServiceId,
    knowledgeSearchCalled,
    fallbackReason,
    replyTemplateKey: input.templateKey,
    actionsProposed,
    actionsExecuted,
  };
}

export function sanitizeAuditMessagePreview(messageText: string, maxLength = 120): string {
  return messageText
    .replace(/\+?\d{10,12}/g, '[phone-redacted]')
    .replace(/sk-[a-z0-9]+/gi, '[api-key-redacted]')
    .replace(/sarvam[_-]?api[_-]?key[=:]\S+/gi, '[api-key-redacted]')
    .trim()
    .slice(0, maxLength);
}
