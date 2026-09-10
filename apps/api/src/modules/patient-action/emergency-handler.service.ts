import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type ConversationSessionRow, type Repositories } from '@vaidya/db';
import type { IntentClassifierResult, LanguageCode, MessageTemplateKey } from '@vaidya/shared';
import { isActiveReceptionistFlow } from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';
import { SlotHoldService } from '../slots/slot-hold.service';

import { StaffNotificationService } from './staff-notification.service';

export type EmergencyHandlerResult = {
  intent: string;
  templateKey: 'safety.emergency' | 'safety.emergency_active_flow';
  templateVariables: Record<string, string>;
  flowBefore: string;
  stateBefore: string;
  flowAfter: string;
  stateAfter: string;
  languageCode: LanguageCode;
  collectedJson: Record<string, unknown>;
  sessionStatus?: 'escalated';
};

@Injectable()
export class EmergencyHandlerService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(SlotHoldService) private readonly slotHoldService: SlotHoldService,
    @Inject(StaffNotificationService) private readonly staffNotification: StaffNotificationService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async handle(input: {
    session: ConversationSessionRow;
    messageText: string;
    classification: IntentClassifierResult;
    flowBefore: string;
    stateBefore: string;
    languageCode: LanguageCode;
  }): Promise<EmergencyHandlerResult> {
    await this.slotHoldService.releaseSessionHolds(input.session.clinicId, input.session.id);

    const [incident] = await this.repos.appointmentLifecycle.insertEmergencyIncident({
      clinicId: input.session.clinicId,
      patientPhone: input.session.patientPhone,
      messageText: input.messageText,
      detectedReason: input.classification.safety.reason,
      sourceSessionId: input.session.id,
      status: 'alert_created',
    });

    if (incident) {
      await this.staffNotification.notifyStaffActionRequest({
        clinicId: input.session.clinicId,
        eventType: 'staff.emergency_alert',
        templateKey: 'safety.emergency',
        deduplicationKey: `emergency:${input.session.id}:${incident.id}`,
        payload: {
          emergency_incident_id: incident.id,
          session_id: input.session.id,
          message_text: input.messageText,
        },
      });
    }

    return {
      intent: 'emergency',
      templateKey: isActiveReceptionistFlow(input.flowBefore)
        ? 'safety.emergency_active_flow'
        : 'safety.emergency',
      templateVariables: {},
      flowBefore: input.flowBefore,
      stateBefore: input.stateBefore,
      flowAfter: 'none',
      stateAfter: 'IDLE',
      languageCode: input.languageCode,
      collectedJson: {},
      sessionStatus: 'escalated',
    };
  }
}
