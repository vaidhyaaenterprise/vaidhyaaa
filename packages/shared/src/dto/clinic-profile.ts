import { z } from 'zod';

const nullableTrimmedText = (maxLength: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().min(1).max(maxLength).nullable(),
  );

const nullablePhone = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z
    .string()
    .trim()
    .min(7)
    .max(30)
    .regex(/^[+0-9()\-\s]+$/, 'Phone number contains unsupported characters.')
    .nullable(),
);

export const clinicProfileResponseSchema = z.object({
  name: z.string().min(1),
  clinic_unique_number: z.number().int().positive(),
  primary_phone: z.string().nullable(),
  address_line1: z.string().nullable(),
  address_line2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postal_code: z.string().nullable(),
  country: z.string().nullable(),
  timezone: z.string().min(1),
});

export const clinicProfilePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    primary_phone: nullablePhone.optional(),
    address_line1: nullableTrimmedText(255).optional(),
    address_line2: nullableTrimmedText(255).optional(),
    city: nullableTrimmedText(120).optional(),
    state: nullableTrimmedText(120).optional(),
    postal_code: nullableTrimmedText(30).optional(),
    country: nullableTrimmedText(120).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one clinic profile field is required.',
  });

export type ClinicProfileResponse = z.infer<typeof clinicProfileResponseSchema>;
export type ClinicProfilePatchInput = z.infer<typeof clinicProfilePatchSchema>;
