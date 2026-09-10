'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingState } from '@/components/ui/StateViews';
import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import type { Appointment } from '@/components/pages/appointments/types';
import { mapAppointmentRow } from '@/lib/api/appointment-mappers';
import {
  cancelAppointment,
  confirmAppointment,
  fetchAppointments,
} from '@/lib/api/appointments';
import { fetchClinicSettings } from '@/lib/api/clinic-settings';
import { ApiRequestError } from '@/lib/api/client';

function formatTime(isoTime: string): string {
  const [hours, minutes] = isoTime.split(':');
  const hour = Number(hours);
  if (Number.isNaN(hour)) {
    return isoTime;
  }
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes} ${suffix}`;
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  if (!year || !month || !day) {
    return isoDate;
  }
  return `${day}/${month}/${year}`;
}

export function HomePageContent() {
  const { me, effectiveRole, clinicRole } = useAuth();
  const clinicId = useActiveClinicId();
  const isAdmin = effectiveRole === 'admin';
  const currentDoctorId = clinicRole?.doctor_id ?? null;

  const [loading, setLoading] = useState(true);
  const [pendingAppointments, setPendingAppointments] = useState<Appointment[]>([]);
  const [agentStatus, setAgentStatus] = useState('unknown');
  const [nextAppointments, setNextAppointments] = useState<
    Array<{ patient: string; time: string; doctor: string }>
  >([]);
  const [actionError, setActionError] = useState<string | null>(null);

  // Call inbox / emergency stats require backend endpoints not yet implemented (P04/P08).
  const todayCalls = 0;
  const callbacks = 0;
  const emergencyAlerts = 0;

  const loadDashboard = useCallback(async () => {
    if (!clinicId) {
      setLoading(false);
      return;
    }

    setActionError(null);
    try {
      const [appointments, settings] = await Promise.all([
        fetchAppointments(clinicId),
        fetchClinicSettings(clinicId).catch(() => null),
      ]);

      const mapped = appointments.map(mapAppointmentRow);
      const pending = mapped.filter((apt) => apt.status === 'pending_confirmation');
      setPendingAppointments(pending);
      setAgentStatus(settings?.agent_enabled ? 'active' : 'inactive');

      const confirmed = mapped
        .filter((apt) => apt.status === 'confirmed' || apt.status === 'pending_confirmation')
        .sort((a, b) =>
          `${a.appointmentDate}T${a.appointmentTime}`.localeCompare(
            `${b.appointmentDate}T${b.appointmentTime}`,
          ),
        )
        .slice(0, 3);

      setNextAppointments(
        confirmed.map((apt) => ({
          patient: apt.patientName,
          time: formatTime(apt.appointmentTime),
          doctor: apt.doctorName,
        })),
      );
    } catch (err) {
      setActionError(
        err instanceof ApiRequestError ? err.apiError.message : 'Failed to load dashboard data.',
      );
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const visiblePending = isAdmin
    ? pendingAppointments
    : pendingAppointments.filter((apt) => apt.doctorId === currentDoctorId);

  const handleConfirm = async (id: string) => {
    if (!clinicId) {
      return;
    }
    setActionError(null);
    try {
      await confirmAppointment(clinicId, id);
    } catch (err) {
      setActionError(
        err instanceof ApiRequestError ? err.apiError.message : 'Failed to confirm appointment.',
      );
      return;
    }
    await loadDashboard();
  };

  const handleCancel = async (id: string) => {
    if (!clinicId) {
      return;
    }
    setActionError(null);
    try {
      await cancelAppointment(clinicId, id);
    } catch (err) {
      setActionError(
        err instanceof ApiRequestError ? err.apiError.message : 'Failed to cancel appointment.',
      );
      return;
    }
    await loadDashboard();
  };

  const pendingConfirmations = pendingAppointments.length;

  return (
    <>
      <PageHeader
        title="Home"
        description="What the receptionist or doctor needs to act on now."
        showAgentToggle
        actions={
          isAdmin && (
            <button
              type="button"
              disabled
              className="rounded-[13px] border border-brand-600 bg-brand-600 px-4 py-2.5 text-sm font-extrabold text-white opacity-60"
            >
              Add manual booking
            </button>
          )
        }
      />

      {loading ? (
        <LoadingState title="Loading dashboard" description="Fetching appointments and clinic settings." />
      ) : (
        <>
          <div className="mb-6 rounded-[22px] bg-gradient-to-br from-brand-700 to-slate-900 p-6 text-white shadow-card">
            <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] lg:items-center">
              <div>
                <h2 className="text-xl font-black">
                  {effectiveRole === 'doctor'
                    ? 'Your clinic day at a glance'
                    : `Vaidya dashboard for ${me?.user.name ?? 'your clinic'}`}
                </h2>
                <p className="mt-2 text-sm text-teal-100">
                  {effectiveRole === 'doctor'
                    ? 'You see only your appointments and schedule tools in this milestone shell.'
                    : `${pendingConfirmations} appointment requests need confirmation. Call stats will appear when the call inbox API is available.`}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-extrabold">
                    Agent: {agentStatus}
                  </span>
                </div>
              </div>
              <div className="text-center lg:text-left">
                <p className="text-4xl font-black">{pendingConfirmations + callbacks + emergencyAlerts}</p>
                <p className="text-sm text-teal-100">pending staff actions</p>
              </div>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 text-lg font-bold text-slate-900">Needs your action</h3>
              {actionError ? (
                <p className="mb-2 text-xs font-semibold text-red-600">{actionError}</p>
              ) : null}
              <div className="space-y-3">
                {visiblePending.map((apt) => (
                  <div
                    key={apt.id}
                    className="rounded-xl border border-amber-200 bg-amber-50 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{apt.patientName}</p>
                        <p className="mt-0.5 text-xs text-slate-600">
                          {apt.doctorName} ·{' '}
                          <span className="font-semibold">{formatTime(apt.appointmentTime)}</span>
                          {apt.appointmentDate ? ` · ${formatDate(apt.appointmentDate)}` : ''}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {apt.serviceName}
                          {apt.reasonForVisit ? ` — ${apt.reasonForVisit}` : ''}
                        </p>
                      </div>
                      <span className="rounded-full border-2 border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                        Pending
                      </span>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleConfirm(apt.id)}
                        className="rounded-xl border-2 border-green-300 bg-green-50 px-3 py-1.5 text-xs font-bold text-green-700 transition-colors hover:bg-green-100"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCancel(apt.id)}
                        className="rounded-xl border-2 border-red-300 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 transition-colors hover:bg-red-100"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ))}
                {visiblePending.length > 0 && pendingConfirmations > visiblePending.length ? (
                  <p className="text-xs text-slate-500">
                    +{pendingConfirmations - visiblePending.length} more for other doctors
                  </p>
                ) : null}
                {visiblePending.length === 0 && callbacks === 0 && emergencyAlerts === 0 && (
                  <p className="text-sm text-slate-500">No pending actions</p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 text-lg font-bold text-slate-900">Today&apos;s summary</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <span className="text-sm font-semibold text-slate-700">Total calls</span>
                  <span className="text-lg font-bold text-slate-900">{todayCalls}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <span className="text-sm font-semibold text-slate-700">Pending confirmations</span>
                  <span className="text-lg font-bold text-amber-600">{pendingConfirmations}</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 text-lg font-bold text-slate-900">Next appointments</h3>
              <div className="space-y-2">
                {nextAppointments.length === 0 ? (
                  <p className="text-sm text-slate-500">No upcoming appointments</p>
                ) : (
                  nextAppointments.map((apt, index) => (
                    <div key={index} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{apt.patient}</p>
                          <p className="text-xs text-slate-500">{apt.doctor}</p>
                        </div>
                        <span className="text-sm font-bold text-slate-900">{apt.time}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-lg font-bold text-slate-900">Session</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Signed in as</dt>
            <dd className="mt-1 font-semibold text-slate-900">{me?.user.name ?? '—'}</dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Effective role</dt>
            <dd className="mt-1 font-semibold text-slate-900">{effectiveRole}</dd>
          </div>
          {clinicRole ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Clinic membership
              </dt>
              <dd className="mt-1 font-semibold text-slate-900">
                {clinicRole.role}
                {clinicRole.doctor_id ? ` · doctor ${clinicRole.doctor_id.slice(0, 8)}…` : ''}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
    </>
  );
}
