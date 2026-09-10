import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type ConversationSessionRow, type Repositories } from '@vaidya/db';
import { BOOKING_FLOW, type IntentClassifierResult, type MessageTemplateKey } from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';
import { TemplateRenderer } from '../conversation/template-renderer.service';

import { appendBookingResumeText } from './booking-resume.helper';

export type LocationHandlerInput = {
  session: ConversationSessionRow;
  classification: IntentClassifierResult;
  preserveBooking?: boolean;
};

export type LocationHandlerResult = {
  intent: string;
  templateKey: MessageTemplateKey;
  templateVariables: Record<string, string>;
  flowAfter: string;
  stateAfter: string;
  collectedJson: Record<string, unknown>;
};

@Injectable()
export class LocationHandler {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(TemplateRenderer) private readonly templateRenderer: TemplateRenderer,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async handle(input: LocationHandlerInput): Promise<LocationHandlerResult> {
    const { session, preserveBooking = false } = input;
    const stateBefore = session.currentState;
    const [clinic] = await this.repos.clinics.getClinicLocation(session.clinicId);
    const addressParts = [
      clinic?.addressLine1,
      clinic?.addressLine2,
      clinic?.city,
      clinic?.state,
    ].filter((part): part is string => Boolean(part));
    const clinicAddress = addressParts.join(', ') || 'Address not available';

    const rendered = await this.templateRenderer.render(
      'location.answer',
      session.languageCode as 'ta_tanglish' | 'english',
      { clinic_address: clinicAddress },
    );

    if (preserveBooking) {
      const answerText = await appendBookingResumeText(
        this.templateRenderer,
        rendered.message_text,
        session,
        session.collectedJson as Record<string, unknown>,
      );
      return {
        intent: 'ask_location',
        templateKey: 'knowledge.answer',
        templateVariables: { answer_text: answerText },
        flowAfter: session.currentFlow,
        stateAfter: stateBefore,
        collectedJson: session.collectedJson as Record<string, unknown>,
      };
    }

    return {
      intent: 'ask_location',
      templateKey: 'location.answer',
      templateVariables: { clinic_address: clinicAddress },
      flowAfter: 'none',
      stateAfter: 'IDLE',
      collectedJson: {},
    };
  }
}
