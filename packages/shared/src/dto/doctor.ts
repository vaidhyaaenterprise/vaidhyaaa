import { z } from 'zod';

import { auditTimestampsSchema, uuidSchema } from './common';

export const doctorResponseSchema = z
  .object({
    id: uuidSchema,
    clinic_id: uuidSchema,
    user_id: uuidSchema.nullable(),
    name: z.string().min(1),
    qualification: z.string().nullable(),
    registration_number: z.string().nullable(),
    active: z.boolean(),
  })
  .merge(auditTimestampsSchema);

export const createDoctorSchema = z.object({
  name: z.string().min(1),
  qualification: z.string().optional(),
  registration_number: z.string().optional(),
});

export const updateDoctorSchema = createDoctorSchema.partial().extend({
  active: z.boolean().optional(),
});

export const linkDoctorLoginSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

export type DoctorResponse = z.infer<typeof doctorResponseSchema>;
export type CreateDoctorInput = z.infer<typeof createDoctorSchema>;
export type UpdateDoctorInput = z.infer<typeof updateDoctorSchema>;
export type LinkDoctorLoginInput = z.infer<typeof linkDoctorLoginSchema>;
