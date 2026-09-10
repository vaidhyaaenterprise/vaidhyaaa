import { Inject, Injectable } from '@nestjs/common';

import {
  createRepositories,
  type ConversationSessionRow,
  type Repositories,
} from '@vaidya/db';
import { BOOKING_FLOW, type IntentClassifierResult, type MessageTemplateKey } from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';
import { SlotService } from '../slots/slot.service';
import { TemplateRenderer } from '../conversation/template-renderer.service';

import { slotDisplayTime } from '../booking/booking-field-extractor';
import { resolveAvailabilityTargetFromClassification } from './structured-info-field-extractor';
import { appendBookingResumeText } from './booking-resume.helper';

export type DoctorAvailabilityHandlerInput = {
  session: ConversationSessionRow;
  messageText: string;
  classification: IntentClassifierResult;
  preserveBooking?: boolean;
};

export type DoctorAvailabilityHandlerResult = {
  intent: string;
  templateKey: MessageTemplateKey;
  templateVariables: Record<string, string>;
  flowAfter: string;
  stateAfter: string;
  collectedJson: Record<string, unknown>;
};

@Injectable()
export class DoctorAvailabilityHandler {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(SlotService) private readonly slotService: SlotService,
    @Inject(TemplateRenderer) private readonly templateRenderer: TemplateRenderer,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async handle(input: DoctorAvailabilityHandlerInput): Promise<DoctorAvailabilityHandlerResult> {
    const { session, classification, preserveBooking = false } = input;
    const stateBefore = session.currentState;
    const doctorFragment = classification.entities.doctorName;

    if (!doctorFragment) {
      return {
        intent: 'ask_doctor_availability',
        templateKey: 'availability.not_available',
        templateVariables: { doctor_name: 'Doctor' },
        flowAfter: preserveBooking ? session.currentFlow : 'none',
        stateAfter: preserveBooking ? stateBefore : 'IDLE',
        collectedJson: preserveBooking
          ? (session.collectedJson as Record<string, unknown>)
          : {},
      };
    }

    const doctors = await this.repos.clinical.findDoctorByNameFragment(
      session.clinicId,
      doctorFragment,
    );
    if (doctors.length === 0) {
      return {
        intent: 'ask_doctor_availability',
        templateKey: 'availability.not_available',
        templateVariables: { doctor_name: doctorFragment },
        flowAfter: preserveBooking ? session.currentFlow : 'none',
        stateAfter: preserveBooking ? stateBefore : 'IDLE',
        collectedJson: preserveBooking
          ? (session.collectedJson as Record<string, unknown>)
          : {},
      };
    }

    const doctor = doctors[0]!;
    const mappings = await this.repos.clinical.listActiveDoctorServicesForDoctor(
      session.clinicId,
      doctor.id,
    );
    if (mappings.length === 0) {
      return {
        intent: 'ask_doctor_availability',
        templateKey: 'availability.not_available',
        templateVariables: { doctor_name: doctor.name },
        flowAfter: preserveBooking ? session.currentFlow : 'none',
        stateAfter: preserveBooking ? stateBefore : 'IDLE',
        collectedJson: preserveBooking
          ? (session.collectedJson as Record<string, unknown>)
          : {},
      };
    }

    const mapping = mappings[0]!;
    const [clinic] = await this.repos.clinics.getClinicLocation(session.clinicId);
    const timezone = clinic?.timezone ?? 'Asia/Kolkata';
    const target = resolveAvailabilityTargetFromClassification(classification, timezone);
    if (!target) {
      return this.wrapResult({
        session,
        preserveBooking,
        stateBefore,
        templateKey: 'availability.not_available',
        templateVariables: { doctor_name: doctor.name },
      });
    }

    const schedules = await this.repos.slots.listDoctorSchedules(
      session.clinicId,
      doctor.id,
      mapping.doctorServiceId,
    );
    const hasScheduleOnDate = schedules.some((row) => row.dayOfWeek === target.dayOfWeek);
    if (!hasScheduleOnDate) {
      return this.wrapResult({
        session,
        preserveBooking,
        stateBefore,
        templateKey: 'availability.not_available',
        templateVariables: { doctor_name: doctor.name },
      });
    }

    const slots = await this.slotService.findAvailableSlots(
      session.clinicId,
      doctor.id,
      mapping.clinicServiceId,
    );
    const dateSlots = slots.filter((slot) => slot.start_time.split(' ')[0] === target.dateStr);
    if (dateSlots.length === 0) {
      return this.wrapResult({
        session,
        preserveBooking,
        stateBefore,
        templateKey: 'availability.no_slots',
        templateVariables: {},
      });
    }

    const slotList = dateSlots
      .map((slot) => slotDisplayTime(slot.start_time))
      .join(', ');

    return this.wrapResult({
      session,
      preserveBooking,
      stateBefore,
      templateKey: 'availability.today_slots',
      templateVariables: {
        doctor_name: doctor.name,
        date_label: target.dateLabel,
        slot_list: slotList,
      },
    });
  }

  private async wrapResult(input: {
    session: ConversationSessionRow;
    preserveBooking: boolean;
    stateBefore: string;
    templateKey: MessageTemplateKey;
    templateVariables: Record<string, string>;
  }): Promise<DoctorAvailabilityHandlerResult> {
    const rendered = await this.templateRenderer.render(
      input.templateKey,
      input.session.languageCode as 'ta_tanglish' | 'english',
      input.templateVariables,
    );

    if (input.preserveBooking) {
      const answerText = await appendBookingResumeText(
        this.templateRenderer,
        rendered.message_text,
        input.session,
        input.session.collectedJson as Record<string, unknown>,
      );
      return {
        intent: 'ask_doctor_availability',
        templateKey: 'knowledge.answer',
        templateVariables: { answer_text: answerText },
        flowAfter: input.session.currentFlow,
        stateAfter: input.stateBefore,
        collectedJson: input.session.collectedJson as Record<string, unknown>,
      };
    }

    return {
      intent: 'ask_doctor_availability',
      templateKey: input.templateKey,
      templateVariables: input.templateVariables,
      flowAfter: 'none',
      stateAfter: 'IDLE',
      collectedJson: {},
    };
  }
}
