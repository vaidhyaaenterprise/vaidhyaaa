'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { AppointmentCard } from './AppointmentCard';
import type { Appointment } from './types';

interface VisitedPatientsProps {
  appointments: Appointment[];
  dateLabel?: string;
  onViewHistory: (patientPhone: string) => void;
  onEditPatientName: (id: string, patientName: string) => Promise<void>;
}

export function VisitedPatients({
  appointments,
  dateLabel,
  onViewHistory,
  onEditPatientName,
}: VisitedPatientsProps) {
  const { effectiveRole, clinicRole } = useAuth();
  const isAdmin = effectiveRole === 'admin';
  const currentDoctorId = clinicRole?.doctor_id;
  const description = dateLabel
    ? `Patients with appointments on ${dateLabel} who completed their consultation.`
    : 'Patients who completed their consultation.';

  const filteredAppointments = isAdmin
    ? appointments
    : appointments.filter(apt => apt.doctorId === currentDoctorId);

  const groupedAppointments = filteredAppointments.reduce((acc, appointment) => {
    if (!acc[appointment.doctorId]) {
      acc[appointment.doctorId] = {
        doctorName: appointment.doctorName,
        appointments: [],
      };
    }
    acc[appointment.doctorId]?.appointments.push(appointment);
    return acc;
  }, {} as Record<string, { doctorName: string; appointments: Appointment[] }>);

  if (filteredAppointments.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-lg font-bold text-slate-900">Visited</h3>
        <p className="mb-2 text-sm text-slate-500">{description}</p>
        <p className="text-sm text-slate-500">
          {dateLabel ? `No visited patients for ${dateLabel}.` : 'No visited patients yet.'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-lg font-bold text-slate-900">Visited</h3>
      <p className="mb-4 text-sm text-slate-500">{description}</p>
      <div className="space-y-4">
        {Object.entries(groupedAppointments).map(([doctorId, group]) => (
          <div key={doctorId} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h4 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-700">
              {group.doctorName}
            </h4>
            <div className="space-y-3">
              {group.appointments.map((appointment) => (
                <AppointmentCard
                  key={appointment.id}
                  appointment={appointment}
                  onViewHistory={onViewHistory}
                  onEditPatientName={onEditPatientName}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
