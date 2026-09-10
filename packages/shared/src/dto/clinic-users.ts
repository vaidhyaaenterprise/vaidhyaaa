import { z } from 'zod';

import { uuidSchema } from './common';

export const clinicUserResponseSchema = z.object({
  id: uuidSchema,
  clinic_id: uuidSchema,
  user_id: uuidSchema,
  role: z.enum(['clinic_admin', 'doctor']),
  doctor_id: uuidSchema.nullable(),
  active: z.boolean(),
  user: z.object({
    id: uuidSchema,
    name: z.string().nullable(),
    email: z.string().email().nullable(),
    phone: z.string().nullable(),
    active: z.boolean(),
  }),
});

export const inviteClinicUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  role: z.enum(['clinic_admin', 'doctor']).default('doctor'),
  doctor_id: uuidSchema.optional(),
});

export const createClinicUserLoginSchema = z.object({
  role: z.enum(['clinic_admin', 'doctor']),
  login_name: z
    .string()
    .min(1)
    .max(60)
    .transform((value) =>
      value
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '.')
        .replace(/[^a-zA-Z0-9._-]/g, '')
        .replace(/\.{2,}/g, '.')
        .replace(/^[.\-_]+|[.\-_]+$/g, ''),
    ),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
  doctor_id: uuidSchema.optional(),
});

export const loginWithUsernamePasswordSchema = z.object({
  username: z.string().min(1).max(80),
  password: z.string().min(1),
});

export type ClinicUserResponse = z.infer<typeof clinicUserResponseSchema>;
export type InviteClinicUserInput = z.infer<typeof inviteClinicUserSchema>;
export type CreateClinicUserLoginInput = z.infer<typeof createClinicUserLoginSchema>;
export type LoginWithUsernamePasswordInput = z.infer<typeof loginWithUsernamePasswordSchema>;
