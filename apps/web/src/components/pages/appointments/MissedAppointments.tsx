'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { EditablePatientName } from './EditablePatientName';
import type { Appointment } from './types';

interface MissedAppointmentsProps {
  appointments: Appointment[];
  dateLabel?: string;
  kind?: 'missed_action' | 'no_show';
  onEditPatientName: (id: string, patientName: string) => Promise<void>;
}

function formatTime(time: string) {
  const [hours, minutes] = time.split(':');
  const hour = Number.parseInt(hours ?? '0', 10);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${minutes ?? '00'} ${suffix}`;
}

function formatDate(date: string) {
  const [year, month, day] = date.split('-');
  return year && month && day ? `${day}/${month}/${year}` : date;
}

export function MissedAppointments({
  appointments,
  dateLabel,
  kind = 'missed_action',
  onEditPatientName,
}: MissedAppointmentsProps) {
  const isNoShow = kind === 'no_show';
  const headingId = isNoShow ? 'no-show-appointments-heading' : 'missed-appointments-heading';
  const { effectiveRole, clinicRole } = useAuth();
  const currentDoctorId = clinicRole?.doctor_id;
  const visibleAppointments =
    effectiveRole === 'admin'
      ? appointments
      : appointments.filter((appointment) => appointment.doctorId === currentDoctorId);

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h3 id={headingId} className="mb-1 text-lg font-bold text-slate-900">
        {isNoShow ? 'No show' : 'Missed actions'}
      </h3>
      <p className="mb-4 text-sm text-slate-500">
        {isNoShow
          ? dateLabel
            ? `Confirmed appointments for ${dateLabel} that were not marked visited by the end of that day.`
            : 'Confirmed appointments that were not marked visited by the end of the appointment day.'
          : dateLabel
            ? `Appointments for ${dateLabel} where no clinic-admin action was taken.`
            : 'Recent past appointments where no clinic-admin action was taken.'}
      </p>

      {visibleAppointments.length === 0 ? (
        <p className="text-sm text-slate-500">
          {isNoShow
            ? dateLabel
              ? `No no-show appointments for ${dateLabel}.`
              : 'No no-show appointments.'
            : dateLabel
              ? `No missed actions for ${dateLabel}.`
              : 'No missed actions'}
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200">
          {visibleAppointments.map((appointment) => (
            <li
              key={appointment.id}
              className="flex flex-col gap-3 bg-rose-50/50 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div>
                <EditablePatientName
                  patientName={appointment.patientName}
                  onSave={
                    effectiveRole === 'admin'
                      ? (patientName) => onEditPatientName(appointment.id, patientName)
                      : undefined
                  }
                  className="text-sm font-bold text-slate-900"
                />
                {appointment.patientPhone ? (
                  <p className="mt-0.5 text-xs text-slate-600">{appointment.patientPhone}</p>
                ) : null}
                <p className="mt-0.5 text-xs text-slate-600">
                  {appointment.doctorName} · {formatTime(appointment.appointmentTime)} ·{' '}
                  {formatDate(appointment.appointmentDate)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {appointment.serviceName}
                  {appointment.reasonForVisit ? ` — ${appointment.reasonForVisit}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
                <span className="rounded-full border-2 border-rose-300 bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700">
                  {isNoShow ? 'No show' : 'Missed'}
                </span>
                <span className="text-xs font-semibold text-slate-500">
                  {isNoShow ? 'Not marked visited' : 'No action taken'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
