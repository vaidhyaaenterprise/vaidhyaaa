export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ResourceMethodPolicy = {
  get?: boolean;
  post?: boolean | 'create' | 'add_window' | 'action';
  put?: boolean | 'full_replacement';
  patch?: boolean | 'partial_update' | 'edit_window';
  delete?: boolean;
  disable?: boolean;
};

/** Global HTTP verb semantics for the Vaidya API. */
export const API_METHOD_SEMANTICS = {
  POST: 'Creates resources or triggers actions.',
  PUT: 'Replaces a full resource or collection.',
  PATCH: 'Partially updates fields on a resource.',
} as const;

export const API_RESOURCE_POLICIES = {
  clinic_settings: {
    get: true,
    patch: 'partial_update',
    put: 'full_replacement',
    post: false,
  },
  doctor_schedules: {
    get: true,
    put: 'full_replacement',
    post: 'add_window',
    patch: 'edit_window',
    disable: true,
  },
  clinic_hours: {
    get: true,
    put: 'full_replacement',
    post: 'add_window',
    patch: 'edit_window',
    disable: true,
  },
} as const satisfies Record<string, ResourceMethodPolicy>;

export type ApiResourceKey = keyof typeof API_RESOURCE_POLICIES;

function isPolicyMethodEnabled(
  value: boolean | string | undefined,
): boolean {
  return value !== undefined && value !== false;
}

export function isMethodAllowed(
  resource: ApiResourceKey,
  method: HttpMethod,
): boolean {
  const policy = API_RESOURCE_POLICIES[resource];

  switch (method) {
    case 'GET':
      return policy.get === true;
    case 'POST':
      return isPolicyMethodEnabled(policy.post);
    case 'PUT':
      return isPolicyMethodEnabled(policy.put);
    case 'PATCH':
      return isPolicyMethodEnabled(policy.patch);
    case 'DELETE':
      return 'delete' in policy && policy.delete === true;
    default:
      return false;
  }
}

export function supportsDisableAction(resource: ApiResourceKey): boolean {
  return 'disable' in API_RESOURCE_POLICIES[resource] &&
    API_RESOURCE_POLICIES[resource].disable === true;
}

/** Route path conventions (relative to `/v1/clinics/:clinic_id`). */
export const API_ROUTE_PATHS = {
  clinic_settings: '/settings',
  doctor_schedules: '/doctors/:doctor_id/schedules',
  clinic_hours: '/hours',
  clinic_holidays: '/holidays',
  appointments: '/appointments',
  appointment_action_requests: '/appointment-action-requests',
  knowledge: '/knowledge',
  call_inbox: '/calls',
  notifications: '/notifications',
} as const;

export type ApiRouteKey = keyof typeof API_ROUTE_PATHS;

export function buildClinicRoute(
  clinicId: string,
  route: ApiRouteKey,
  params: Record<string, string> = {},
): string {
  let path: string = API_ROUTE_PATHS[route];
  for (const [key, value] of Object.entries(params)) {
    path = path.replace(`:${key}`, value);
  }
  return `/v1/clinics/${clinicId}${path}`;
}
