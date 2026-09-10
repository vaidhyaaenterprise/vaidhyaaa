import { z } from 'zod';

export const proposedSlotSchema = z.object({
  slot_id: z.string().uuid(),
  start_time: z.string(),
  end_time: z.string(),
  display_time: z.string(),
});

export type ProposedSlot = z.infer<typeof proposedSlotSchema>;

export const bookingCollectedSchema = z.object({
  reason_for_visit: z.string().optional(),
  doctor_id: z.string().uuid().optional(),
  doctor_name: z.string().optional(),
  clinic_service_id: z.string().uuid().optional(),
  routing_source: z
    .enum([
      'service_router',
      'service_router_cache',
      'returning_patient_followup',
      'doctor_name',
      'manual',
    ])
    .optional(),
  preferred_date: z.string().optional(),
  time_preference: z.enum(['morning', 'afternoon', 'evening']).optional(),
  proposed_slots: z.array(proposedSlotSchema).optional(),
  selected_slot_id: z.string().uuid().optional(),
  hold_id: z.string().uuid().optional(),
  patient_name: z.string().optional(),
  patient_id: z.string().uuid().optional(),
  is_followup: z.boolean().optional(),
  appointment_id: z.string().uuid().optional(),
  awaiting_terminal_ack: z
    .enum(['unsupported_service', 'booking_complete', 'offer_help', 'awaiting_help_topic'])
    .optional(),
  awaiting_alternate_slot: z.boolean().optional(),
  pending_patient_candidates: z
    .array(z.object({ patient_id: z.string().uuid(), patient_name: z.string() }))
    .optional(),
  service_router_cache: z
    .record(
      z.string(),
      z.object({
        matched: z.boolean(),
        clinicServiceId: z.string().uuid().optional(),
        serviceKey: z.string().optional(),
        confidence: z.number(),
        unsupportedReason: z.string().optional(),
        needsClarification: z.boolean().optional(),
        clarificationQuestion: z.string().optional(),
      }),
    )
    .optional(),
  active_prompt: z
    .object({
      state: z.string(),
      template_key: z.string(),
    })
    .optional(),
});

export type BookingCollected = z.infer<typeof bookingCollectedSchema>;

export function parseBookingCollected(raw: unknown): BookingCollected {
  const parsed = bookingCollectedSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}
