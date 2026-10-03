'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  filterRetainedAppointmentActivities,
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

const VISIBLE_APPOINTMENT_STATUSES = ['pending_confirmation', 'confirmed', 'visited'] as const;

type PageDataSelection = {
  showLoading?: boolean;
  includeAppointments?: boolean;
  includeActionRequests?: boolean;
  includeActivity?: boolean;
  includeSettings?: boolean;
};

type ManualReferenceData = {
  doctors: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string }>;
  doctorServiceMappings: Array<{ doctorId: string; serviceId: string }>;
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
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
  const [manualReferenceStatus, setManualReferenceStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [manualReferenceError, setManualReferenceError] = useState<string | null>(null);
  const pageLoadSequenceRef = useRef(0);
  const pageLoadAbortRef = useRef<AbortController | null>(null);
  const manualReferenceSequenceRef = useRef(0);
  const manualReferenceAbortRef = useRef<AbortController | null>(null);
  const manualReferenceCacheRef = useRef(new Map<string, ManualReferenceData>());
  const manualReferenceLoadRef = useRef<{
    clinicId: string;
    sequence: number;
    promise: Promise<boolean>;
  } | null>(null);
  const mountedRef = useRef(true);
  const activeClinicIdRef = useRef(clinicId);
  const interactionReadAbortRef = useRef<AbortController | null>(null);

  const loadAppointments = useCallback(
    async ({
      showLoading = true,
      includeAppointments = true,
      includeActionRequests = false,
      includeActivity = false,
      includeSettings = false,
    }: PageDataSelection = {}) => {
      if (!mountedRef.current) {
        return;
      }
      const sequence = pageLoadSequenceRef.current + 1;
      pageLoadSequenceRef.current = sequence;
      pageLoadAbortRef.current?.abort();
      const controller = new AbortController();
      pageLoadAbortRef.current = controller;

      if (!clinicId) {
        setPendingAppointments([]);
        setConfirmedAppointments([]);
        setVisitedAppointments([]);
        setActionRequests([]);
        setAppointmentActivities([]);
        setBookingRules(DEFAULT_BOOKING_RULES);
        setError(null);
        setLoading(false);
        return;
      }

      if (showLoading) {
        setLoading(true);
        setBookingRules(DEFAULT_BOOKING_RULES);
      }
      setError(null);
      try {
        const [rows, requests, activities, settings] = await Promise.all([
          includeAppointments
            ? fetchAppointments(clinicId, VISIBLE_APPOINTMENT_STATUSES, controller.signal)
            : Promise.resolve(null),
          isAdmin && includeActionRequests
            ? fetchAppointmentActionRequests(clinicId, controller.signal)
            : Promise.resolve(null),
          isAdmin && includeActivity
            ? fetchAppointmentActivity(clinicId, controller.signal)
            : Promise.resolve(null),
          isAdmin && includeSettings
            ? fetchClinicSettings(clinicId, controller.signal).catch((settingsError: unknown) => {
                if (isAbortError(settingsError)) {
                  throw settingsError;
                }
                return null;
              })
            : Promise.resolve(null),
        ]);

        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          pageLoadSequenceRef.current !== sequence
        ) {
          return;
        }

        if (rows) {
          const mapped = rows.map(mapAppointmentRow);
          setPendingAppointments(mapped.filter((apt) => apt.status === 'pending_confirmation'));
          setConfirmedAppointments(mapped.filter((apt) => apt.status === 'confirmed'));
          setVisitedAppointments(mapped.filter((apt) => apt.status === 'visited'));
        }
        if (requests) {
          setActionRequests(requests.map(mapActionRequestRow));
        }
        if (activities) {
          setAppointmentActivities(activities.map(mapAppointmentActivityRow));
        }

        if (settings) {
          setBookingRules({
            ...DEFAULT_BOOKING_RULES,
            allowDoctorServiceEdit: settings.allow_doctor_service_edit,
          });
        }
      } catch (err) {
        if (
          controller.signal.aborted ||
          !mountedRef.current ||
          pageLoadSequenceRef.current !== sequence ||
          isAbortError(err)
        ) {
          return;
        }
        setError(
          err instanceof ApiRequestError ? err.apiError.message : 'Failed to load appointments.',
        );
      } finally {
        if (pageLoadAbortRef.current === controller) {
          pageLoadAbortRef.current = null;
        }
        if (
          showLoading &&
          mountedRef.current &&
          !controller.signal.aborted &&
          pageLoadSequenceRef.current === sequence
        ) {
          setLoading(false);
        }
      }
    },
    [clinicId, isAdmin],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      interactionReadAbortRef.current?.abort();
      interactionReadAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    activeClinicIdRef.current = clinicId;
    interactionReadAbortRef.current?.abort();
    interactionReadAbortRef.current = null;
  }, [clinicId]);

  useEffect(() => {
    void loadAppointments({
      showLoading: true,
      includeAppointments: true,
      includeActionRequests: isAdmin,
      includeActivity: isAdmin,
      includeSettings: isAdmin,
    });

    return () => {
      pageLoadSequenceRef.current += 1;
      pageLoadAbortRef.current?.abort();
      pageLoadAbortRef.current = null;
    };
  }, [isAdmin, loadAppointments]);

  useEffect(() => {
    manualReferenceSequenceRef.current += 1;
    manualReferenceAbortRef.current?.abort();
    manualReferenceAbortRef.current = null;
    manualReferenceLoadRef.current = null;
    setDoctorOptions([]);
    setServiceOptions([]);
    setDoctorServiceMappings([]);
    setManualReferenceStatus('idle');
    setManualReferenceError(null);
    setIsManualModalOpen(false);

    return () => {
      manualReferenceSequenceRef.current += 1;
      manualReferenceAbortRef.current?.abort();
      manualReferenceAbortRef.current = null;
      manualReferenceLoadRef.current = null;
    };
  }, [clinicId, isAdmin]);

  const applyManualReferenceData = useCallback((data: ManualReferenceData) => {
    setDoctorOptions(data.doctors);
    setServiceOptions(data.services);
    setDoctorServiceMappings(data.doctorServiceMappings);
  }, []);

  const ensureManualReferenceData = useCallback((): Promise<boolean> => {
    if (!clinicId || !isAdmin) {
      return Promise.resolve(false);
    }

    const cached = manualReferenceCacheRef.current.get(clinicId);
    if (cached) {
      applyManualReferenceData(cached);
      setManualReferenceStatus('ready');
      setManualReferenceError(null);
      return Promise.resolve(true);
    }

    const existing = manualReferenceLoadRef.current;
    if (existing?.clinicId === clinicId) {
      return existing.promise;
    }

    const targetClinicId = clinicId;
    const sequence = manualReferenceSequenceRef.current + 1;
    manualReferenceSequenceRef.current = sequence;
    manualReferenceAbortRef.current?.abort();
    const controller = new AbortController();
    manualReferenceAbortRef.current = controller;
    setManualReferenceStatus('loading');
    setManualReferenceError(null);

    const promise = (async () => {
      try {
        const [doctors, services, doctorServices] = await Promise.all([
          fetchDoctors(targetClinicId, controller.signal),
          fetchServices(targetClinicId, controller.signal),
          fetchDoctorServices(targetClinicId, controller.signal),
        ]);

        if (controller.signal.aborted || manualReferenceSequenceRef.current !== sequence) {
          return false;
        }

        const data: ManualReferenceData = {
          doctors: doctors.map((doctor) => ({ id: doctor.id, name: doctor.name })),
          services: services.map((service) => ({ id: service.id, name: service.service_name })),
          doctorServiceMappings: doctorServices
            .filter((mapping) => mapping.active)
            .map((mapping) => ({
              doctorId: mapping.doctor_id,
              serviceId: mapping.clinic_service_id,
            })),
        };
        manualReferenceCacheRef.current.set(targetClinicId, data);
        applyManualReferenceData(data);
        setManualReferenceStatus('ready');
        return true;
      } catch (referenceError) {
        if (
          controller.signal.aborted ||
          isAbortError(referenceError) ||
          manualReferenceSequenceRef.current !== sequence
        ) {
          return false;
        }

        controller.abort();
        setManualReferenceStatus('error');
        setManualReferenceError(
          referenceError instanceof ApiRequestError
            ? referenceError.apiError.message
            : 'Unable to load appointment booking options. Please try again.',
        );
        return false;
      } finally {
        if (manualReferenceAbortRef.current === controller) {
          manualReferenceAbortRef.current = null;
        }
        if (manualReferenceLoadRef.current?.sequence === sequence) {
          manualReferenceLoadRef.current = null;
        }
      }
    })();

    manualReferenceLoadRef.current = { clinicId: targetClinicId, sequence, promise };
    return promise;
  }, [applyManualReferenceData, clinicId, isAdmin]);

  const handleOpenManualAppointment = useCallback(async () => {
    const ready = await ensureManualReferenceData();
    if (ready) {
      setIsManualModalOpen(true);
    }
  }, [ensureManualReferenceData]);

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
  const visibleAppointmentActivities = useMemo(
    () =>
      clinicDate && clinicProfile?.timezone
        ? filterRetainedAppointmentActivities(
            appointmentActivities,
            clinicDate,
            clinicProfile.timezone,
          )
        : [],
    [appointmentActivities, clinicDate, clinicProfile?.timezone],
  );

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
    const targetClinicId = clinicId;
    await confirmAppointment(targetClinicId, id);
    if (mountedRef.current && activeClinicIdRef.current === targetClinicId) {
      await loadAppointments({ showLoading: false });
    }
  };

  const handleEditTime = async (id: string, newDate: string, newTime: string) => {
    if (!clinicId) {
      throw new Error('Select a clinic before editing an appointment.');
    }

    const targetClinicId = clinicId;
    const appointment = [...pendingAppointments, ...confirmedAppointments].find(
      (item) => item.id === id,
    );
    if (!appointment) {
      throw new Error('Appointment could not be found. Reload the page and try again.');
    }

    if (newDate === appointment.appointmentDate && newTime === appointment.appointmentTime) {
      return;
    }

    interactionReadAbortRef.current?.abort();
    const controller = new AbortController();
    interactionReadAbortRef.current = controller;
    const slots = await fetchAvailableAppointmentSlots(
      targetClinicId,
      {
        doctor_id: appointment.doctorId,
        clinic_service_id: appointment.serviceId,
        date: newDate,
      },
      controller.signal,
    );
    if (
      controller.signal.aborted ||
      !mountedRef.current ||
      activeClinicIdRef.current !== targetClinicId
    ) {
      return;
    }
    const targetSlot = slots.find((slot) => {
      const match = slot.appointment_start.trim().match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
      return match?.[1] === newDate && match[2] === newTime && slot.available_count > 0;
    });

    if (!targetSlot) {
      throw new Error('Slot is full for that time. Choose another available time.');
    }

    await rescheduleAppointment(targetClinicId, appointment.id, targetSlot.slot_id);
    if (mountedRef.current && activeClinicIdRef.current === targetClinicId) {
      await loadAppointments({ showLoading: false, includeActivity: isAdmin });
    }
  };

  const handleCancel = async (id: string) => {
    if (!clinicId) {
      return;
    }
    const targetClinicId = clinicId;
    await cancelAppointment(targetClinicId, id);
    if (mountedRef.current && activeClinicIdRef.current === targetClinicId) {
      await loadAppointments({ showLoading: false, includeActivity: isAdmin });
    }
  };

  const handleMarkVisited = async (id: string, visitReason: string) => {
    if (!clinicId) {
      return;
    }
    const targetClinicId = clinicId;
    await markAppointmentVisited(targetClinicId, id, {
      visit_reason: visitReason,
    });
    if (mountedRef.current && activeClinicIdRef.current === targetClinicId) {
      await loadAppointments({ showLoading: false });
    }
  };

  const handleViewHistory = (patientPhone: string) => {
    console.log('View history for:', patientPhone);
  };

  const handleCreateAppointment = async (data: ManualAppointmentData) => {
    if (!clinicId) {
      throw new Error('Select a clinic before creating an appointment.');
    }

    const targetClinicId = clinicId;
    await createManualAppointment(
      targetClinicId,
      buildManualAppointmentPayload(data, bookingRules.slotDurationMinutes),
    );
    if (mountedRef.current && activeClinicIdRef.current === targetClinicId) {
      await loadAppointments({ showLoading: false });
    }
  };

  const handleApproveReschedule = async (requestId: string, newDate: string, newTime: string) => {
    if (!clinicId) {
      return;
    }
    const targetClinicId = clinicId;
    const request = actionRequests.find((r) => r.id === requestId);
    if (!request) {
      throw new Error('Appointment request could not be found. Reload the page and try again.');
    }

    let newSlotId = request.requestedNewSlotId ?? undefined;
    if (!newSlotId || newDate !== request.requestedDate || newTime !== request.requestedTime) {
      interactionReadAbortRef.current?.abort();
      const controller = new AbortController();
      interactionReadAbortRef.current = controller;
      const slots = await fetchAvailableAppointmentSlots(
        targetClinicId,
        {
          doctor_id: request.doctorId,
          clinic_service_id: request.serviceId,
          date: newDate,
        },
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        !mountedRef.current ||
        activeClinicIdRef.current !== targetClinicId
      ) {
        return;
      }
      newSlotId = slots.find((slot) => {
        const match = slot.appointment_start.trim().match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
        return match?.[1] === newDate && match[2] === newTime && slot.available_count > 0;
      })?.slot_id;
    }

    if (!newSlotId) {
      throw new Error('Slot is full for that time. Choose another available time.');
    }

    await resolveAppointmentActionRequest(targetClinicId, requestId, {
      status: 'approved',
      new_slot_id: newSlotId,
    });
    if (mountedRef.current && activeClinicIdRef.current === targetClinicId) {
      await loadAppointments({
        showLoading: false,
        includeActionRequests: true,
        includeActivity: true,
      });
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    if (!clinicId) {
      return;
    }
    const targetClinicId = clinicId;
    await resolveAppointmentActionRequest(targetClinicId, requestId, { status: 'rejected' });
    if (mountedRef.current && activeClinicIdRef.current === targetClinicId) {
      await loadAppointments({
        showLoading: false,
        includeAppointments: false,
        includeActionRequests: true,
      });
    }
  };

  const handleCancelAppointment = async (requestId: string) => {
    if (!clinicId) {
      return;
    }
    const targetClinicId = clinicId;
    await resolveAppointmentActionRequest(targetClinicId, requestId, { status: 'approved' });
    if (mountedRef.current && activeClinicIdRef.current === targetClinicId) {
      await loadAppointments({
        showLoading: false,
        includeActionRequests: true,
        includeActivity: true,
      });
    }
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
            onClick={() =>
              void loadAppointments({
                showLoading: true,
                includeAppointments: true,
                includeActionRequests: isAdmin,
                includeActivity: isAdmin,
                includeSettings: isAdmin,
              })
            }
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
          <div className="flex max-w-md flex-col items-end gap-2">
            <button
              type="button"
              onClick={() => void handleOpenManualAppointment()}
              disabled={manualReferenceStatus === 'loading'}
              className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white hover:bg-teal-800 disabled:cursor-wait disabled:opacity-60"
            >
              {manualReferenceStatus === 'loading' ? 'Loading booking options…' : 'New appointment'}
            </button>
            {manualReferenceError ? (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-end gap-2 text-right text-xs font-semibold text-red-600"
              >
                <span>{manualReferenceError}</span>
                <button
                  type="button"
                  onClick={() => void handleOpenManualAppointment()}
                  className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 font-bold text-red-700 hover:bg-red-100"
                >
                  Retry
                </button>
              </div>
            ) : null}
          </div>
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
            activities={visibleAppointmentActivities}
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
