import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type ConversationSessionRow, type Repositories } from '@vaidya/db';
import { BOOKING_FLOW, type IntentClassifierResult, type MessageTemplateKey } from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';
import { TemplateRenderer } from '../conversation/template-renderer.service';

import {
  resolveTimingScopeFromClassification,
  formatClinicHoursText,
  formatDayHoursText,
  resolveTodayDayOfWeek,
} from './structured-info-field-extractor';
import { appendBookingResumeText } from './booking-resume.helper';

export type TimingHandlerInput = {
  session: ConversationSessionRow;
  messageText: string;
  classification: IntentClassifierResult;
  preserveBooking?: boolean;
};

export type TimingHandlerResult = {
  intent: string;
  templateKey: MessageTemplateKey;
  templateVariables: Record<string, string>;
  flowAfter: string;
  stateAfter: string;
  collectedJson: Record<string, unknown>;
};

@Injectable()
export class TimingHandler {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(TemplateRenderer) private readonly templateRenderer: TemplateRenderer,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async handle(input: TimingHandlerInput): Promise<TimingHandlerResult> {
    const { session, classification, preserveBooking = false } = input;
    const stateBefore = session.currentState;
    const [clinic] = await this.repos.clinics.getClinicLocation(session.clinicId);
    const timezone = clinic?.timezone ?? 'Asia/Kolkata';
    const hours = await this.repos.slots.listClinicHours(session.clinicId);
    const scope = resolveTimingScopeFromClassification(classification, timezone);

    let templateKey: MessageTemplateKey;
    let templateVariables: Record<string, string>;

    if (scope.kind === 'general') {
      templateKey = 'timing.answer';
      templateVariables = {
        timing_text: formatClinicHoursText(hours),
      };
    } else {
      const dayOfWeek = scope.kind === 'today' ? resolveTodayDayOfWeek(timezone) : scope.dayOfWeek;
      const dayName = scope.kind === 'today' ? 'Today' : scope.dayName;
      const dayHours = hours.filter((row) => row.dayOfWeek === dayOfWeek);

      if (dayHours.length === 0) {
        templateKey = 'timing.day_closed';
        templateVariables = { day_name: dayName };
      } else {
        templateKey = 'timing.day_answer';
        templateVariables = {
          day_name: dayName,
          timing_text: formatDayHoursText(dayHours),
        };
      }
    }

    const rendered = await this.templateRenderer.render(
      templateKey,
      session.languageCode as 'ta_tanglish' | 'english',
      templateVariables,
    );

    let answerText = rendered.message_text;
    if (preserveBooking) {
      answerText = await appendBookingResumeText(
        this.templateRenderer,
        answerText,
        session,
        session.collectedJson as Record<string, unknown>,
      );
      return {
        intent: 'ask_timing',
        templateKey: 'knowledge.answer',
        templateVariables: { answer_text: answerText },
        flowAfter: session.currentFlow,
        stateAfter: stateBefore,
        collectedJson: session.collectedJson as Record<string, unknown>,
      };
    }

    return {
      intent: 'ask_timing',
      templateKey,
      templateVariables,
      flowAfter: 'none',
      stateAfter: 'IDLE',
      collectedJson: {},
    };
  }
}
