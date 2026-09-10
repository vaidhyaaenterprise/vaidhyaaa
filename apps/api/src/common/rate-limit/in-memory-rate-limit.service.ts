import { Injectable } from '@nestjs/common';

import { type RateLimitService } from '@vaidya/shared';

interface WindowState {
  count: number;
  resetAt: number;
}

@Injectable()
export class InMemoryRateLimitService implements RateLimitService {
  private readonly windows = new Map<string, WindowState>();

  async check(key: string, limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const current = this.windows.get(key);

    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }

    if (current.count >= limit) {
      return false;
    }

    current.count += 1;
    return true;
  }
}
