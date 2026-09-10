# A10 - Agent Capability Baseline and Failure Audit

## Purpose

Before changing prompts blindly, create visibility into why Vaidya fails in real-world conversations.

## Implement

1. Add agent debug trace for every message when DEBUG_API=true.
2. Add `agent:evaluate:mock` and `agent:evaluate:sample` commands if not already present.
3. Create a realistic receptionist utterance dataset.
4. Store low-confidence/unknown cases for review.
5. Add audit events for classifier/router/interpreter failures.

## Required trace fields

```ts
{
  messageId,
  sessionId,
  clinicId,
  currentFlowBefore,
  currentStateBefore,
  currentFlowAfter,
  currentStateAfter,
  globalIntent,
  globalIntentConfidence,
  activeStateInterpreterCalled,
  activeStateRecognizedAs,
  serviceRouterCalled,
  serviceRouterMatchedServiceId,
  knowledgeSearchCalled,
  fallbackReason,
  replyTemplateKey,
  actionsProposed,
  actionsExecuted
}
```

## Dataset categories

Create/extend golden dataset with at least 20 messages per category:

- booking
- compound booking
- doctor-name booking
- follow-up booking
- cancel
- reschedule
- fee
- timing
- location
- doctor availability
- previsit/knowledge
- insurance
- human handoff
- emergency
- medical advice
- language switch
- unsupported service
- random out-of-scope
- side question during booking
- active-state short replies

## Important

Do not add business behavior changes in this milestone except trace/audit/evaluation.

## Acceptance

- Evaluation command prints pass/fail by category.
- Unknown/low-confidence cases are captured with privacy-safe data.
- No raw API keys or sensitive raw LLM payloads are logged in production mode.
