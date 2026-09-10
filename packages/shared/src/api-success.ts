import { z } from 'zod';

export const apiSuccessMetaSchema = z.object({
  request_id: z.string(),
  debug: z.unknown().nullable(),
});

export const apiSuccessBodySchema = z.object({
  data: z.unknown(),
  meta: apiSuccessMetaSchema,
});

export type ApiSuccessMeta = z.infer<typeof apiSuccessMetaSchema>;
export type ApiSuccessBody<T = unknown> = {
  data: T;
  meta: ApiSuccessMeta;
};

export function toApiSuccessBody<T>(
  data: T,
  requestId: string,
  debug: unknown = null,
): ApiSuccessBody<T> {
  return {
    data,
    meta: {
      request_id: requestId,
      debug,
    },
  };
}

export function isApiErrorBody(value: unknown): value is { error: unknown } {
  return typeof value === 'object' && value !== null && 'error' in value;
}
