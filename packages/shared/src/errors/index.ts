import { z } from 'zod';

export const API_ERROR_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'CLINIC_NOT_FOUND',
  'DOCTOR_NOT_OWNER',
  'SLOT_NOT_AVAILABLE',
  'SLOT_FULL',
  'SLOT_HOLD_EXPIRED',
  'APPOINTMENT_NOT_FOUND',
  'APPOINTMENT_NOT_CONFIRMABLE',
  'APPOINTMENT_NOT_CANCELLABLE',
  'CONFLICTING_APPOINTMENTS',
  'KNOWLEDGE_NOT_APPROVED',
  'VALIDATION_ERROR',
  'IDEMPOTENCY_CONFLICT',
  'PROVIDER_FAILURE',
  'CLINIC_SETUP_INCOMPLETE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'NOT_FOUND',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);

export const apiErrorBodySchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    details: z.record(z.unknown()).default({}),
    request_id: z.string(),
  }),
});

export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;

export const REQUEST_ID_HEADER = 'x-request-id';

function randomHex(length: number): string {
  const cryptoApi = globalThis.crypto;

  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID().replace(/-/g, '').slice(0, length);
  }

  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    const bytes = new Uint8Array(Math.ceil(length / 2));
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, length);
  }

  let fallback = '';
  for (let index = 0; index < length; index += 1) {
    fallback += Math.floor(Math.random() * 16).toString(16);
  }
  return fallback;
}

export function createRequestId(): string {
  const suffix = randomHex(16);
  return `req_${suffix}`;
}

export function statusCodeForErrorCode(code: ApiErrorCode): number {
  switch (code) {
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
    case 'DOCTOR_NOT_OWNER':
      return 403;
    case 'NOT_FOUND':
    case 'CLINIC_NOT_FOUND':
    case 'APPOINTMENT_NOT_FOUND':
      return 404;
    case 'VALIDATION_ERROR':
      return 400;
    case 'SLOT_NOT_AVAILABLE':
    case 'SLOT_FULL':
    case 'SLOT_HOLD_EXPIRED':
    case 'APPOINTMENT_NOT_CONFIRMABLE':
    case 'APPOINTMENT_NOT_CANCELLABLE':
    case 'CONFLICTING_APPOINTMENTS':
    case 'IDEMPOTENCY_CONFLICT':
    case 'KNOWLEDGE_NOT_APPROVED':
    case 'CLINIC_SETUP_INCOMPLETE':
      return 409;
    case 'PROVIDER_FAILURE':
      return 502;
    case 'RATE_LIMITED':
      return 429;
    case 'INTERNAL_ERROR':
    default:
      return 500;
  }
}

export class AppError extends Error {
  public readonly statusCode: number;

  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
    statusCode?: number,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode ?? statusCodeForErrorCode(code);
  }
}

export function toApiErrorBody(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  details: Record<string, unknown> = {},
): ApiErrorBody {
  return {
    error: {
      code,
      message,
      details,
      request_id: requestId,
    },
  };
}
