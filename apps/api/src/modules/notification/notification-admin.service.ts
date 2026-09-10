import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';
import { AppError } from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../database/database.module';
import type { DatabaseConnection } from '@vaidya/db';

@Injectable()
export class NotificationAdminService {
  private readonly repos: Repositories;

  constructor(@Inject(DATABASE_CONNECTION) connection: DatabaseConnection) {
    this.repos = createRepositories(connection.db);
  }

  async retryNotification(notificationEventId: string) {
    const [event] = await this.repos.notification.findByIdGlobal(notificationEventId);
    if (!event) {
      throw new AppError('NOT_FOUND', 'Notification event not found.');
    }
    if (event.status !== 'failed' && event.status !== 'pending') {
      throw new AppError('VALIDATION_ERROR', 'Only failed or pending notifications can be retried.');
    }

    const updated = await this.repos.notification.retryNotification(event.clinicId, event.id);
    if (!updated) {
      throw new AppError('INTERNAL_ERROR', 'Failed to retry notification.');
    }

    return { notification: updated };
  }

  async cancelNotification(notificationEventId: string, reason = 'Cancelled by platform admin') {
    const [event] = await this.repos.notification.findByIdGlobal(notificationEventId);
    if (!event) {
      throw new AppError('NOT_FOUND', 'Notification event not found.');
    }
    if (event.status === 'sent' || event.status === 'cancelled') {
      throw new AppError('VALIDATION_ERROR', 'Notification cannot be cancelled.');
    }

    const updated = await this.repos.notification.markCancelled(event.clinicId, event.id, reason);
    if (!updated) {
      throw new AppError('INTERNAL_ERROR', 'Failed to cancel notification.');
    }

    return { notification: updated };
  }
}
