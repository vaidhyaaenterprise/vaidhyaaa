import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';
import {
  BOOKING_FLOW,
  FEE_CLARIFICATION_FLOW,
  staffConfirmTemplateKey,
  type IntentClassifierResult,
  type MessageTemplateKey,
} from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';
import type { ConversationSessionRow } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';
import { TemplateRenderer } from '../conversation/template-renderer.service';

import {
  formatFeeAmount,
  isProcedureFeeFromClassification,
  resolveFeeVisitTypeFromClassification,
} from './structured-info-field-extractor';
import { appendBookingResumeText } from './booking-resume.helper';

export type FeeHandlerInput = {
  session: ConversationSessionRow;
  messageText: string;
  classification: IntentClassifierResult;
  preserveBooking?: boolean;
};

export type FeeHandlerResult = {
  intent: string;
  templateKey: MessageTemplateKey;
  templateVariables: Record<string, string>;
  flowAfter: string;
  stateAfter: string;
  collectedJson: Record<string, unknown>;
};

@Injectable()
export class FeeHandler {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(TemplateRenderer) private readonly templateRenderer: TemplateRenderer,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async handle(input: FeeHandlerInput): Promise<FeeHandlerResult> {
    const { session, classification, preserveBooking = false } = input;
    const flowBefore = session.currentFlow;
    const stateBefore = session.currentState;
    const activeFlow = preserveBooking ? flowBefore : BOOKING_FLOW;
    const rawCollected = (session.collectedJson ?? {}) as Record<string, unknown>;
    const visitType = resolveFeeVisitTypeFromClassification(classification);

    if (isProcedureFeeFromClassification(classification)) {
      return this.noAnswerFallback(session, preserveBooking);
    }

    const doctorFragment =
      classification.entities.doctorName ??
      (typeof rawCollected.fee_doctor_fragment === 'string'
        ? rawCollected.fee_doctor_fragment
        : null);

    if (!doctorFragment) {
      const askDoctor = await this.renderWithOptionalResume({
        session,
        templateKey: 'fee.ask_doctor',
        templateVariables: {},
        preserveBooking,
        collectedJson: preserveBooking
          ? (session.collectedJson as Record<string, unknown>)
          : { fee_visit_type: visitType, fee_clarification_pending: true },
        flowAfter: preserveBooking ? activeFlow : FEE_CLARIFICATION_FLOW,
        stateAfter: stateBefore,
      });
      return {
        intent: 'ask_fee',
        ...askDoctor,
      };
    }

    const doctors = await this.repos.clinical.findDoctorByNameFragment(
      session.clinicId,
      doctorFragment,
    );
    if (doctors.length === 0) {
      return {
        intent: 'ask_fee',
        templateKey: 'fee.not_found',
        templateVariables: {},
        flowAfter: preserveBooking ? activeFlow : flowBefore,
        stateAfter: stateBefore,
        collectedJson: preserveBooking
          ? (session.collectedJson as Record<string, unknown>)
          : {},
      };
    }

    const doctor = doctors[0]!;
    const [feeInfo] = await this.repos.clinical.getDoctorFeeInfo(session.clinicId, doctor.id);
    if (!feeInfo) {
      return {
        intent: 'ask_fee',
        templateKey: 'fee.not_found',
        templateVariables: { doctor_name: doctor.name },
        flowAfter: preserveBooking ? activeFlow : 'none',
        stateAfter: preserveBooking ? stateBefore : 'IDLE',
        collectedJson: preserveBooking
          ? (session.collectedJson as Record<string, unknown>)
          : {},
      };
    }

    const isFollowup = visitType === 'followup';
    const feeAmount = isFollowup ? feeInfo.followupFeeAmount : feeInfo.consultationFeeAmount;
    if (feeAmount === null || feeAmount === undefined || feeAmount === '') {
      return {
        intent: 'ask_fee',
        templateKey: 'fee.not_found',
        templateVariables: { doctor_name: doctor.name },
        flowAfter: preserveBooking ? activeFlow : 'none',
        stateAfter: preserveBooking ? stateBefore : 'IDLE',
        collectedJson: preserveBooking
          ? (session.collectedJson as Record<string, unknown>)
          : {},
      };
    }

    const templateKey: MessageTemplateKey = isFollowup ? 'fee.followup_answer' : 'fee.answer';

    const rendered = await this.renderWithOptionalResume({
      session,
      templateKey,
      templateVariables: {
        doctor_name: doctor.name,
        fee_amount: formatFeeAmount(feeAmount),
      },
      preserveBooking,
      collectedJson: preserveBooking
        ? (session.collectedJson as Record<string, unknown>)
        : {},
      flowAfter: preserveBooking ? activeFlow : 'none',
      stateAfter: preserveBooking ? stateBefore : 'IDLE',
    });

    return {
      intent: 'ask_fee',
      ...rendered,
    };
  }

  async handleClarification(input: FeeHandlerInput): Promise<FeeHandlerResult> {
    return this.handle({ ...input, preserveBooking: false });
  }

  private async noAnswerFallback(
    session: ConversationSessionRow,
    preserveBooking: boolean,
  ): Promise<FeeHandlerResult> {
    const staffKey = staffConfirmTemplateKey(session.currentFlow, !preserveBooking);
    const rendered = await this.renderWithOptionalResume({
      session,
      templateKey: staffKey,
      templateVariables: {},
      preserveBooking,
      collectedJson: preserveBooking
        ? (session.collectedJson as Record<string, unknown>)
        : {},
      flowAfter: preserveBooking ? session.currentFlow : 'none',
      stateAfter: preserveBooking ? session.currentState : 'IDLE',
    });
    return {
      intent: 'ask_fee',
      ...rendered,
    };
  }

  private async renderWithOptionalResume(input: {
    session: ConversationSessionRow;
    templateKey: MessageTemplateKey;
    templateVariables: Record<string, string>;
    preserveBooking: boolean;
    collectedJson: Record<string, unknown>;
    flowAfter: string;
    stateAfter: string;
  }): Promise<Omit<FeeHandlerResult, 'intent'>> {
    const rendered = await this.templateRenderer.render(
      input.templateKey,
      input.session.languageCode as 'ta_tanglish' | 'english',
      input.templateVariables,
    );

    let answerText = rendered.message_text;
    if (input.preserveBooking) {
      answerText = await appendBookingResumeText(
        this.templateRenderer,
        answerText,
        input.session,
        input.collectedJson,
      );
    }

    if (input.preserveBooking) {
      return {
        templateKey: 'knowledge.answer',
        templateVariables: { answer_text: answerText },
        flowAfter: input.flowAfter,
        stateAfter: input.stateAfter,
        collectedJson: input.collectedJson,
      };
    }

    if (input.templateKey === 'knowledge.no_answer' || input.templateKey.startsWith('scope.staff_confirm')) {
      return {
        templateKey: 'knowledge.answer',
        templateVariables: { answer_text: answerText },
        flowAfter: input.flowAfter,
        stateAfter: input.stateAfter,
        collectedJson: input.collectedJson,
      };
    }

    return {
      templateKey: input.templateKey,
      templateVariables: input.templateVariables,
      flowAfter: input.flowAfter,
      stateAfter: input.stateAfter,
      collectedJson: input.collectedJson,
    };
  }
}
