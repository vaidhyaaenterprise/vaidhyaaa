import { Inject, Injectable } from '@nestjs/common';

import type { ConversationSessionRow } from '@vaidya/db';
import {
  BOOKING_FLOW,
  FEE_CLARIFICATION_FLOW,
  RESCHEDULE_FLOW,
  capabilityUsesApprovedKnowledge,
  shouldRouteToStructuredInfoHandler,
  type IntentClassifierResult,
  type MessageTemplateKey,
} from '@vaidya/shared';

import { DoctorAvailabilityHandler } from './doctor-availability-handler.service';
import { FeeHandler } from './fee-handler.service';
import { LocationHandler } from './location-handler.service';
import { TimingHandler } from './timing-handler.service';
import { KnowledgeRuntimeHandler } from '../knowledge/knowledge-runtime-handler.service';

export type StructuredInfoHandlerInput = {
  session: ConversationSessionRow;
  messageText: string;
  classification: IntentClassifierResult;
};

export type StructuredInfoHandlerResult = {
  intent: string;
  templateKey: MessageTemplateKey;
  templateVariables: Record<string, string>;
  flowBefore: string;
  stateBefore: string;
  flowAfter: string;
  stateAfter: string;
  collectedJson: Record<string, unknown>;
};

@Injectable()
export class StructuredInfoHandler {
  constructor(
    @Inject(FeeHandler) private readonly feeHandler: FeeHandler,
    @Inject(TimingHandler) private readonly timingHandler: TimingHandler,
    @Inject(LocationHandler) private readonly locationHandler: LocationHandler,
    @Inject(DoctorAvailabilityHandler)
    private readonly doctorAvailabilityHandler: DoctorAvailabilityHandler,
    @Inject(KnowledgeRuntimeHandler)
    private readonly knowledgeRuntimeHandler: KnowledgeRuntimeHandler,
  ) {}

  handlesIntent(intent: string): boolean {
    return shouldRouteToStructuredInfoHandler(intent);
  }

  async handle(input: StructuredInfoHandlerInput): Promise<StructuredInfoHandlerResult> {
    const { session, messageText, classification } = input;
    const flowBefore = session.currentFlow;
    const stateBefore = session.currentState;
    const preserveBooking =
      flowBefore === BOOKING_FLOW || flowBefore === RESCHEDULE_FLOW;

    if (flowBefore === FEE_CLARIFICATION_FLOW) {
      const feeResult = await this.feeHandler.handleClarification({
        session,
        messageText,
        classification,
        preserveBooking: false,
      });
      return this.wrapResult(flowBefore, stateBefore, feeResult);
    }

    const intent = classification.intent;
    let result:
      | Awaited<ReturnType<FeeHandler['handle']>>
      | Awaited<ReturnType<TimingHandler['handle']>>
      | Awaited<ReturnType<LocationHandler['handle']>>
      | Awaited<ReturnType<DoctorAvailabilityHandler['handle']>>
      | Awaited<ReturnType<KnowledgeRuntimeHandler['handle']>>;

    if (intent === 'ask_fee') {
      result = await this.feeHandler.handle({
        session,
        messageText,
        classification,
        preserveBooking,
      });
    } else if (intent === 'ask_timing') {
      result = await this.timingHandler.handle({
        session,
        messageText,
        classification,
        preserveBooking,
      });
    } else if (intent === 'ask_location') {
      result = await this.locationHandler.handle({
        session,
        classification,
        preserveBooking,
      });
    } else if (intent === 'ask_doctor_availability') {
      result = await this.doctorAvailabilityHandler.handle({
        session,
        messageText,
        classification,
        preserveBooking,
      });
    } else if (capabilityUsesApprovedKnowledge(intent)) {
      result = await this.knowledgeRuntimeHandler.handle({
        session,
        messageText,
        classification,
        preserveBooking,
      });
    } else {
      throw new Error(`Unsupported structured info intent: ${intent}`);
    }

    return this.wrapResult(flowBefore, stateBefore, result);
  }

  private wrapResult(
    flowBefore: string,
    stateBefore: string,
    result: {
      intent: string;
      templateKey: MessageTemplateKey;
      templateVariables: Record<string, string>;
      flowAfter: string;
      stateAfter: string;
      collectedJson: Record<string, unknown>;
    },
  ): StructuredInfoHandlerResult {
    return {
      intent: result.intent,
      templateKey: result.templateKey,
      templateVariables: result.templateVariables,
      flowBefore,
      stateBefore,
      flowAfter: result.flowAfter,
      stateAfter: result.stateAfter,
      collectedJson: result.collectedJson,
    };
  }
}
