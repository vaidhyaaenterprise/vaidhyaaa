import { sql } from 'drizzle-orm';
import { appointmentSlots } from '../schema';

/** Stale slots must not be offered or booked while a committed configuration is being applied. */
export function slotConfigurationReady() {
  return sql`NOT EXISTS (
    SELECT 1 FROM background_jobs refresh
    WHERE refresh.clinic_id = ${appointmentSlots.clinicId}
      AND refresh.job_type = 'RECONCILE_SLOTS'
      AND refresh.status IN ('pending', 'running', 'failed')
      AND (refresh.payload_json->>'doctorId' IS NULL
        OR refresh.payload_json->>'doctorId' = ${appointmentSlots.doctorId}::text)
      AND (refresh.payload_json->>'clinicServiceId' IS NULL
        OR refresh.payload_json->>'clinicServiceId' = ${appointmentSlots.clinicServiceId}::text)
  )`;
}
