import { z } from 'zod';

import { languageCodeSchema } from '../enums/language-codes';

import { bookingModeSchema, answeringModeSchema } from './clinic-settings';
import { uuidSchema } from './common';

const clinicAdminInputSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

const subscriptionStatusSchema = z.enum([
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'expired',
  'manual_free',
]);

const createPlatformClinicSettingsSchema = z.object({
  fallback_phone: z.string().optional(),
  booking_mode: bookingModeSchema.optional(),
  answering_mode: answeringModeSchema.optional(),
  max_concurrent_calls: z.number().int().positive().optional(),
});

export const createPlatformClinicSchema = z.object({
  name: z.string().min(1),
  primary_phone: z.string().optional(),
  address_line1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  timezone: z.string().default('Asia/Kolkata'),
  default_language_code: languageCodeSchema.default('ta_tanglish'),
  plan_key: z.string().default('pilot'),
  subscription_status: subscriptionStatusSchema.default('trialing'),
  language_codes: z.array(languageCodeSchema).optional(),
  fallback_phone: z.string().optional(),
  booking_mode: bookingModeSchema.optional(),
  answering_mode: answeringModeSchema.optional(),
  max_concurrent_calls: z.number().int().positive().optional(),
  admin: clinicAdminInputSchema,
});

export const createPlatformClinicNestedSchema = z.object({
  clinic: z.object({
    name: z.string().min(1),
    phone: z.string().optional(),
    address_line1: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    timezone: z.string().default('Asia/Kolkata'),
    default_language_code: languageCodeSchema.default('ta_tanglish'),
  }),
  settings: createPlatformClinicSettingsSchema.optional(),
  admin: clinicAdminInputSchema,
  subscription: z
    .object({
      plan_key: z.string().default('pilot'),
      status: subscriptionStatusSchema.default('trialing'),
    })
    .optional(),
});

export function parseCreatePlatformClinicBody(body: unknown): CreatePlatformClinicInput {
  const nested = createPlatformClinicNestedSchema.safeParse(body);
  if (nested.success) {
    const value = nested.data;
    return {
      name: value.clinic.name,
      primary_phone: value.clinic.phone,
      address_line1: value.clinic.address_line1,
      city: value.clinic.city,
      state: value.clinic.state,
      country: value.clinic.country,
      timezone: value.clinic.timezone,
      default_language_code: value.clinic.default_language_code,
      plan_key: value.subscription?.plan_key ?? 'pilot',
      subscription_status: value.subscription?.status ?? 'trialing',
      fallback_phone: value.settings?.fallback_phone,
      booking_mode: value.settings?.booking_mode,
      answering_mode: value.settings?.answering_mode,
      max_concurrent_calls: value.settings?.max_concurrent_calls,
      admin: value.admin,
    };
  }

  return createPlatformClinicSchema.parse(body);
}

export const requestOtpSchema = z.object({
  identifier: z.string().min(3),
});

export const verifyOtpSchema = z.object({
  challenge_id: uuidSchema,
  otp: z.string().min(4),
  clinic_id: uuidSchema.optional(),
});

export const meUserSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  platform_role: z.string().nullable(),
  active: z.boolean(),
});

export const meClinicMembershipSchema = z.object({
  clinic_id: uuidSchema,
  clinic_name: z.string(),
  role: z.enum(['clinic_admin', 'doctor']),
  doctor_id: uuidSchema.nullable(),
  active: z.boolean(),
});

export const meResponseSchema = z.object({
  user: meUserSchema,
  memberships: z.array(meClinicMembershipSchema),
  active_clinic_id: uuidSchema.nullable(),
});

export const inviteClinicAdminSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

export const registerClinicAdminSchema = z
  .object({
    clinic_name: z.string().min(1),
    clinic_phone: z.string().min(1),
    address_line1: z.string().min(1),
    city: z.string().min(1),
    state: z.string().min(1),
    country: z.string().min(1).default('India'),
    zip_code: z.string().min(1).max(20),
    admin_name: z.string().min(1),
    admin_email: z.string().email(),
    admin_phone: z.string().min(6),
    password: z.string().min(6, 'Password must be at least 6 characters.'),
    confirm_password: z.string().min(6),
  })
  .refine((value) => value.password === value.confirm_password, {
    message: 'Passwords do not match.',
    path: ['confirm_password'],
  });

export const registerClinicAdminResponseSchema = z.object({
  email: z.string().email(),
  clinic_unique_number: z.number().int().positive(),
});

export const updateMembershipSchema = z.object({
  active: z.boolean(),
});

export const disableUserSchema = z.object({
  active: z.boolean(),
});

const emailAddressSchema = z.string().email('Enter a valid email address.');
const otpCodeSchema = z
  .string()
  .regex(/^\d{6}$/, 'Verification code must be exactly 6 digits.');

export const sendVerificationCodeSchema = z.object({
  email: emailAddressSchema,
});

export const verifyEmailSchema = z.object({
  email: emailAddressSchema,
  otp: otpCodeSchema,
});

export const resendVerificationCodeSchema = z.object({
  email: emailAddressSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailAddressSchema,
});

export const verifyPasswordResetCodeSchema = z.object({
  email: emailAddressSchema,
  otp: otpCodeSchema,
});

export const resetPasswordSchema = z
  .object({
    email: emailAddressSchema,
    otp: otpCodeSchema,
    new_password: z.string().min(6, 'Password must be at least 6 characters.'),
    confirm_password: z.string().min(6),
  })
  .refine((value) => value.new_password === value.confirm_password, {
    message: 'Passwords do not match.',
    path: ['confirm_password'],
  });

export const resendPasswordResetCodeSchema = z.object({
  email: emailAddressSchema,
});

export type SendVerificationCodeInput = z.infer<typeof sendVerificationCodeSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationCodeInput = z.infer<typeof resendVerificationCodeSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type VerifyPasswordResetCodeInput = z.infer<typeof verifyPasswordResetCodeSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ResendPasswordResetCodeInput = z.infer<typeof resendPasswordResetCodeSchema>;

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type CreatePlatformClinicInput = z.infer<typeof createPlatformClinicSchema>;
export type CreatePlatformClinicNestedInput = z.infer<typeof createPlatformClinicNestedSchema>;
export type InviteClinicAdminInput = z.infer<typeof inviteClinicAdminSchema>;
export type RegisterClinicAdminInput = z.infer<typeof registerClinicAdminSchema>;
export type RegisterClinicAdminResponse = z.infer<typeof registerClinicAdminResponseSchema>;
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>;
export type DisableUserInput = z.infer<typeof disableUserSchema>;
