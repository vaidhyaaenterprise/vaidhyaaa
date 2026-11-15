import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { createRepositories, type DatabaseConnection, type Repositories } from '@vaidya/db';
import { ADAPTER_TOKENS, JOB_TYPES, type JobRegistry } from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../database/database.module';

@Injectable()
export class AppointmentNoShowService implements OnModuleInit {
  private readonly repos: Repositories;

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(ADAPTER_TOKENS.JobRegistry) private readonly registry: JobRegistry,
  ) {
    this.repos = createRepositories(connection.db);
  }

  onModuleInit(): void {
    this.registry.register(JOB_TYPES.MARK_APPOINTMENT_NO_SHOWS, async (payload) => {
      await this.reconcile(typeof payload.clinic_id === 'string' ? payload.clinic_id : undefined);
    });
  }

  async reconcile(clinicId?: string) {
    const updated = await this.repos.appointmentLifecycle.markPastConfirmedNoShows(clinicId);
    return { updated };
  }
}
