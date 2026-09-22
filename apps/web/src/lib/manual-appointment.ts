import type { ManualAppointmentData } from '@/components/pages/appointments/ManualAppointmentModal';
import type { BookingRules } from '@/components/pages/appointments/types';
import type { ManualAppointmentPayload } from '@/lib/api/appointments';

export const DEFAULT_BOOKING_RULES: BookingRules = {
  slotDurationMinutes: 30,
  capacityPerSlot: 1,
  bookingHorizonDays: 45,
  manualEditCutoffBeforeStartMinutes: 60,
  manualEditMaxShiftMinutes: 60,
  allowDoctorServiceEdit: false,
};

function toApiDateTime(value: string): string {
  const normalized = value.trim().replace(' ', 'T');
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)
    ? `${normalized}:00`
    : normalized;

  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(withSeconds)) {
    return withSeconds;
  }

  return `${withSeconds}Z`;
}

export function buildManualAppointmentPayload(
  data: ManualAppointmentData,
  slotDurationMinutes: number,
): ManualAppointmentPayload {
  const slotStart = data.appointmentStart ? toApiDateTime(data.appointmentStart) : undefined;
  const slotEnd = data.appointmentEnd ? toApiDateTime(data.appointmentEnd) : undefined;

  const fallbackStart = toApiDateTime(`${data.appointmentDate}T${data.appointmentTime}`);
  const fallbackEnd = new Date(
    new Date(fallbackStart).getTime() + slotDurationMinutes * 60_000,
  ).toISOString();

  return {
    patient_name: data.patientName,
    patient_phone: data.patientPhone,
    patient_age: Number.parseInt(data.patientAge, 10),
    ...(data.patientDateOfBirth ? { patient_date_of_birth: data.patientDateOfBirth } : {}),
    ...(data.slotId ? { slot_id: data.slotId } : {}),
    doctor_id: data.doctorId,
    clinic_service_id: data.serviceId,
    reason_for_visit: data.reasonForVisit,
    appointment_start: slotStart ?? fallbackStart,
    appointment_end: slotEnd ?? fallbackEnd,
    is_followup: data.visitType === 'follow_up',
    ...(data.overrideReason ? { override_reason: data.overrideReason } : {}),
    status: 'confirmed',
  };
}
