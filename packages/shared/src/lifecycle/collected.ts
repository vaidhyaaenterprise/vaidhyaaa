import { z } from 'zod';

import { proposedSlotSchema } from '../booking/collected';

export const appointmentCandidateSchema = z.object({
  appointment_id: z.string().uuid(),
  doctor_name: z.string(),
  appointment_start: z.string(),
  display_label: z.string(),
});

export type AppointmentCandidate = z.infer<typeof appointmentCandidateSchema>;

export const cancelCollectedSchema = z.object({
  appointment_candidates: z.array(appointmentCandidateSchema).optional(),
  appointment_id: z.string().uuid().optional(),
  action_request_id: z.string().uuid().optional(),
  cancelled_appointment_id: z.string().uuid().optional(),
});

export const rescheduleCollectedSchema = z.object({
  appointment_candidates: z.array(appointmentCandidateSchema).optional(),
  appointment_id: z.string().uuid().optional(),
  doctor_id: z.string().uuid().optional(),
  doctor_name: z.string().optional(),
  clinic_service_id: z.string().uuid().optional(),
  preferred_date: z.string().optional(),
  time_preference: z.enum(['morning', 'afternoon', 'evening']).optional(),
  proposed_slots: z.array(proposedSlotSchema).optional(),
  selected_slot_id: z.string().uuid().optional(),
  hold_id: z.string().uuid().optional(),
  action_request_id: z.string().uuid().optional(),
});

export const handoffCollectedSchema = z.object({
  reason: z.string().optional(),
  patient_name: z.string().optional(),
  patient_phone: z.string().optional(),
  callback_request_id: z.string().uuid().optional(),
});

export type CancelCollected = z.infer<typeof cancelCollectedSchema>;
export type RescheduleCollected = z.infer<typeof rescheduleCollectedSchema>;
export type HandoffCollected = z.infer<typeof handoffCollectedSchema>;

export function parseCancelCollected(raw: unknown): CancelCollected {
  const parsed = cancelCollectedSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

export function parseRescheduleCollected(raw: unknown): RescheduleCollected {
  const parsed = rescheduleCollectedSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

export function parseHandoffCollected(raw: unknown): HandoffCollected {
  const parsed = handoffCollectedSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}
