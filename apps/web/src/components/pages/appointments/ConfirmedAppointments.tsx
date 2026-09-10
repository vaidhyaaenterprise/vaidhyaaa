'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { AppointmentCard } from './AppointmentCard';
import type { Appointment, BookingRules } from './types';

interface ConfirmedAppointmentsProps {
  appointments: Appointment[];
  bookingRules: BookingRules;
  onEditTime: (id: string, newTime: string) => void;
  onCancel: (id: string) => void;
  onMarkVisited: (id: string, visitReason: string) => void;
  onViewHistory: (patientPhone: string) => void;
}

export function ConfirmedAppointments({
  appointments,
  bookingRules,
  onEditTime,
  onCancel,
  onMarkVisited,
  onViewHistory,
}: ConfirmedAppointmentsProps) {
  const { effectiveRole, me } = useAuth();
  const isAdmin = effectiveRole === 'admin';
  const currentDoctorId = me?.clinics[0]?.doctor_id;

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
        <h3 className="mb-4 text-lg font-bold text-slate-900">Confirmed today</h3>
        <p className="text-sm text-slate-500">No confirmed appointments</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-lg font-bold text-slate-900">Confirmed today</h3>
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
                  bookingRules={bookingRules}
                  onEditTime={onEditTime}
                  onCancel={onCancel}
                  onMarkVisited={onMarkVisited}
                  onViewHistory={onViewHistory}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
