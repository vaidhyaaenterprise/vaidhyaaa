import { sql } from 'drizzle-orm';
import { appointmentSlots } from '../schema';

/** Validate by appointment date, not by the newest rule or today's date.
 * Slot IDs may be referenced by existing appointments, so this guard does not
 * rewrite rows or assume that generated_from_rule_id still names an old version.
 */
export function slotMatchesEffectiveRule() {
  return sql`EXISTS (
    SELECT 1 FROM (
      SELECT candidate.slot_duration_minutes, candidate.capacity_per_slot
      FROM doctor_service_booking_rules candidate
      WHERE candidate.clinic_id = ${appointmentSlots.clinicId}
        AND candidate.doctor_id = ${appointmentSlots.doctorId}
        AND candidate.clinic_service_id = ${appointmentSlots.clinicServiceId}
        AND candidate.active = true
        AND candidate.effective_from <= date(${appointmentSlots.startTime})
        AND (candidate.effective_to IS NULL OR candidate.effective_to >= date(${appointmentSlots.startTime}))
      ORDER BY candidate.version DESC, candidate.id DESC
      LIMIT 1
    ) effective_rule
    WHERE ${appointmentSlots.endTime} - ${appointmentSlots.startTime}
        = effective_rule.slot_duration_minutes * interval '1 minute'
      AND ${appointmentSlots.capacityTotal} = effective_rule.capacity_per_slot
  )`;
}
