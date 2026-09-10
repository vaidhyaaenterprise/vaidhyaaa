import type { ServiceRouterInput, ServiceRouterResult } from '../adapters/index';

import { routeServiceFromProfiles } from './service-router-engine';

export function routeServiceMock(input: ServiceRouterInput): ServiceRouterResult {
  return routeServiceFromProfiles(input);
}
