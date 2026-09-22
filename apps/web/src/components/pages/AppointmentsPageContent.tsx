'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useClinicProfile } from '@/components/clinic/ClinicProfileProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { PendingAppointments } from '@/components/pages/appointments/PendingAppointments';
import { ConfirmedAppointments } from '@/components/pages/appointments/ConfirmedAppointments';
import { VisitedPatients } from '@/components/pages/appointments/VisitedPatients';
import { RescheduleCancelRequests } from '@/components/pages/appointments/RescheduleCancelRequests';
import {
  ManualAppointmentModal,
  type ManualAppointmentData,
} from '@/components/pages/appointments/ManualAppointmentModal';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import { mapActionRequestRow, mapAppointmentRow } from '@/lib/api/appointment-mappers';
import {
  cancelAppointment,
  confirmAppointment,
  createManualAppointment,
  fetchAppointmentActionRequests,
  fetchAppointments,
  markAppointmentVisited,
  resolveAppointmentActionRequest,
} from '@/lib/api/appointments';
import { ApiRequestError } from '@/lib/api/client';
import { filterCurrentAndFuturePendingAppointments } from '@/lib/appointment-filters';
import { fetchDoctorServices, fetchDoctors, fetchServices } from '@/lib/api/clinic-clinical';
import { fetchClinicSettings } from '@/lib/api/clinic-settings';
import { getClinicDate } from '@/lib/home-dashboard';
import { buildManualAppointmentPayload, DEFAULT_BOOKING_RULES } from '@/lib/manual-appointment';
import type {
  Appointment,
  AppointmentActionRequest,
  BookingRules,
} from '@/components/pages/appointments/types';

function filterByDate(appointments: Appointment[], date: string) {
  if (!date) {
    return appointments;
  }
  return appointments.filter((apt) => apt.appointmentDate === date);
}

export function AppointmentsPageContent() {
  const { effectiveRole } = useAuth();
  const { profile: clinicProfile, status: clinicProfileStatus } = useClinicProfile();
  const clinicId = useActiveClinicId();
  const isAdmin = effectiveRole === 'admin';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [bookingRules, setBookingRules] = useState<BookingRules>(DEFAULT_BOOKING_RULES);
  const [pendingAppointments, setPendingAppointments] = useState<Appointment[]>([]);
  const [confirmedAppointments, setConfirmedAppointments] = useState<Appointment[]>([]);
  const [visitedAppointments, setVisitedAppointments] = useState<Appointment[]>([]);
  const [actionRequests, setActionRequests] = useState<AppointmentActionRequest[]>([]);
  const [doctorOptions, setDoctorOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [serviceOptions, setServiceOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [doctorServiceMappings, setDoctorServiceMappings] = useState<
    Array<{ doctorId: string; serviceId: string }>
  >([]);

  const loadAppointments = useCallback(
    async (showLoading = true, includeReferenceData = true) => {
      if (!clinicId) {
        setLoading(false);
        return;
      }

      if (showLoading) {
        setLoading(true);
      }
      setError(null);
      try {
        const [rows, requests, settings, doctors, services, doctorServices] = await Promise.all([
          fetchAppointments(clinicId),
          isAdmin ? fetchAppointmentActionRequests(clinicId) : Promise.resolve([]),
          includeReferenceData
            ? fetchClinicSettings(clinicId).catch(() => null)
            : Promise.resolve(null),
          includeReferenceData ? fetchDoctors(clinicId).catch(() => []) : Promise.resolve(null),
          includeReferenceData ? fetchServices(clinicId).catch(() => []) : Promise.resolve(null),
          includeReferenceData
            ? fetchDoctorServices(clinicId).catch(() => [])
            : Promise.resolve(null),
        ]);

        if (doctors && services && doctorServices) {
          setDoctorOptions(doctors.map((d) => ({ id: d.id, name: d.name })));
          setServiceOptions(services.map((s) => ({ id: s.id, name: s.service_name })));
          setDoctorServiceMappings(
            doctorServices
              .filter((mapping) => mapping.active)
              .map((mapping) => ({
                doctorId: mapping.doctor_id,
                serviceId: mapping.clinic_service_id,
              })),
          );
        }

        const mapped = rows.map(mapAppointmentRow);
        setPendingAppointments(mapped.filter((apt) => apt.status === 'pending_confirmation'));
        setConfirmedAppointments(mapped.filter((apt) => apt.status === 'confirmed'));
        setVisitedAppointments(mapped.filter((apt) => apt.status === 'visited'));
        setActionRequests(requests.map(mapActionRequestRow));

        if (settings) {
          setBookingRules({
            ...DEFAULT_BOOKING_RULES,
            allowDoctorServiceEdit: settings.allow_doctor_service_edit,
          });
        }
      } catch (err) {
        setError(
          err instanceof ApiRequestError ? err.apiError.message : 'Failed to load appointments.',
        );
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [clinicId, isAdmin],
  );

  useEffect(() => {
    void loadAppointments();
  }, [loadAppointments]);

  const doctors = useMemo(() => {
    const map = new Map<string, string>(doctorOptions.map((d) => [d.id, d.name]));
    for (const apt of [...pendingAppointments, ...confirmedAppointments, ...visitedAppointments]) {
      map.set(apt.doctorId, apt.doctorName);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [doctorOptions, pendingAppointments, confirmedAppointments, visitedAppointments]);

  const services = useMemo(() => {
    const map = new Map<string, string>(serviceOptions.map((s) => [s.id, s.name]));
    for (const apt of [...pendingAppointments, ...confirmedAppointments, ...visitedAppointments]) {
      map.set(apt.serviceId, apt.serviceName);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [serviceOptions, pendingAppointments, confirmedAppointments, visitedAppointments]);

  const clinicDate = useMemo(() => {
    if (!clinicProfile?.timezone) {
      return null;
    }
    try {
      return getClinicDate(new Date(), clinicProfile.timezone);
    } catch {
      return null;
    }
  }, [clinicProfile?.timezone]);

  const currentAndFuturePending = useMemo(
    () =>
      clinicDate ? filterCurrentAndFuturePendingAppointments(pendingAppointments, clinicDate) : [],
    [clinicDate, pendingAppointments],
  );

  const visiblePending = filterByDate(currentAndFuturePending, selectedDate);
  const visibleConfirmed = filterByDate(confirmedAppointments, selectedDate);
  const visibleVisited = filterByDate(visitedAppointments, selectedDate);

  const pendingEmptyMessage =
    clinicProfileStatus === 'error' || (clinicProfileStatus === 'ready' && !clinicDate)
      ? 'Unable to determine the clinic date. Retry loading the clinic profile.'
      : clinicProfileStatus !== 'ready'
        ? 'Loading current and upcoming confirmations…'
        : 'No current or upcoming pending appointments';

  const handleConfirm = async (id: string) => {
    if (!clinicId) {
      return;
    }
    await confirmAppointment(clinicId, id);
    await loadAppointments(false, false);
  };

  const handleEditTime = (id: string, newTime: string) => {
    console.log('Edit time:', id, newTime);
  };

  const handleCancel = async (id: string) => {
    if (!clinicId) {
      return;
    }
    await cancelAppointment(clinicId, id);
    await loadAppointments(false, false);
  };

  const handleMarkVisited = async (id: string, visitReason: string) => {
    if (!clinicId) {
      return;
    }
    await markAppointmentVisited(clinicId, id, {
      visit_reason: visitReason,
    });
    await loadAppointments(false, false);
  };

  const handleViewHistory = (patientPhone: string) => {
    console.log('View history for:', patientPhone);
  };

  const handleCreateAppointment = async (data: ManualAppointmentData) => {
    if (!clinicId) {
      throw new Error('Select a clinic before creating an appointment.');
    }

    await createManualAppointment(
      clinicId,
      buildManualAppointmentPayload(data, bookingRules.slotDurationMinutes),
    );
    await loadAppointments(false, false);
  };

  const handleApproveReschedule = async (requestId: string, _newDate: string, _newTime: string) => {
    if (!clinicId) {
      return;
    }
    const request = actionRequests.find((r) => r.id === requestId);
    await resolveAppointmentActionRequest(clinicId, requestId, {
      status: 'approved',
      ...(request?.requestedNewSlotId ? { new_slot_id: request.requestedNewSlotId } : {}),
    });
    await loadAppointments(false, false);
  };

  const handleRejectRequest = async (requestId: string) => {
    if (!clinicId) {
      return;
    }
    await resolveAppointmentActionRequest(clinicId, requestId, { status: 'rejected' });
    await loadAppointments(false, false);
  };

  const handleCancelAppointment = async (requestId: string) => {
    if (!clinicId) {
      return;
    }
    await resolveAppointmentActionRequest(clinicId, requestId, { status: 'approved' });
    await loadAppointments(false, false);
  };

  if (loading) {
    return (
      <>
        <PageHeader title="Appointments" description="Loading appointments from the API." />
        <LoadingState
          title="Loading appointments"
          description="Fetching clinic appointment data."
        />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Appointments" description="Clinic appointments from the API." />
        <ErrorState title="Could not load appointments" description={error}>
          <button
            type="button"
            onClick={() => void loadAppointments()}
            className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white"
          >
            Retry
          </button>
        </ErrorState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Appointments"
        description={
          effectiveRole === 'doctor'
            ? 'Your pending requests, confirmed bookings, and reschedules.'
            : 'Pending requests from voice bot, confirmed bookings, and reschedules.'
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedDate('')}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100"
          >
            Today
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100"
          />
        </div>
        {isAdmin && (
          <button
            onClick={() => setIsManualModalOpen(true)}
            className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white hover:bg-teal-800"
          >
            New appointment
          </button>
        )}
      </div>

      {selectedDate && (
        <p className="mb-4 text-sm font-bold text-slate-600">
          Showing appointments for: {selectedDate}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <PendingAppointments
          appointments={visiblePending}
          emptyMessage={pendingEmptyMessage}
          bookingRules={bookingRules}
          onConfirm={(id) => void handleConfirm(id)}
          onEditTime={handleEditTime}
          onCancel={(id) => void handleCancel(id)}
          onViewHistory={handleViewHistory}
        />
        <ConfirmedAppointments
          appointments={visibleConfirmed}
          bookingRules={bookingRules}
          onEditTime={handleEditTime}
          onCancel={(id) => void handleCancel(id)}
          onMarkVisited={handleMarkVisited}
          onViewHistory={handleViewHistory}
        />
        <VisitedPatients
          appointments={visibleVisited}
          bookingRules={bookingRules}
          onViewHistory={handleViewHistory}
        />
        {isAdmin && (
          <RescheduleCancelRequests
            requests={actionRequests}
            onApproveReschedule={(id, date, time) => void handleApproveReschedule(id, date, time)}
            onRejectRequest={(id) => void handleRejectRequest(id)}
            onCancelAppointment={(id) => void handleCancelAppointment(id)}
          />
        )}
      </div>

      <ManualAppointmentModal
        isOpen={isManualModalOpen}
        onClose={() => setIsManualModalOpen(false)}
        bookingRules={bookingRules}
        doctors={doctors}
        services={services}
        doctorServiceMappings={doctorServiceMappings}
        onCreateAppointment={handleCreateAppointment}
      />
    </>
  );
}
