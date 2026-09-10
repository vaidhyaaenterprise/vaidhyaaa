import { Injectable, NestMiddleware } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { createRequestId, REQUEST_ID_HEADER } from '@vaidya/shared';

import { REQUEST_ID_CONTEXT_KEY } from '../constants';

type RawRequestWithId = IncomingMessage & { [REQUEST_ID_CONTEXT_KEY]?: string };

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RawRequestWithId, res: ServerResponse, next: () => void): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId =
      typeof incoming === 'string' && incoming.length > 0 ? incoming : createRequestId();

    req[REQUEST_ID_CONTEXT_KEY] = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}
