import { Injectable, NestMiddleware } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { IDEMPOTENCY_CONTEXT_KEY } from '../constants';

const IDEMPOTENCY_HEADER = 'idempotency-key';

type RawRequestWithIdempotency = IncomingMessage & {
  [IDEMPOTENCY_CONTEXT_KEY]?: string;
};

@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  use(req: RawRequestWithIdempotency, _res: ServerResponse, next: () => void): void {
    const method = req.method?.toUpperCase();
    if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') {
      next();
      return;
    }

    const headerValue = req.headers[IDEMPOTENCY_HEADER];
    if (typeof headerValue === 'string' && headerValue.length > 0) {
      req[IDEMPOTENCY_CONTEXT_KEY] = headerValue;
    }

    next();
  }
}
