import { Injectable } from '@nestjs/common';

import {
  routeServiceMock,
  type ServiceRouterAdapter,
  type ServiceRouterInput,
  type ServiceRouterResult,
} from '@vaidya/shared';

@Injectable()
export class MockServiceRouterAdapter implements ServiceRouterAdapter {
  async route(input: ServiceRouterInput): Promise<ServiceRouterResult> {
    return routeServiceMock(input);
  }
}
