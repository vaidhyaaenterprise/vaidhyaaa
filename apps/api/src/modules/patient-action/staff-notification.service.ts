import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';
import {
  type NotificationChannel,
} from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';
import { NotificationOutboxService } from '../notification/notification-outbox.service';

@Injectable()
export class StaffNotificationService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(NotificationOutboxService) private readonly notificationOutbox: NotificationOutboxService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async notifyStaffActionRequest(input: {
    clinicId: string;
    eventType:
      | 'staff.action_request'
      | 'staff.callback_request'
      | 'staff.emergency_alert'
      | 'appointment.cancelled';
    templateKey: string;
    deduplicationKey: string;
    payload: Record<string, unknown>;
  }) {
    const [settings] = await this.repos.clinics.findClinicSettings(input.clinicId);

    return this.notificationOutbox.notifyStaffActionRequest({
      clinicId: input.clinicId,
      eventType: input.eventType,
      templateKey: input.templateKey,
      deduplicationKey: input.deduplicationKey,
      payload: input.payload,
      fallbackPhone: settings?.fallbackPhone ?? null,
      channel: (settings?.pendingAppointmentNotificationChannel ?? 'whatsapp') as NotificationChannel,
    });
  }
}
