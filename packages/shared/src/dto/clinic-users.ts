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
    username: z.string().nullable(),
    active: z.boolean(),
  }),
});

export const clinicLoginNameSchema = z
  .string()
  .trim()
  .min(1, 'Username is required.')
  .max(60, 'Username must be 60 characters or fewer.')
  .transform((value) =>
    value
      .toLowerCase()
      .replace(/\s+/g, '.')
      .replace(/[^a-z0-9._-]/g, '')
      .replace(/[._-]{2,}/g, '.')
      .replace(/^[.\-_]+|[.\-_]+$/g, ''),
  )
  .pipe(
    z
      .string()
      .min(1, 'Username must contain at least one letter or number.')
      .max(60, 'Username must be 60 characters or fewer.'),
  );

const clinicLoginPasswordSchema = z
  .string()
  .min(6, 'Password must be at least 6 characters.')
  .max(128, 'Password must be 128 characters or fewer.');

export const inviteClinicUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  role: z.enum(['clinic_admin', 'doctor']).default('doctor'),
  doctor_id: uuidSchema.optional(),
});

export const createClinicUserLoginSchema = z.object({
  role: z.enum(['clinic_admin', 'doctor']),
  login_name: clinicLoginNameSchema,
  password: clinicLoginPasswordSchema,
  doctor_id: uuidSchema.optional(),
});

export const updateClinicUserLoginSchema = z
  .object({
    login_name: clinicLoginNameSchema.optional(),
    password: clinicLoginPasswordSchema.optional(),
  })
  .refine((value) => value.login_name !== undefined || value.password !== undefined, {
    message: 'Provide a username or password to update.',
  });

export const loginWithUsernamePasswordSchema = z.object({
  username: z.string().min(1).max(80),
  password: z.string().min(1),
});

export type ClinicUserResponse = z.infer<typeof clinicUserResponseSchema>;
export type InviteClinicUserInput = z.infer<typeof inviteClinicUserSchema>;
export type CreateClinicUserLoginInput = z.infer<typeof createClinicUserLoginSchema>;
export type UpdateClinicUserLoginInput = z.infer<typeof updateClinicUserLoginSchema>;
export type LoginWithUsernamePasswordInput = z.infer<typeof loginWithUsernamePasswordSchema>;
