import { Injectable } from '@nestjs/common';

import {
  type JobHandler,
  type JobRegistry,
} from '@vaidya/shared';

@Injectable()
export class JobRegistryService implements JobRegistry {
  private readonly handlers = new Map<string, JobHandler>();

  register(jobType: string, handler: JobHandler): void {
    this.handlers.set(jobType, handler);
  }

  getHandler(jobType: string): JobHandler | undefined {
    return this.handlers.get(jobType);
  }

  getRegisteredJobTypes(): string[] {
    return [...this.handlers.keys()];
  }
}
