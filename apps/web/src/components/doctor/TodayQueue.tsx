'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import {
  fetchAppointments,
  markAppointmentVisited,
  type AppointmentApiRow,
} from '@/lib/api/appointments';
import { ApiRequestError } from '@/lib/api/client';
import { INITIAL_PATIENTS, type Patient, type PatientVisitHistory } from './doctor-data';
import { useDoctorNav } from './DoctorLayout';

function statusLabel(status: Patient['status']): string {
  return { waiting: 'Waiting', 'in-progress': 'In Progress', visited: 'Visited', skipped: 'Skipped' }[status];
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

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
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

function localDateString(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateInput(value: string): Date | null {
  const [yearRaw, monthRaw, dayRaw] = value.split('-');
  if (!yearRaw || !monthRaw || !dayRaw) {
    return null;
  }

  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  const day = Number.parseInt(dayRaw, 10);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return null;
  }

  return new Date(year, month - 1, day);
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
  });
}

const seedByName = new Map(INITIAL_PATIENTS.map((patient) => [patient.name.toLowerCase(), patient]));
const seedByPhone = new Map(
  INITIAL_PATIENTS.map((patient) => [normalizePhone(patient.phone), patient]),
);

type QueuePatient = Patient & {
  appointmentStartRaw: string;
  doctorName: string;
  serviceName: string;
  visitReason?: string | null;
  visitExaminationNotes?: string | null;
  visitDiagnosis?: string | null;
  visitAdvice?: string | null;
};

function seedForAppointment(row: AppointmentApiRow): Patient | undefined {
  const byPhone = row.patient_phone ? seedByPhone.get(normalizePhone(row.patient_phone)) : undefined;
  if (byPhone) {
    return byPhone;
  }
  return seedByName.get(row.patient_name.toLowerCase());
}

function mapAppointmentToQueuePatient(row: AppointmentApiRow): QueuePatient {
  const seed = seedForAppointment(row);
  const diagnosis = row.diagnosis ?? seed?.diagnosis;
  const advice = row.advice ?? seed?.advice;
  const visitNote = row.examination_notes ?? seed?.visitNote;

  return {
    id: row.id,
    name: row.patient_name,
    age: seed?.age ?? 0,
    gender: seed?.gender ?? 'Male',
    phone: row.patient_phone ?? seed?.phone ?? '',
    time: formatAppointmentTime(row.appointment_start),
    type: 'in-person',
    status: row.status === 'visited' ? 'visited' : 'waiting',
    reason: row.reason_for_visit,
    ...(diagnosis ? { diagnosis } : {}),
    ...(advice ? { advice } : {}),
    ...(visitNote ? { visitNote } : {}),
    ...(seed?.roomNumber ? { roomNumber: seed.roomNumber } : {}),
    history: seed?.history ?? [],
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
  const clinicId = useActiveClinicId();
  const [selectedDate, setSelectedDate] = useState<string>(() => localDateString(new Date()));
  const [patients, setPatients] = useState<QueuePatient[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [markingVisitedId, setMarkingVisitedId] = useState<string | null>(null);
  const [historyModal, setHistoryModal] = useState<{ patient: QueuePatient; entry: PatientVisitHistory } | null>(null);
  const [visitedDetailsModal, setVisitedDetailsModal] = useState<QueuePatient | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const todayDate = localDateString(new Date());
  const isViewingToday = selectedDate === todayDate;
  const selectedDateLabel = formatQueueDate(selectedDate);
  const selectedDateLabelShort = formatQueueDateShort(selectedDate);

  const loadQueue = useCallback(async () => {
    if (!clinicId) {
      setPatients([]);
      setLoadingQueue(false);
      setQueueError('Clinic context missing. Please re-login.');
      return;
    }

    setLoadingQueue(true);
    setQueueError(null);

    try {
      const rows = await fetchAppointments(clinicId, ['confirmed', 'visited']);
      const dateRows = rows
        .filter((row) => appointmentDatePart(row.appointment_start) === selectedDate)
        .sort((left, right) => left.appointment_start.localeCompare(right.appointment_start));
      const mapped = dateRows.map(mapAppointmentToQueuePatient);

      setPatients((previous) => {
        const previousStatus = new Map(previous.map((patient) => [patient.id, patient.status]));
        return mapped.map((patient) => {
          const lastStatus = previousStatus.get(patient.id);
          if (patient.status === 'waiting' && (lastStatus === 'in-progress' || lastStatus === 'skipped')) {
            return { ...patient, status: lastStatus };
          }
          return patient;
        });
      });

      setSelectedId((current) => {
        if (!current) {
          return null;
        }
        return mapped.some((patient) => patient.id === current && patient.status !== 'visited')
          ? current
          : null;
      });
    } catch (error) {
      setQueueError(
        error instanceof ApiRequestError
          ? error.apiError.message
          : error instanceof Error
            ? error.message
            : 'Failed to load today queue.',
      );
    } finally {
      setLoadingQueue(false);
    }
  }, [clinicId, selectedDate]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    setPatientCount(patients.length);
  }, [patients.length, setPatientCount]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const selectPatient = useCallback((id: string) => {
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
  }, [patients]);

  const startConsultation = useCallback((id: string) => {
    setPatients(prev =>
      prev.map(p => {
        if (p.id === id) return { ...p, status: 'in-progress' as const };
        if (p.status === 'in-progress') return { ...p, status: 'waiting' as const };
        return p;
      }),
    );
    setSelectedId(id);
    showToast('Consultation started.');
  }, [showToast]);

  const skipPatient = useCallback((id: string) => {
    setPatients(prev => prev.map(p => (p.id === id ? { ...p, status: 'skipped' as const } : p)));
    if (selectedId === id) setSelectedId(null);
    showToast('Patient skipped.');
  }, [selectedId, showToast]);

  const saveDraft = useCallback((id: string) => {
    const noteEl = document.getElementById('noteField') as HTMLTextAreaElement | null;
    const diagEl = document.getElementById('diagnosisField') as HTMLInputElement | null;
    const adviceEl = document.getElementById('adviceField') as HTMLTextAreaElement | null;
    setPatients(prev =>
      prev.map(p =>
        p.id === id
          ? { ...p, visitNote: noteEl?.value ?? '', diagnosis: diagEl?.value ?? '', advice: adviceEl?.value ?? '' }
          : p,
      ),
    );
    showToast('Draft saved.');
  }, [showToast]);

  const markVisited = useCallback(async (id: string) => {
    if (!clinicId) {
      showToast('Clinic context missing. Please re-login.');
      return;
    }

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
      await markAppointmentVisited(clinicId, id, {
        visit_reason: visitReason,
        ...(examinationNotes ? { examination_notes: examinationNotes } : {}),
        ...(diagnosis ? { diagnosis } : {}),
        ...(advice ? { advice } : {}),
      });
      setSelectedId(null);
      await loadQueue();
      showToast('Marked as visited.');
    } catch (error) {
      showToast(
        error instanceof ApiRequestError
          ? error.apiError.message
          : error instanceof Error
            ? error.message
            : 'Failed to mark as visited.',
      );
    } finally {
      setMarkingVisitedId(null);
    }
  }, [clinicId, loadQueue, patients, showToast]);

  const waiting = patients.filter(p => p.status === 'waiting');
  const inProgress = patients.find(p => p.status === 'in-progress') ?? null;
  const visited = patients.filter(p => p.status === 'visited');
  const skipped = patients.filter(p => p.status === 'skipped');
  const currentConsult = inProgress && selectedId === inProgress.id ? inProgress : null;

  return (
    <>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-black tracking-tight text-slate-900">
            {isViewingToday ? "Today&apos;s Queue" : 'Appointment Queue'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {selectedDateLabel} · Morning shift · 9:00 AM – 1:00 PM
          </p>
          {loadingQueue && <p className="mt-2 text-xs font-semibold text-slate-500">Syncing queue from DB...</p>}
          {queueError && <p className="mt-2 text-xs font-semibold text-red-600">{queueError}</p>}
        </div>

        <div className="rounded-[16px] border border-slate-200 bg-white p-3 shadow-sm">
          <label htmlFor="doctor-queue-date" className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
            Select Date
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              id="doctor-queue-date"
              type="date"
              value={selectedDate}
              onChange={(event) => {
                const nextDate = event.target.value;
                if (!nextDate) {
                  return;
                }
                setSelectedDate(nextDate);
                setSelectedId(null);
                setVisitedDetailsModal(null);
              }}
              className="rounded-[10px] border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
            />
            <button
              type="button"
              onClick={() => {
                setSelectedDate(todayDate);
                setSelectedId(null);
                setVisitedDetailsModal(null);
              }}
              disabled={isViewingToday}
              className="rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-extrabold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Today
            </button>
          </div>
        </div>
      </div>

      {/* Hero */}
      <div className="mb-5 rounded-[22px] bg-gradient-to-br from-teal-700 to-slate-900 p-5">
        <div className="grid items-center gap-[18px] lg:grid-cols-[1.5fr_1fr]">
          <div>
            <h2 className="mb-1.5 text-xl font-black text-white">
              {patients.length} appointments {isViewingToday ? 'today' : `on ${selectedDateLabelShort}`}
            </h2>
            <p className="text-[13px] leading-relaxed text-teal-100">
              {visited.length} completed · {waiting.length} remaining · {inProgress ? '1 in progress' : 'none in progress'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {['Morning 9AM–1PM', 'Evening 5PM–9PM', 'Orthopaedic'].map(tag => (
                <span key={tag} className="rounded-full border border-white/[0.18] bg-white/[0.12] px-[10px] py-1.5 text-xs font-extrabold text-white">
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-[10px]">
            {[
              { value: waiting.length, label: 'Waiting' },
              { value: inProgress ? 1 : 0, label: 'In Progress' },
              { value: visited.length, label: 'Visited' },
              { value: patients.length, label: 'Total' },
            ].map(stat => (
              <div key={stat.label} className="rounded-[14px] border border-white/[0.12] bg-white/[0.08] px-3 py-[10px] text-center">
                <strong className="block text-2xl font-black text-white">{stat.value}</strong>
                <span className="mt-0.5 block text-[11px] font-bold text-teal-200">{stat.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Split: Queue + Consultation Panel */}
      <div className={`grid gap-[18px] ${currentConsult ? 'lg:grid-cols-[1fr_1.3fr]' : 'grid-cols-1'}`}>
        {/* Queue Column */}
        <div>
          {inProgress && (
            <PatientGroup title="In Progress" icon="⚕" color="text-blue-700" patients={[inProgress]} selectedId={selectedId} onSelect={selectPatient} onStart={startConsultation} onSkip={skipPatient} />
          )}
          {waiting.length > 0 && (
            <PatientGroup title="Waiting" icon="◷" color="text-amber-600" patients={waiting} selectedId={selectedId} onSelect={selectPatient} onStart={startConsultation} onSkip={skipPatient} />
          )}
          {visited.length > 0 && (
            <PatientGroup title="Visited" icon="✓" color="text-green-600" patients={visited} selectedId={selectedId} onSelect={selectPatient} onStart={startConsultation} onSkip={skipPatient} />
          )}
          {skipped.length > 0 && (
            <PatientGroup title="Skipped" icon="⚠" color="text-slate-500" patients={skipped} selectedId={selectedId} onSelect={selectPatient} onStart={startConsultation} onSkip={skipPatient} />
          )}
          {patients.length === 0 && (
            <div className="rounded-[22px] border border-slate-200 bg-white p-12 text-center text-slate-400">
              No appointments scheduled for {isViewingToday ? 'today' : selectedDateLabelShort}.
            </div>
          )}
        </div>

        {/* Consultation Panel */}
        {currentConsult && (
          <ConsultationPanel
            patient={currentConsult}
            onSaveDraft={saveDraft}
            onMarkVisited={markVisited}
            isMarkingVisited={markingVisitedId === currentConsult.id}
            onShowHistory={(entry) => setHistoryModal({ patient: currentConsult, entry })}
          />
        )}
      </div>

      {/* History Modal */}
      {historyModal && (
        <div
          className="fixed inset-0 z-10 grid place-items-center bg-slate-900/55 p-5"
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setHistoryModal(null); }}
        >
          <div className="w-full max-w-[620px] rounded-[22px] bg-white p-[22px] shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-extrabold text-slate-900">{historyModal.patient.name} – Previous Visit</h2>
                <p className="text-sm text-slate-500">{historyModal.entry.date}</p>
              </div>
              <button onClick={() => setHistoryModal(null)} className="rounded-[11px] border border-slate-200 bg-slate-50 px-3 py-[7px] text-xs font-extrabold text-slate-600 hover:bg-slate-100">
                Close
              </button>
            </div>
            <div className="grid gap-3">
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-[14px] py-3">
                <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Reason</span>
                <p className="text-sm text-slate-900">{historyModal.entry.reason}</p>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-[14px] py-3">
                <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Diagnosis</span>
                <p className="text-sm text-slate-900">{historyModal.entry.diagnosis}</p>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-[14px] py-3">
                <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Doctor</span>
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
                <h2 className="text-lg font-extrabold text-slate-900">{visitedDetailsModal.name} – Visit Details</h2>
                <p className="text-sm text-slate-500">
                  {formatQueueDateShort(appointmentDatePart(visitedDetailsModal.appointmentStartRaw))} · {formatAppointmentTime(visitedDetailsModal.appointmentStartRaw)}
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
                <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Patient</span>
                <p className="text-sm font-bold text-slate-900">
                  {visitedDetailsModal.name}
                  {visitedDetailsModal.age ? ` · ${visitedDetailsModal.age}y` : ''}
                  {` · ${visitedDetailsModal.gender}`}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{visitedDetailsModal.phone || 'No phone recorded'}</p>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-[14px] py-3">
                <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Doctor / Service</span>
                <p className="text-sm font-bold text-slate-900">{visitedDetailsModal.doctorName}</p>
                <p className="mt-0.5 text-xs text-slate-500">{visitedDetailsModal.serviceName}</p>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-[14px] py-3">
                <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Reason</span>
                <p className="text-sm text-slate-900">{visitedDetailsModal.visitReason ?? visitedDetailsModal.reason}</p>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-[14px] py-3">
                <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Examination Notes</span>
                <p className="text-sm text-slate-900">{formatClinicalField(visitedDetailsModal.visitExaminationNotes)}</p>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-[14px] py-3">
                <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Diagnosis</span>
                <p className="text-sm text-slate-900">{formatClinicalField(visitedDetailsModal.visitDiagnosis)}</p>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-[14px] py-3">
                <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Advice</span>
                <p className="text-sm text-slate-900">{formatClinicalField(visitedDetailsModal.visitAdvice)}</p>
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
  patients: Patient[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStart: (id: string) => void;
  onSkip: (id: string) => void;
};

function PatientGroup({ title, icon, color, patients, selectedId, onSelect, onStart, onSkip }: PatientGroupProps) {
  return (
    <div className="mb-[18px]">
      <div className="mb-[10px] flex items-center gap-2 text-sm font-extrabold text-slate-900">
        <span className={color}>{icon}</span> {title} ({patients.length})
      </div>
      <div className="flex flex-col gap-[10px]">
        {patients.map(patient => (
          <PatientCard key={patient.id} patient={patient} selected={selectedId === patient.id} onSelect={onSelect} onStart={onStart} onSkip={onSkip} />
        ))}
      </div>
    </div>
  );
}

type PatientCardProps = {
  patient: Patient;
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
            <span className="text-xs text-slate-400">{patient.age}y · {patient.gender[0]}</span>
          </div>
          <p className="mb-1.5 text-[13px] leading-snug text-slate-500">{patient.reason}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>◷ {patient.time}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`inline-block whitespace-nowrap rounded-full border px-[10px] py-1 text-[11px] font-extrabold ${statusChipClass(patient.status)}`}>
            {statusLabel(patient.status)}
          </span>
          {patient.status === 'visited' && <span className="text-green-600">✓</span>}
        </div>
      </div>

      {/* Actions for non-in-progress */}
      {patient.status !== 'in-progress' && patient.status !== 'visited' && (
        <div className="mt-[10px] flex flex-wrap gap-2" onClick={e => e.stopPropagation()}>
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
        <p className="mt-2 text-xs font-bold text-teal-700">⚠ Consultation in progress — see panel</p>
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
  patient: Patient;
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
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-teal-200">Current Consultation</p>
            <p className="text-xl font-black">{patient.name}</p>
            <p className="mt-1 text-[13px] text-teal-100">{patient.age} yrs · {patient.gender} · {patient.phone}</p>
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
      <div className="grid gap-[18px] p-5 lg:grid-cols-2">
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
            <p className="text-xs text-slate-400">No previous visits on record.</p>
          )}
        </div>

        {/* Examination Notes */}
        <div>
          <div className="mb-[10px] flex items-center gap-2 text-sm font-extrabold text-slate-900">
            <span className="text-teal-700">⚕</span> Examination Notes
          </div>
          <div className="mb-3">
            <label htmlFor="noteField" className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
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
            <label htmlFor="diagnosisField" className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
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
            <label htmlFor="adviceField" className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
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
