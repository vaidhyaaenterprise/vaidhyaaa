import {
  ArgumentMetadata,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ZodSchema } from 'zod';

import { AppError } from '@vaidya/shared';

export const ZOD_SCHEMA_KEY = 'zodSchema';

const PRIMITIVE_METATYPES = new Set<unknown>([String, Boolean, Number, Array, Object]);

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly reflector: Reflector) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const metatype = metadata.metatype;
    if (!metatype || PRIMITIVE_METATYPES.has(metatype)) {
      return value;
    }

    const schema = this.reflector.get<ZodSchema | undefined>(ZOD_SCHEMA_KEY, metatype);
    if (!schema) {
      return value;
    }

    const result = schema.safeParse(value);
    if (!result.success) {
      throw new AppError('VALIDATION_ERROR', 'Request validation failed.', {
        fields: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    return result.data;
  }
}
