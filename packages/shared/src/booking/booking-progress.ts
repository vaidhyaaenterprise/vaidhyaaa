import type { BookingCollected } from './collected';
import { CANCEL_FLOW, HANDOFF_FLOW, RESCHEDULE_FLOW } from '../lifecycle/flows';

const NON_BOOKING_ACTIVE_FLOWS = new Set<string>([CANCEL_FLOW, RESCHEDULE_FLOW, HANDOFF_FLOW]);

export function hasBookingProgress(collected: BookingCollected): boolean {
  return Boolean(
    collected.reason_for_visit ||
      collected.doctor_id ||
      collected.doctor_name ||
      collected.clinic_service_id ||
      collected.preferred_date ||
      collected.hold_id ||
      collected.proposed_slots?.length ||
      collected.selected_slot_id ||
      collected.appointment_id,
  );
}

export function inferBookingState(collected: BookingCollected): string {
  if (collected.appointment_id) {
    return 'AWAITING_CONFIRMATION';
  }
  if (!collected.reason_for_visit && !collected.doctor_id && !collected.doctor_name) {
    if (collected.preferred_date) {
      return 'ASK_REASON';
    }
    return 'ASK_PROBLEM_OR_DOCTOR';
  }
  if ((collected.doctor_id || collected.doctor_name) && !collected.reason_for_visit) {
    return 'ASK_REASON';
  }
  if (!collected.preferred_date) {
    return 'ASK_DATE';
  }
  if (!collected.time_preference && !collected.hold_id && !collected.selected_slot_id) {
    return 'ASK_TIME';
  }
  if (!collected.hold_id && !collected.selected_slot_id) {
    return 'PROPOSE_SLOTS';
  }
  if (!collected.patient_name) {
    return 'ASK_PATIENT_NAME';
  }
  return 'CONFIRM_DOCTOR';
}

export function resumeBookingSession<T extends { currentFlow: string; currentState: string; collectedJson?: unknown }>(
  session: T,
): T {
  if (session.currentFlow === 'booking') {
    return session;
  }

  if (NON_BOOKING_ACTIVE_FLOWS.has(session.currentFlow)) {
    return session;
  }

  const collected = (session.collectedJson ?? {}) as BookingCollected;
  if (!hasBookingProgress(collected)) {
    return session;
  }

  return {
    ...session,
    currentFlow: 'booking',
    currentState: inferBookingState(collected),
  };
}
