import { z } from 'zod';

import { auditTimestampsSchema, uuidSchema } from './common';

export const doctorServiceMappingResponseSchema = z
  .object({
    id: uuidSchema,
    clinic_id: uuidSchema,
    doctor_id: uuidSchema,
    clinic_service_id: uuidSchema,
    consultation_fee_amount: z.string().nullable(),
    followup_fee_amount: z.string().nullable(),
    followup_valid_days: z.number().int().min(0).nullable(),
    active: z.boolean(),
  })
  .merge(auditTimestampsSchema);

export const createDoctorServiceMappingSchema = z.object({
  doctor_id: uuidSchema,
  clinic_service_id: uuidSchema,
  consultation_fee_amount: z.number().nonnegative().optional(),
  followup_fee_amount: z.number().nonnegative().optional(),
  followup_valid_days: z.number().int().min(0).optional(),
  active: z.boolean().default(true),
});

export const updateDoctorServiceMappingSchema = createDoctorServiceMappingSchema
  .omit({ doctor_id: true, clinic_service_id: true })
  .partial();

export type DoctorServiceMappingResponse = z.infer<typeof doctorServiceMappingResponseSchema>;
export type CreateDoctorServiceMappingInput = z.infer<typeof createDoctorServiceMappingSchema>;
export type UpdateDoctorServiceMappingInput = z.infer<typeof updateDoctorServiceMappingSchema>;
