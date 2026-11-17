'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useClinicProfile } from '@/components/clinic/ClinicProfileProvider';
import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import {
  fetchAppointments,
  markAppointmentVisited,
  type AppointmentApiRow,
} from '@/lib/api/appointments';
import { ApiRequestError, isAbortError } from '@/lib/api/client';
import {
  fetchClinicHours,
  fetchDoctorSchedules,
  fetchDoctorServices,
  fetchHolidays,
  fetchServices,
} from '@/lib/api/clinic-clinical';
import { computeDoctorDayAvailability } from '@/lib/doctor-dashboard';
import { getClinicDate } from '@/lib/home-dashboard';
import type { Patient, PatientVisitHistory } from './doctor-data';
import { useDoctorNav } from './DoctorLayout';

function statusLabel(status: Patient['status']): string {
  return {
    waiting: 'Waiting',
    'in-progress': 'In Progress',
    visited: 'Visited',
    skipped: 'Skipped',
  }[status];
}

function statusChipClass(status: Patient['status']): string {
  const map: Record<Patient['status'], string> = {
    waiting: 'border-amber-200 bg-amber-50 text-amber-700',
    'in-progress': 'border-blue-200 bg-blue-50 text-blue-700',
    visited: 'border-green-200 bg-green-50 text-green-700',
    skipped: 'border-slate-200 bg-slate-50 text-slate-600',
  };
  return map[status];
}

function appointmentDatePart(value: string): string {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match?.[1]) {
    return match[1];
  }
  return value.split(/[T\s]/)[0] ?? '';
}

function formatAppointmentTime(value: string): string {
  const match = value.match(/(?:T|\s)(\d{2}):(\d{2})/);
  if (!match) {
    return value;
  }
  const hours = Number(match[1]);
  const minutes = match[2] ?? '00';
  if (Number.isNaN(hours)) {
    return value;
  }
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHours = String(hours % 12 || 12).padStart(2, '0');
  return `${displayHours}:${minutes} ${suffix}`;
}

function parseDateInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : parsed;
}

function shiftDate(value: string, days: number): string {
  const parsed = parseDateInput(value);
  if (!parsed) return value;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function formatQueueDate(value: string): string {
  const parsed = parseDateInput(value);
  if (!parsed) {
    return value;
  }

  return parsed.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function formatQueueDateShort(value: string): string {
  const parsed = parseDateInput(value);
  if (!parsed) {
    return value;
  }

  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

type QueuePatient = Omit<Patient, 'age' | 'gender'> & {
  age: number | null;
  gender: string | null;
  hasHistory: boolean;
  appointmentStatus: 'confirmed' | 'visited';
  appointmentStartRaw: string;
  doctorName: string;
  serviceName: string;
  visitReason?: string | null;
  visitExaminationNotes?: string | null;
  visitDiagnosis?: string | null;
  visitAdvice?: string | null;
};

function demographicLabel(patient: QueuePatient): string {
  return [patient.age !== null ? `${patient.age} yrs` : null, patient.gender]
    .filter(Boolean)
    .join(' · ');
}

function mapAppointmentToQueuePatient(row: AppointmentApiRow): QueuePatient {
  return {
    id: row.id,
    name: row.patient_name,
    age: row.patient_age ?? null,
    gender: row.patient_gender?.trim() || null,
    phone: row.patient_phone ?? '',
    time: formatAppointmentTime(row.appointment_start),
    type: 'in-person',
    status: row.status === 'visited' ? 'visited' : 'waiting',
    appointmentStatus: row.status === 'visited' ? 'visited' : 'confirmed',
    hasHistory: row.has_history,
    reason: row.reason_for_visit,
    ...(row.diagnosis ? { diagnosis: row.diagnosis } : {}),
    ...(row.advice ? { advice: row.advice } : {}),
    ...(row.examination_notes ? { visitNote: row.examination_notes } : {}),
    history: [],
    appointmentStartRaw: row.appointment_start,
    doctorName: row.doctor_name,
    serviceName: row.service_name,
    visitReason: row.visit_reason ?? row.reason_for_visit,
    visitExaminationNotes: row.examination_notes ?? null,
    visitDiagnosis: row.diagnosis ?? null,
    visitAdvice: row.advice ?? null,
  };
}

function formatClinicalField(value?: string | null): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'Not recorded';
}

export function TodayQueue() {
  const { setPatientCount } = useDoctorNav();
  const { me } = useAuth();
  const clinicId = useActiveClinicId();
  const { profile, status: profileStatus, refresh: refreshProfile } = useClinicProfile();
  const doctorId =
    me?.clinics.find(
      (membership) =>
        membership.clinic_id === clinicId && membership.role === 'doctor' && membership.active,
    )?.doctor_id ?? null;
  const [now, setNow] = useState(() => new Date());
  const todayDate = useMemo(() => {
    if (profileStatus !== 'ready' || !profile?.timezone) return null;
    try {
      return getClinicDate(now, profile.timezone);
    } catch {
      return null;
    }
  }, [now, profile?.timezone, profileStatus]);
  const [selectedDate, setSelectedDate] = useState('');
  const [patients, setPatients] = useState<QueuePatient[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<ReturnType<
    typeof computeDoctorDayAvailability
  > | null>(null);
  const [loadedContext, setLoadedContext] = useState<string | null>(null);
  const [markingVisitedId, setMarkingVisitedId] = useState<string | null>(null);
  const [historyModal, setHistoryModal] = useState<{
    patient: QueuePatient;
    entry: PatientVisitHistory;
  } | null>(null);
  const [visitedDetailsModal, setVisitedDetailsModal] = useState<QueuePatient | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const queueLoadSequenceRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);
  const identity = `${clinicId ?? ''}:${doctorId ?? ''}`;
  const context = `${identity}:${selectedDate}`;
  const activeContextRef = useRef(context);
  activeContextRef.current = context;
  const previousDayRef = useRef<{ identity: string; today: string | null }>({
    identity: '',
    today: null,
  });
  // Refreshing the same day must keep the consultation form mounted so its
  // unsaved notes survive focus/visibility refreshes. Other dates or doctors
  // remain hidden until their own data has loaded.
  const queueReady = loadedContext === context;
  const isViewingToday = Boolean(todayDate && selectedDate === todayDate);
  const selectedDateLabel = selectedDate ? formatQueueDate(selectedDate) : 'Loading clinic date…';
  const selectedDateLabelShort = selectedDate ? formatQueueDateShort(selectedDate) : '';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    const refreshDate = () => setNow(new Date());
    const timer = window.setInterval(refreshDate, 60_000);
    window.addEventListener('focus', refreshDate);
    document.addEventListener('visibilitychange', refreshDate);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refreshDate);
      document.removeEventListener('visibilitychange', refreshDate);
    };
  }, []);

  useEffect(() => {
    const previous = previousDayRef.current;
    if (previous.identity !== identity) {
      setSelectedDate(todayDate ?? '');
      setPatients([]);
      setSelectedId(null);
      setHistoryModal(null);
      setVisitedDetailsModal(null);
      setMarkingVisitedId(null);
      setAvailability(null);
      setLoadedContext(null);
    } else if (todayDate && previous.today !== todayDate) {
      setSelectedDate((value) => (!value || value === previous.today ? todayDate : value));
    }
    previousDayRef.current = { identity, today: todayDate };
  }, [identity, todayDate]);

  const loadQueue = useCallback(
    async (signal?: AbortSignal) => {
      const sequence = ++queueLoadSequenceRef.current;
      if (!clinicId || !doctorId) {
        setLoadingQueue(false);
        setQueueError(
          'Your doctor profile is not linked to this clinic. Contact the clinic administrator.',
        );
        return;
      }
      if (profileStatus === 'error' || (profileStatus === 'ready' && !todayDate)) {
        setLoadingQueue(false);
        setQueueError('Clinic details could not be loaded. Please retry.');
        return;
      }
      if (profileStatus !== 'ready' || !selectedDate || !todayDate) {
        setLoadingQueue(true);
        return;
      }
      setLoadingQueue(true);
      setQueueError(null);
      try {
        const [rows, schedules, clinicHours, holidays, doctorServices, services] =
          await Promise.all([
            fetchAppointments(clinicId, ['confirmed', 'visited'], signal, selectedDate),
            fetchDoctorSchedules(clinicId, doctorId, signal),
            fetchClinicHours(clinicId, signal),
            fetchHolidays(clinicId, signal),
            fetchDoctorServices(clinicId, signal),
            fetchServices(clinicId, signal),
          ]);
        if (
          sequence !== queueLoadSequenceRef.current ||
          signal?.aborted ||
          activeContextRef.current !== context
        )
          return;
        const mapped = rows
          .filter(
            (row) =>
              row.doctor_id === doctorId &&
              appointmentDatePart(row.appointment_start) === selectedDate &&
              (row.status === 'confirmed' || row.status === 'visited'),
          )
          .sort((left, right) => left.appointment_start.localeCompare(right.appointment_start))
          .map(mapAppointmentToQueuePatient);
        setPatients((previous) => {
          const previousById = new Map(previous.map((patient) => [patient.id, patient]));
          return mapped.map((patient) => {
            const previousPatient = previousById.get(patient.id);
            if (
              patient.status === 'waiting' &&
              previousPatient &&
              (previousPatient.status === 'in-progress' || previousPatient.status === 'skipped')
            ) {
              return {
                ...patient,
                status: previousPatient.status,
                ...(previousPatient.visitNote !== undefined
                  ? { visitNote: previousPatient.visitNote }
                  : {}),
                ...(previousPatient.diagnosis !== undefined
                  ? { diagnosis: previousPatient.diagnosis }
                  : {}),
                ...(previousPatient.advice !== undefined ? { advice: previousPatient.advice } : {}),
              };
            }
            return patient;
          });
        });
        setAvailability(
          computeDoctorDayAvailability({
            date: selectedDate,
            doctorId,
            schedules,
            clinicHours,
            holidays,
            doctorServices,
            services,
          }),
        );
        setLoadedContext(context);
        setSelectedId((current) =>
          current &&
          mapped.some((patient) => patient.id === current && patient.status !== 'visited')
            ? current
            : null,
        );
      } catch (error) {
        if (
          isAbortError(error) ||
          signal?.aborted ||
          sequence !== queueLoadSequenceRef.current ||
          activeContextRef.current !== context
        )
          return;
        setQueueError(
          error instanceof ApiRequestError
            ? error.apiError.message
            : error instanceof Error
              ? error.message
              : 'Unable to load appointments.',
        );
      } finally {
        if (
          sequence === queueLoadSequenceRef.current &&
          !signal?.aborted &&
          activeContextRef.current === context
        )
          setLoadingQueue(false);
      }
    },
    [clinicId, context, doctorId, profileStatus, selectedDate, todayDate],
  );

  const refreshQueue = useCallback(() => {
    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    void loadQueue(controller.signal);
  }, [loadQueue]);

  useEffect(() => {
    refreshQueue();
    const refreshVisibleQueue = () => {
      if (document.visibilityState !== 'hidden') refreshQueue();
    };
    window.addEventListener('focus', refreshVisibleQueue);
    document.addEventListener('visibilitychange', refreshVisibleQueue);
    return () => {
      queueLoadSequenceRef.current += 1;
      activeControllerRef.current?.abort();
      window.removeEventListener('focus', refreshVisibleQueue);
      document.removeEventListener('visibilitychange', refreshVisibleQueue);
    };
  }, [refreshQueue]);

  useEffect(() => {
    setPatientCount(queueReady ? patients.length : 0);
  }, [patients.length, queueReady, setPatientCount]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const selectPatient = useCallback(
    (id: string) => {
      const patient = patients.find((row) => row.id === id);
      if (!patient) {
        return;
      }

      if (patient.status === 'visited') {
        setVisitedDetailsModal(patient);
        setSelectedId(null);
        return;
      }

      setSelectedId(id);
    },
    [patients],
  );

  const startConsultation = useCallback(
    (id: string) => {
      setPatients((prev) =>
        prev.map((p) => {
          if (p.id === id) return { ...p, status: 'in-progress' as const };
          if (p.status === 'in-progress') return { ...p, status: 'waiting' as const };
          return p;
        }),
      );
      setSelectedId(id);
      showToast('Consultation started.');
    },
    [showToast],
  );

  const skipPatient = useCallback(
    (id: string) => {
      setPatients((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: 'skipped' as const } : p)),
      );
      if (selectedId === id) setSelectedId(null);
      showToast('Patient skipped.');
    },
    [selectedId, showToast],
  );

  const saveDraft = useCallback(
    (id: string) => {
      const noteEl = document.getElementById('noteField') as HTMLTextAreaElement | null;
      const diagEl = document.getElementById('diagnosisField') as HTMLInputElement | null;
      const adviceEl = document.getElementById('adviceField') as HTMLTextAreaElement | null;
      setPatients((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                visitNote: noteEl?.value ?? '',
                diagnosis: diagEl?.value ?? '',
                advice: adviceEl?.value ?? '',
              }
            : p,
        ),
      );
      showToast('Draft saved.');
    },
    [showToast],
  );

  const markVisited = useCallback(
    async (id: string) => {
      if (!clinicId) {
        showToast('Clinic context missing. Please re-login.');
        return;
      }

      const targetClinicId = clinicId;
      const targetContext = context;

      const current = patients.find((patient) => patient.id === id);
      if (!current) {
        return;
      }

      const noteEl = document.getElementById('noteField') as HTMLTextAreaElement | null;
      const diagEl = document.getElementById('diagnosisField') as HTMLInputElement | null;
      const adviceEl = document.getElementById('adviceField') as HTMLTextAreaElement | null;

      const visitReason =
        noteEl?.value.trim() || diagEl?.value.trim() || adviceEl?.value.trim() || current.reason;

      const examinationNotes = noteEl?.value.trim() || undefined;
      const diagnosis = diagEl?.value.trim() || undefined;
      const advice = adviceEl?.value.trim() || undefined;

      setMarkingVisitedId(id);
      try {
        await markAppointmentVisited(targetClinicId, id, {
          visit_reason: visitReason,
          ...(examinationNotes ? { examination_notes: examinationNotes } : {}),
          ...(diagnosis ? { diagnosis } : {}),
          ...(advice ? { advice } : {}),
        });
        if (!mountedRef.current || activeContextRef.current !== targetContext) {
          return;
        }
        // A list read started before this write can still return "confirmed".
        // Invalidate it before applying the saved visit so it cannot roll back
        // the visible status/counts or revive the completed consultation.
        queueLoadSequenceRef.current += 1;
        activeControllerRef.current?.abort();
        activeControllerRef.current = null;
        setLoadingQueue(false);
        setQueueError(null);
        setPatients((currentRows) =>
          currentRows.map((patient) =>
            patient.id === id
              ? {
                  ...patient,
                  status: 'visited',
                  appointmentStatus: 'visited',
                  visitReason,
                  visitExaminationNotes: examinationNotes ?? null,
                  visitDiagnosis: diagnosis ?? null,
                  visitAdvice: advice ?? null,
                  ...(examinationNotes ? { visitNote: examinationNotes } : {}),
                  ...(diagnosis ? { diagnosis } : {}),
                  ...(advice ? { advice } : {}),
                }
              : patient,
          ),
        );
        setSelectedId(null);
        showToast('Marked as visited.');
      } catch (error) {
        if (!mountedRef.current || activeContextRef.current !== targetContext) {
          return;
        }
        showToast(
          error instanceof ApiRequestError
            ? error.apiError.message
            : error instanceof Error
              ? error.message
              : 'Failed to mark as visited.',
        );
      } finally {
        if (mountedRef.current && activeContextRef.current === targetContext) {
          setMarkingVisitedId(null);
        }
      }
    },
    [clinicId, context, patients, showToast],
  );

  function selectDate(date: string) {
    setSelectedDate(date);
    setSelectedId(null);
    setHistoryModal(null);
    setVisitedDetailsModal(null);
  }

  const waiting = patients.filter((p) => p.status === 'waiting');
  const inProgress = patients.find((p) => p.status === 'in-progress') ?? null;
  const visited = patients.filter((p) => p.status === 'visited');
  const skipped = patients.filter((p) => p.status === 'skipped');
  const confirmedCount = patients.filter(
    (patient) => patient.appointmentStatus === 'confirmed',
  ).length;
  const currentConsult =
    queueReady && inProgress && selectedId === inProgress.id ? inProgress : null;

  return (
    <>
      <div className="mb-5 flex min-w-0 flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-[26px] font-black tracking-tight text-slate-900">
            {isViewingToday ? "Today's Queue" : 'Appointment Queue'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{selectedDateLabel}</p>
        </div>
        <div className="min-w-0 xl:w-auto">
          <label
            htmlFor="doctor-queue-date"
            className="mb-1.5 block text-xs font-bold text-slate-600"
          >
            Appointment date
          </label>
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm focus-within:border-teal-600 focus-within:ring-2 focus-within:ring-teal-600/15">
              <button
                type="button"
                aria-label="Previous day"
                disabled={!selectedDate}
                onClick={() => selectDate(shiftDate(selectedDate, -1))}
                className="flex h-10 w-9 shrink-0 items-center justify-center rounded-lg text-xl text-slate-500 hover:bg-slate-50 hover:text-teal-700 disabled:opacity-40"
              >
                <span aria-hidden="true">‹</span>
              </button>
              <input
                id="doctor-queue-date"
                type="date"
                value={selectedDate}
                min="0001-01-01"
                max="9999-12-31"
                disabled={!todayDate}
                onChange={(event) => {
                  if (parseDateInput(event.target.value)) selectDate(event.target.value);
                }}
                className="h-10 min-w-0 flex-1 bg-transparent px-2 text-sm font-semibold text-slate-900 outline-none xl:w-[150px]"
              />
              <button
                type="button"
                aria-label="Next day"
                disabled={!selectedDate}
                onClick={() => selectDate(shiftDate(selectedDate, 1))}
                className="flex h-10 w-9 shrink-0 items-center justify-center rounded-lg text-xl text-slate-500 hover:bg-slate-50 hover:text-teal-700 disabled:opacity-40"
              >
                <span aria-hidden="true">›</span>
              </button>
            </div>
            <button
              type="button"
              disabled={!todayDate || isViewingToday}
              onClick={() => {
                if (todayDate) selectDate(todayDate);
              }}
              className="h-12 shrink-0 rounded-xl border border-teal-200 bg-teal-50 px-4 text-sm font-bold text-teal-800 transition hover:bg-teal-100 disabled:cursor-default disabled:border-slate-200 disabled:bg-white disabled:text-slate-400"
            >
              Today
            </button>
          </div>
        </div>
      </div>
      {!queueReady && (loadingQueue || !queueError) ? (
        <div
          role="status"
          className="mb-5 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500"
        >
          Loading appointments and working hours…
        </div>
      ) : null}
      {queueReady && loadingQueue ? (
        <p role="status" className="mb-3 text-xs font-semibold text-slate-500">
          Refreshing appointments and working hours…
        </p>
      ) : null}
      {queueError ? (
        <div role="alert" className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-5">
          <p className="text-sm font-semibold text-red-700">{queueError}</p>
          {queueReady ? (
            <p className="mt-1 text-xs text-red-700">
              Showing the last loaded appointments and working hours.
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (profileStatus === 'error' || !todayDate) refreshProfile();
              else refreshQueue();
            }}
            className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      ) : null}

      {queueReady && availability ? (
        <section
          aria-label="Appointment summary"
          className="mb-5 rounded-[22px] bg-gradient-to-br from-teal-700 to-slate-900 p-5 sm:p-6"
        >
          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)] xl:items-center">
            <div className="min-w-0">
              <h2 className="text-xl font-black text-white">
                {patients.length} {patients.length === 1 ? 'appointment' : 'appointments'}{' '}
                {isViewingToday ? 'today' : `on ${selectedDateLabelShort}`}
              </h2>
              <p className="mt-1 text-[13px] text-teal-100">
                Confirmed and visited appointments for the selected date.
              </p>
              <section aria-label="Working hours" className="mt-4">
                <p className="mb-2 text-xs font-bold text-teal-100">Working hours</p>
                {availability.windows.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {availability.windows.map((window) => (
                      <span
                        key={`${window.start}-${window.end}`}
                        className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-semibold text-white"
                      >
                        {window.label}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-white">{availability.message}</p>
                )}
              </section>
              <div className="mt-3 flex flex-wrap gap-x-2 gap-y-1 text-xs text-teal-100">
                <span className="font-bold">Services:</span>
                {availability.serviceNames.length ? (
                  <span>{availability.serviceNames.join(' · ')}</span>
                ) : (
                  <span>No active services assigned.</span>
                )}
              </div>
            </div>
            <dl className="grid min-w-0 grid-cols-3 gap-2 sm:gap-3">
              {[
                { value: confirmedCount, label: 'Confirmed' },
                { value: visited.length, label: 'Visited' },
                { value: patients.length, label: 'Total' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="min-w-0 rounded-2xl border border-white/15 bg-white/10 px-2 py-4 text-center"
                >
                  <dd className="text-2xl font-black text-white">{stat.value}</dd>
                  <dt className="mt-1 text-xs font-semibold text-teal-100">{stat.label}</dt>
                </div>
              ))}
            </dl>
          </div>
        </section>
      ) : null}

      {/* Split: Queue + Consultation Panel */}
      {queueReady && (
        <div
          className={`portal-workspace-grid gap-[18px] ${currentConsult ? 'has-secondary-panel' : ''}`}
        >
          {/* Queue Column */}
          <div>
            {inProgress && (
              <PatientGroup
                title="In Progress"
                icon="⚕"
                color="text-blue-700"
                patients={[inProgress]}
                selectedId={selectedId}
                onSelect={selectPatient}
                onStart={startConsultation}
                onSkip={skipPatient}
              />
            )}
            {waiting.length > 0 && (
              <PatientGroup
                title="Waiting"
                icon="◷"
                color="text-amber-600"
                patients={waiting}
                selectedId={selectedId}
                onSelect={selectPatient}
                onStart={startConsultation}
                onSkip={skipPatient}
              />
            )}
            {visited.length > 0 && (
              <PatientGroup
                title="Visited"
                icon="✓"
                color="text-green-600"
                patients={visited}
                selectedId={selectedId}
                onSelect={selectPatient}
                onStart={startConsultation}
                onSkip={skipPatient}
              />
            )}
            {skipped.length > 0 && (
              <PatientGroup
                title="Skipped"
                icon="⚠"
                color="text-slate-500"
                patients={skipped}
                selectedId={selectedId}
                onSelect={selectPatient}
                onStart={startConsultation}
                onSkip={skipPatient}
              />
            )}
            {patients.length === 0 && (
              <div className="rounded-[22px] border border-slate-200 bg-white p-12 text-center text-slate-400">
                No confirmed or visited appointments for{' '}
                {isViewingToday ? 'today' : selectedDateLabelShort}.
              </div>
            )}
          </div>

          {/* Consultation Panel */}
          {currentConsult && (
            <ConsultationPanel
              key={currentConsult.id}
              patient={currentConsult}
              onSaveDraft={saveDraft}
              onMarkVisited={markVisited}
              isMarkingVisited={markingVisitedId === currentConsult.id}
              onShowHistory={(entry) => setHistoryModal({ patient: currentConsult, entry })}
            />
          )}
        </div>
      )}

      {/* History Modal */}
      {historyModal && (
        <div
          className="fixed inset-0 z-10 grid place-items-center bg-slate-900/55 p-5"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setHistoryModal(null);
          }}
        >
          <div className="w-full max-w-[620px] rounded-[22px] bg-white p-[22px] shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-extrabold text-slate-900">
                  {historyModal.patient.name} – Previous Visit
                </h2>
                <p className="text-sm text-slate-500">{historyModal.entry.date}</p>
              </div>
              <button
                onClick={() => setHistoryModal(null)}
                className="rounded-[11px] border border-slate-200 bg-slate-50 px-3 py-[7px] text-xs font-extrabold text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>
            <div className="grid gap-3">
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-[14px] py-3">
                <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                  Reason
                </span>
                <p className="text-sm text-slate-900">{historyModal.entry.reason}</p>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-[14px] py-3">
                <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                  Diagnosis
                </span>
                <p className="text-sm text-slate-900">{historyModal.entry.diagnosis}</p>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-[14px] py-3">
                <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                  Doctor
                </span>
                <p className="text-sm font-bold text-slate-900">{historyModal.entry.doctor}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Visited Details Modal */}
      {visitedDetailsModal && (
        <div
          className="fixed inset-0 z-10 grid place-items-center bg-slate-900/55 p-5"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setVisitedDetailsModal(null);
            }
          }}
        >
          <div className="w-full max-w-[760px] rounded-[22px] bg-white p-[22px] shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-extrabold text-slate-900">
                  {visitedDetailsModal.name} – Visit Details
                </h2>
                <p className="text-sm text-slate-500">
                  {formatQueueDateShort(
                    appointmentDatePart(visitedDetailsModal.appointmentStartRaw),
                  )}{' '}
                  · {formatAppointmentTime(visitedDetailsModal.appointmentStartRaw)}
                </p>
              </div>
              <button
                onClick={() => setVisitedDetailsModal(null)}
                className="rounded-[11px] border border-slate-200 bg-slate-50 px-3 py-[7px] text-xs font-extrabold text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-[14px] py-3">
                <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                  Patient
                </span>
                <p className="text-sm font-bold text-slate-900">
                  {visitedDetailsModal.name}
                  {demographicLabel(visitedDetailsModal)
                    ? ` · ${demographicLabel(visitedDetailsModal)}`
                    : ''}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {visitedDetailsModal.phone || 'No phone recorded'}
                </p>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-[14px] py-3">
                <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                  Doctor / Service
                </span>
                <p className="text-sm font-bold text-slate-900">{visitedDetailsModal.doctorName}</p>
                <p className="mt-0.5 text-xs text-slate-500">{visitedDetailsModal.serviceName}</p>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-[14px] py-3">
                <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                  Reason
                </span>
                <p className="text-sm text-slate-900">
                  {visitedDetailsModal.visitReason ?? visitedDetailsModal.reason}
                </p>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-[14px] py-3">
                <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                  Examination Notes
                </span>
                <p className="text-sm text-slate-900">
                  {formatClinicalField(visitedDetailsModal.visitExaminationNotes)}
                </p>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-[14px] py-3">
                <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                  Diagnosis
                </span>
                <p className="text-sm text-slate-900">
                  {formatClinicalField(visitedDetailsModal.visitDiagnosis)}
                </p>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-[14px] py-3">
                <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                  Advice
                </span>
                <p className="text-sm text-slate-900">
                  {formatClinicalField(visitedDetailsModal.visitAdvice)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-20 max-w-[340px] rounded-[14px] bg-slate-900 px-4 py-3 text-[13px] font-bold text-white shadow-xl">
          {toast}
        </div>
      )}
    </>
  );
}

/* ─── Sub-components ─── */

type PatientGroupProps = {
  title: string;
  icon: string;
  color: string;
  patients: QueuePatient[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStart: (id: string) => void;
  onSkip: (id: string) => void;
};

function PatientGroup({
  title,
  icon,
  color,
  patients,
  selectedId,
  onSelect,
  onStart,
  onSkip,
}: PatientGroupProps) {
  return (
    <div className="mb-[18px]">
      <div className="mb-[10px] flex items-center gap-2 text-sm font-extrabold text-slate-900">
        <span className={color}>{icon}</span> {title} ({patients.length})
      </div>
      <div className="flex flex-col gap-[10px]">
        {patients.map((patient) => (
          <PatientCard
            key={patient.id}
            patient={patient}
            selected={selectedId === patient.id}
            onSelect={onSelect}
            onStart={onStart}
            onSkip={onSkip}
          />
        ))}
      </div>
    </div>
  );
}

type PatientCardProps = {
  patient: QueuePatient;
  selected: boolean;
  onSelect: (id: string) => void;
  onStart: (id: string) => void;
  onSkip: (id: string) => void;
};

function PatientCard({ patient, selected, onSelect, onStart, onSkip }: PatientCardProps) {
  return (
    <article
      className={`cursor-pointer rounded-[18px] border p-[14px] transition-all ${
        selected
          ? 'border-teal-700 bg-green-50 shadow-[inset_3px_0_0_#0f766e]'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
      onClick={() => onSelect(patient.id)}
    >
      <div className="flex items-start justify-between gap-[10px]">
        <div className="min-w-0 flex-1">
          <div className="mb-[3px] flex items-center gap-[7px]">
            <span className="text-[15px] font-extrabold text-slate-900">{patient.name}</span>
            {demographicLabel(patient) ? (
              <span className="text-xs text-slate-400">{demographicLabel(patient)}</span>
            ) : null}
          </div>
          <p className="mb-1.5 text-[13px] leading-snug text-slate-500">{patient.reason}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>◷ {patient.time}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className={`inline-block whitespace-nowrap rounded-full border px-[10px] py-1 text-[11px] font-extrabold ${statusChipClass(patient.status)}`}
          >
            {statusLabel(patient.status)}
          </span>
          {patient.status === 'visited' && <span className="text-green-600">✓</span>}
        </div>
      </div>

      {/* Actions for non-in-progress */}
      {patient.status !== 'in-progress' && patient.status !== 'visited' && (
        <div className="mt-[10px] flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onStart(patient.id)}
            className="rounded-[11px] border border-blue-200 bg-blue-50 px-[11px] py-[7px] text-xs font-extrabold text-blue-700 hover:bg-blue-100"
          >
            › Start Consultation
          </button>
          {patient.status === 'waiting' && (
            <button
              onClick={() => onSkip(patient.id)}
              className="rounded-[11px] border border-amber-200 bg-amber-50 px-[11px] py-[7px] text-xs font-extrabold text-amber-700 hover:bg-amber-100"
            >
              Skip
            </button>
          )}
        </div>
      )}

      {/* In-progress note */}
      {patient.status === 'in-progress' && (
        <p className="mt-2 text-xs font-bold text-teal-700">
          ⚠ Consultation in progress — see panel
        </p>
      )}

      {/* Visited diagnosis */}
      {patient.status === 'visited' && patient.diagnosis && (
        <div className="mt-2 rounded-[10px] border border-green-200 bg-green-50 px-[10px] py-[7px] text-xs">
          <b className="text-green-700">Dx:</b> {patient.diagnosis}
        </div>
      )}
    </article>
  );
}

type ConsultationPanelProps = {
  patient: QueuePatient;
  onSaveDraft: (id: string) => void;
  onMarkVisited: (id: string) => void;
  isMarkingVisited: boolean;
  onShowHistory: (entry: PatientVisitHistory) => void;
};

function ConsultationPanel({
  patient,
  onSaveDraft,
  onMarkVisited,
  isMarkingVisited,
  onShowHistory,
}: ConsultationPanelProps) {
  return (
    <aside className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-lg">
      {/* Header */}
      <div className="bg-gradient-to-br from-teal-700 to-slate-900 px-[22px] py-[18px] text-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-teal-200">
              Current Consultation
            </p>
            <p className="text-xl font-black">{patient.name}</p>
            <p className="mt-1 text-[13px] text-teal-100">
              {[demographicLabel(patient), patient.phone].filter(Boolean).join(' · ') ||
                'Patient details not recorded'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[22px] font-black">{patient.time}</p>
          </div>
        </div>
        <div className="mt-3 rounded-xl border border-white/[0.15] bg-white/[0.1] px-3 py-2 text-[13px]">
          <b className="text-teal-200">Chief Complaint:</b> {patient.reason}
        </div>
      </div>

      {/* Body */}
      <div className="portal-panel-grid gap-[18px] p-5">
        {/* Visit History */}
        <div>
          <div className="mb-[10px] flex items-center gap-2 text-sm font-extrabold text-slate-900">
            <span className="text-teal-700">↺</span> Visit History
          </div>
          {patient.history.length > 0 ? (
            <div className="flex flex-col gap-[14px] border-l-[3px] border-slate-200 pl-[14px]">
              {patient.history.map((h, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="relative w-full text-left hover:underline"
                  onClick={() => onShowHistory(h)}
                >
                  <span className="absolute -left-[21px] top-[3px] h-[11px] w-[11px] rounded-full bg-teal-700 shadow-[0_0_0_4px_#ccfbf1]" />
                  <p className="text-[13px] font-bold text-slate-900">{h.date}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{h.reason}</p>
                  <p className="mt-0.5 text-xs font-bold text-teal-700">Dx: {h.diagnosis}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">by {h.doctor}</p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              {patient.hasHistory
                ? 'Clinical history is available in Patient History.'
                : 'No clinical history recorded.'}
            </p>
          )}
        </div>

        {/* Examination Notes */}
        <div>
          <div className="mb-[10px] flex items-center gap-2 text-sm font-extrabold text-slate-900">
            <span className="text-teal-700">⚕</span> Examination Notes
          </div>
          <div className="mb-3">
            <label
              htmlFor="noteField"
              className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500"
            >
              Findings / Notes
            </label>
            <textarea
              id="noteField"
              className="w-full rounded-[13px] border-[1.5px] border-slate-200 bg-white px-[13px] py-[10px] text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
              rows={3}
              placeholder="Enter examination findings, observations..."
              defaultValue={patient.visitNote ?? ''}
            />
          </div>
          <div className="mb-3">
            <label
              htmlFor="diagnosisField"
              className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500"
            >
              Diagnosis
            </label>
            <input
              id="diagnosisField"
              type="text"
              className="w-full rounded-[13px] border-[1.5px] border-slate-200 bg-white px-[13px] py-[10px] text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
              placeholder="e.g. Osteoarthritis Grade II – Left Knee"
              defaultValue={patient.diagnosis ?? ''}
            />
          </div>
          <div className="mb-3">
            <label
              htmlFor="adviceField"
              className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500"
            >
              Advice
            </label>
            <textarea
              id="adviceField"
              className="w-full rounded-[13px] border-[1.5px] border-slate-200 bg-white px-[13px] py-[10px] text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
              rows={3}
              placeholder="Advice, medicines, dosage, follow-up instructions..."
              defaultValue={patient.advice ?? ''}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onSaveDraft(patient.id)}
              className="rounded-[11px] border border-slate-200 bg-slate-50 px-[11px] py-[7px] text-xs font-extrabold text-slate-600 hover:bg-slate-100"
            >
              ☷ Save Draft
            </button>
            <button
              onClick={() => onMarkVisited(patient.id)}
              disabled={isMarkingVisited}
              className="flex-1 rounded-[13px] bg-teal-700 px-4 py-[10px] text-[13px] font-extrabold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isMarkingVisited ? 'Saving...' : '✓ Mark as Visited'}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
