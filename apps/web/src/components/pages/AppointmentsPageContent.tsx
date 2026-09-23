'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useClinicProfile } from '@/components/clinic/ClinicProfileProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { PendingAppointments } from '@/components/pages/appointments/PendingAppointments';
import { ConfirmedAppointments } from '@/components/pages/appointments/ConfirmedAppointments';
import { MissedAppointments } from '@/components/pages/appointments/MissedAppointments';
import { VisitedPatients } from '@/components/pages/appointments/VisitedPatients';
import { RescheduleCancelRequests } from '@/components/pages/appointments/RescheduleCancelRequests';
import {
  ManualAppointmentModal,
  type ManualAppointmentData,
} from '@/components/pages/appointments/ManualAppointmentModal';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import {
  mapActionRequestRow,
  mapAppointmentActivityRow,
  mapAppointmentRow,
} from '@/lib/api/appointment-mappers';
import {
  cancelAppointment,
  confirmAppointment,
  createManualAppointment,
  fetchAvailableAppointmentSlots,
  fetchAppointmentActionRequests,
  fetchAppointmentActivity,
  fetchAppointments,
  markAppointmentVisited,
  rescheduleAppointment,
  resolveAppointmentActionRequest,
} from '@/lib/api/appointments';
import { ApiRequestError } from '@/lib/api/client';
import {
  filterCurrentAndFutureConfirmedAppointments,
  filterCurrentAndFuturePendingAppointments,
  filterMissedPendingAppointments,
} from '@/lib/appointment-filters';
import { fetchDoctorServices, fetchDoctors, fetchServices } from '@/lib/api/clinic-clinical';
import { fetchClinicSettings } from '@/lib/api/clinic-settings';
import { getClinicDate } from '@/lib/home-dashboard';
import { buildManualAppointmentPayload, DEFAULT_BOOKING_RULES } from '@/lib/manual-appointment';
import type {
  Appointment,
  AppointmentActionRequest,
  AppointmentActivity,
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
  const [appointmentActivities, setAppointmentActivities] = useState<AppointmentActivity[]>([]);
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
        const [rows, requests, activities, settings, doctors, services, doctorServices] =
          await Promise.all([
          fetchAppointments(clinicId),
          isAdmin ? fetchAppointmentActionRequests(clinicId) : Promise.resolve([]),
          isAdmin ? fetchAppointmentActivity(clinicId) : Promise.resolve([]),
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
        setAppointmentActivities(activities.map(mapAppointmentActivityRow));

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

  const missedPending = useMemo(
    () => (clinicDate ? filterMissedPendingAppointments(pendingAppointments, clinicDate) : []),
    [clinicDate, pendingAppointments],
  );

  const currentAndFutureConfirmed = useMemo(
    () =>
      clinicDate
        ? filterCurrentAndFutureConfirmedAppointments(confirmedAppointments, clinicDate)
        : [],
    [clinicDate, confirmedAppointments],
  );

  const visiblePending = filterByDate(currentAndFuturePending, selectedDate);
  const visibleMissed = filterByDate(missedPending, selectedDate);
  const visibleConfirmed = filterByDate(currentAndFutureConfirmed, selectedDate);
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

  const handleEditTime = async (id: string, newDate: string, newTime: string) => {
    if (!clinicId) {
      throw new Error('Select a clinic before editing an appointment.');
    }

    const appointment = [...pendingAppointments, ...confirmedAppointments].find(
      (item) => item.id === id,
    );
    if (!appointment) {
      throw new Error('Appointment could not be found. Reload the page and try again.');
    }

    if (
      newDate === appointment.appointmentDate &&
      newTime === appointment.appointmentTime
    ) {
      return;
    }

    const slots = await fetchAvailableAppointmentSlots(clinicId, {
      doctor_id: appointment.doctorId,
      clinic_service_id: appointment.serviceId,
      date: newDate,
    });
    const targetSlot = slots.find((slot) => {
      const match = slot.appointment_start
        .trim()
        .match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
      return match?.[1] === newDate && match[2] === newTime && slot.available_count > 0;
    });

    if (!targetSlot) {
      throw new Error('Slot is full for that time. Choose another available time.');
    }

    await rescheduleAppointment(clinicId, appointment.id, targetSlot.slot_id);
    await loadAppointments(false, false);
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

  const handleApproveReschedule = async (requestId: string, newDate: string, newTime: string) => {
    if (!clinicId) {
      return;
    }
    const request = actionRequests.find((r) => r.id === requestId);
    if (!request) {
      throw new Error('Appointment request could not be found. Reload the page and try again.');
    }

    let newSlotId = request.requestedNewSlotId ?? undefined;
    if (
      !newSlotId ||
      newDate !== request.requestedDate ||
      newTime !== request.requestedTime
    ) {
      const slots = await fetchAvailableAppointmentSlots(clinicId, {
        doctor_id: request.doctorId,
        clinic_service_id: request.serviceId,
        date: newDate,
      });
      newSlotId = slots.find((slot) => {
        const match = slot.appointment_start
          .trim()
          .match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
        return match?.[1] === newDate && match[2] === newTime && slot.available_count > 0;
      })?.slot_id;
    }

    if (!newSlotId) {
      throw new Error('Slot is full for that time. Choose another available time.');
    }

    await resolveAppointmentActionRequest(clinicId, requestId, {
      status: 'approved',
      new_slot_id: newSlotId,
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
          minimumEditDate={clinicDate ?? undefined}
          onEditTime={handleEditTime}
          onCancel={(id) => void handleCancel(id)}
          onMarkVisited={handleMarkVisited}
          onViewHistory={handleViewHistory}
        />
        <MissedAppointments appointments={visibleMissed} />
        <VisitedPatients
          appointments={visibleVisited}
          bookingRules={bookingRules}
          onViewHistory={handleViewHistory}
        />
        {isAdmin && (
          <RescheduleCancelRequests
            requests={actionRequests}
            activities={appointmentActivities}
            onApproveReschedule={handleApproveReschedule}
            onRejectRequest={handleRejectRequest}
            onCancelAppointment={handleCancelAppointment}
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
