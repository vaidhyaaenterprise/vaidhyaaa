import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';
import {
  ADAPTER_TOKENS,
  AppError,
  type MessagingProvider,
  type NotificationChannel,
} from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';

@Injectable()
export class NotificationDeliveryService {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(ADAPTER_TOKENS.MessagingProvider)
    private readonly messagingProvider: MessagingProvider,
  ) {
    this.repos = createRepositories(connection.db);
  }

  async deliverNotificationEvent(clinicId: string, notificationEventId: string) {
    const [existing] = await this.repos.notification.findById(clinicId, notificationEventId);
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Notification event not found.', {
        notification_event_id: notificationEventId,
      });
    }

    if (existing.status === 'sent') {
      return existing;
    }

    if (existing.deduplicationKey) {
      const [alreadySent] = await this.repos.notification.findSentByDeduplicationKey(
        clinicId,
        existing.deduplicationKey,
      );
      if (alreadySent && alreadySent.id !== existing.id) {
        return this.repos.notification.markCancelled(
          clinicId,
          notificationEventId,
          'deduplication_key_already_sent',
        );
      }
    }

    const claimed = await this.repos.notification.claimForProcessing(clinicId, notificationEventId);
    if (!claimed) {
      const [latest] = await this.repos.notification.findById(clinicId, notificationEventId);
      return latest ?? existing;
    }

    const recipient =
      claimed.recipientPhone ?? claimed.recipientEmail ?? claimed.recipientType;
    const templateKey = claimed.templateKey ?? 'notification.generic';
    const payload = (claimed.payloadJson ?? {}) as Record<string, unknown>;

    try {
      if (claimed.channel === 'dashboard') {
        return this.repos.notification.markSent(clinicId, notificationEventId, {
          provider_message_id: `dashboard_${notificationEventId}`,
          channel: claimed.channel,
        });
      }

      const providerResult = await this.sendViaChannel(
        claimed.channel as NotificationChannel,
        recipient,
        templateKey,
        payload,
      );

      return this.repos.notification.markSent(clinicId, notificationEventId, {
        provider_message_id: providerResult.providerMessageId,
        channel: claimed.channel,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.repos.notification.markFailed({
        clinicId,
        notificationEventId,
        error: message,
      });
    }
  }

  private async sendViaChannel(
    channel: NotificationChannel,
    recipient: string,
    templateKey: string,
    payload: Record<string, unknown>,
  ) {
    const input = { recipient, templateKey, payload };

    if (channel === 'sms') {
      return this.messagingProvider.sendSms(input);
    }

    if (channel === 'whatsapp') {
      return this.messagingProvider.sendWhatsApp(input);
    }

    if (channel === 'email') {
      return { providerMessageId: `mock_email_${Date.now()}` };
    }

    return { providerMessageId: `mock_dashboard_${Date.now()}` };
  }
}
