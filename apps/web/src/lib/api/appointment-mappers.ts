import type {
  Appointment,
  AppointmentActionRequest,
  AppointmentActivity,
} from '@/components/pages/appointments/types';
import type {
  AppointmentActionRequestApiRow,
  AppointmentActivityApiRow,
  AppointmentApiRow,
} from '@/lib/api/appointments';

function splitStart(value: string): { date: string; time: string } {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);

  if (match) {
    return {
      date: match[1] ?? '',
      time: match[2] ?? '',
    };
  }

  const [date = '', timePart = ''] = trimmed.split(/[T\s]/);
  return { date, time: timePart.slice(0, 5) };
}

export function mapAppointmentRow(row: AppointmentApiRow): Appointment {
  const { date, time } = splitStart(row.appointment_start);
  return {
    id: row.id,
    patientName: row.patient_name,
    patientPhone: row.patient_phone ?? '',
    doctorId: row.doctor_id,
    doctorName: row.doctor_name,
    serviceId: row.clinic_service_id,
    serviceName: row.service_name,
    appointmentDate: date,
    appointmentTime: time,
    reasonForVisit: row.reason_for_visit,
    visitType: row.visit_type,
    routingSource: (row.routing_source ?? 'voice_bot') as Appointment['routingSource'],
    source: row.source as Appointment['source'],
    status: row.status as Appointment['status'],
    hasHistory: row.has_history,
  };
}

export function mapActionRequestRow(row: AppointmentActionRequestApiRow): AppointmentActionRequest {
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    patientName: row.patient_name,
    doctorId: row.doctor_id,
    doctorName: row.doctor_name,
    serviceId: row.clinic_service_id,
    serviceName: row.service_name,
    requestedDate: row.requested_date ?? '',
    requestedTime: row.requested_time_preference ?? '',
    requestedNewSlotId: row.requested_new_slot_id,
    reason: row.reason ?? '',
    actionType: row.action_type,
    status: row.status as AppointmentActionRequest['status'],
  };
}

export function mapAppointmentActivityRow(row: AppointmentActivityApiRow): AppointmentActivity {
  const previous = row.previous_appointment_start
    ? splitStart(row.previous_appointment_start)
    : { date: '', time: '' };
  const current = splitStart(row.appointment_start);

  return {
    id: row.id,
    appointmentId: row.appointment_id,
    patientName: row.patient_name,
    patientPhone: row.patient_phone ?? '',
    doctorId: row.doctor_id,
    doctorName: row.doctor_name,
    serviceId: row.clinic_service_id,
    serviceName: row.service_name,
    reasonForVisit: row.reason_for_visit,
    actionType: row.action_type,
    occurredAt: row.occurred_at,
    previousAppointmentDate: previous.date,
    previousAppointmentTime: previous.time,
    appointmentDate: current.date,
    appointmentTime: current.time,
  };
}
