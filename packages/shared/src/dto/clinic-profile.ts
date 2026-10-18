import { z } from 'zod';

const requiredText = (label: string, maxLength: number) =>
  z
    .string({
      required_error: `${label} is required.`,
      invalid_type_error: `${label} is required.`,
    })
    .trim()
    .min(1, `${label} is required.`)
    .max(maxLength, `${label} must not exceed ${maxLength} characters.`);

// Responses remain nullable so existing incomplete profiles can still be opened and corrected.
export const clinicProfileDetailsSchema = z
  .object({
    name: requiredText('Clinic name', 160),
    primary_phone: requiredText('Phone number', 10).regex(
      /^[0-9]{10}$/,
      'Enter a 10-digit clinic phone number without +91 or other characters.',
    ),
    address_line1: requiredText('Address line 1', 255),
    address_line2: requiredText('Address line 2', 255),
    city: requiredText('City', 120),
    state: requiredText('State', 120),
    postal_code: requiredText('PIN code', 6).regex(
      /^[1-9][0-9]{5}$/,
      'Enter a valid 6-digit PIN code that does not start with 0.',
    ),
    country: requiredText('Country', 120),
  })
  .strict();

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

export const clinicProfilePatchSchema = clinicProfileDetailsSchema
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one clinic profile field is required.',
  });

export type ClinicProfileResponse = z.infer<typeof clinicProfileResponseSchema>;
export type ClinicProfilePatchInput = z.infer<typeof clinicProfilePatchSchema>;
