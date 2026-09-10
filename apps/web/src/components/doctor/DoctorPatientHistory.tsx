'use client';

import { useEffect, useMemo, useState } from 'react';

import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import {
  type PatientHistoryApiRow,
  type PatientHistoryItemApiRow,
  searchPatientHistory,
} from '@/lib/api/clinic-clinical';

type HistoryFilter = {
  phone: string;
  name: string;
  age: string;
};

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatClinicalField(value?: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'Not recorded';
}

function hasClinicalDetails(row: PatientHistoryItemApiRow): boolean {
  return Boolean(row.examination_notes?.trim() || row.diagnosis?.trim() || row.advice?.trim());
}

function latestVisitedAt(history: PatientHistoryItemApiRow[]): string | null {
  const latestVisit = history.find((row) => row.kind === 'visit');
  return latestVisit ? formatDateTime(latestVisit.at) : null;
}

export function DoctorPatientHistory() {
  const clinicId = useActiveClinicId();
  const [filter, setFilter] = useState<HistoryFilter>({ phone: '', name: '', age: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [patients, setPatients] = useState<PatientHistoryApiRow[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientHistoryApiRow | null>(null);

  const isSearchDisabled = useMemo(() => {
    return !filter.phone.trim() && !filter.name.trim() && !filter.age.trim();
  }, [filter]);

  useEffect(() => {
    if (!selectedPatient) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedPatient(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedPatient]);

  async function onSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!clinicId) {
      setError('Clinic context is missing. Please sign out and sign in again.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const ageInput = filter.age.trim();
      const age = ageInput ? Number.parseInt(ageInput, 10) : undefined;
      if (ageInput && Number.isNaN(age)) {
        setError('Age must be a valid integer.');
        setPatients([]);
        setHasSearched(true);
        return;
      }

      const rows = await searchPatientHistory(clinicId, {
        ...(filter.phone.trim() ? { phone: filter.phone.trim() } : {}),
        ...(filter.name.trim() ? { name: filter.name.trim() } : {}),
        ...(age !== undefined ? { age } : {}),
      });

      setPatients(rows);
      setSelectedPatient(null);
      setHasSearched(true);
    } catch (err) {
      setPatients([]);
      setSelectedPatient(null);
      setHasSearched(true);
      setError(err instanceof Error ? err.message : 'Unable to fetch patient history.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="mb-5">
        <h1 className="text-[26px] font-black tracking-tight text-slate-900">Patient History</h1>
        <p className="mt-1 text-sm text-slate-500">
          Search by phone number, patient name, or age. Click a patient name bar to open full history.
        </p>
      </div>

      <form
        onSubmit={onSearch}
        className="mb-5 rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="history-phone">
            Phone
            <input
              id="history-phone"
              value={filter.phone}
              onChange={(e) => setFilter((prev) => ({ ...prev, phone: e.target.value }))}
              placeholder="e.g. 9876055810"
              className="mt-1.5 w-full rounded-[12px] border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
            />
          </label>

          <label className="text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="history-name">
            Patient Name
            <input
              id="history-name"
              value={filter.name}
              onChange={(e) => setFilter((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Ramesh"
              className="mt-1.5 w-full rounded-[12px] border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
            />
          </label>

          <label className="text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="history-age">
            Age
            <input
              id="history-age"
              value={filter.age}
              onChange={(e) => setFilter((prev) => ({ ...prev, age: e.target.value }))}
              placeholder="e.g. 38"
              inputMode="numeric"
              className="mt-1.5 w-full rounded-[12px] border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
            />
          </label>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">Enter any one field to search.</p>
          <button
            type="submit"
            disabled={loading || isSearchDisabled}
            className="rounded-[12px] bg-teal-700 px-4 py-2.5 text-sm font-extrabold text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Searching...' : 'Search History'}
          </button>
        </div>
      </form>

      {loading ? (
        <LoadingState title="Searching patient history" description="Fetching records from clinic database." />
      ) : null}

      {!loading && error ? (
        <ErrorState title="Search failed" description={error} />
      ) : null}

      {!loading && !error && hasSearched && patients.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-8 py-12 text-center">
          <p className="text-base font-bold text-slate-900">No patient records found</p>
          <p className="mt-2 text-sm text-slate-500">Try a different phone, name, or age.</p>
        </div>
      ) : null}

      {!loading && !error && patients.length > 0 ? (
        <div className="grid gap-3">
          {patients.map((patient) => {
            const latestVisit = latestVisitedAt(patient.history);

            return (
              <button
                key={patient.id}
                type="button"
                onClick={() => setSelectedPatient(patient)}
                className="w-full rounded-[18px] border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-teal-200 hover:bg-teal-50/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-extrabold text-slate-900">{patient.name}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {patient.phone ?? 'No phone'}
                      {patient.age !== null ? ` · ${patient.age} yrs` : ''}
                      {patient.gender ? ` · ${patient.gender}` : ''}
                    </p>
                    <p className={`mt-1 text-xs font-semibold ${latestVisit ? 'text-teal-700' : 'text-slate-400'}`}>
                      {latestVisit ? `Last visited: ${latestVisit}` : 'No completed visit yet'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">
                      {patient.history.length} records
                    </span>
                    <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-bold text-teal-700">
                      View details
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : null}

      {selectedPatient ? (
        <div
          className="fixed inset-0 z-20 grid place-items-center bg-slate-900/55 p-5"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedPatient(null);
            }
          }}
        >
          <div className="max-h-[88vh] w-full max-w-[1200px] overflow-hidden rounded-[22px] bg-white shadow-2xl">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-xl font-black text-slate-900">{selectedPatient.name}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedPatient.phone ?? 'No phone'}
                  {selectedPatient.age !== null ? ` · ${selectedPatient.age} yrs` : ''}
                  {selectedPatient.gender ? ` · ${selectedPatient.gender}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">
                  {selectedPatient.history.length} records
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedPatient(null)}
                  className="rounded-[11px] border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-extrabold text-slate-600 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="max-h-[70vh] overflow-auto p-5">
              {selectedPatient.history.length === 0 ? (
                <p className="text-sm text-slate-500">No appointments or visits recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className="border-b border-slate-100 px-2 py-2 text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Date</th>
                        <th className="border-b border-slate-100 px-2 py-2 text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Phone</th>
                        <th className="border-b border-slate-100 px-2 py-2 text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Type</th>
                        <th className="border-b border-slate-100 px-2 py-2 text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Doctor</th>
                        <th className="border-b border-slate-100 px-2 py-2 text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Service</th>
                        <th className="border-b border-slate-100 px-2 py-2 text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Reason</th>
                        <th className="border-b border-slate-100 px-2 py-2 text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Examination</th>
                        <th className="border-b border-slate-100 px-2 py-2 text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPatient.history.map((row) => (
                        <tr key={`${row.kind}-${row.id}`} className="even:bg-slate-50">
                          <td className="px-2 py-2 text-sm text-slate-700">{formatDateTime(row.at)}</td>
                          <td className="whitespace-nowrap px-2 py-2 text-sm text-slate-700">
                            {selectedPatient.phone ?? 'No phone'}
                          </td>
                          <td className="px-2 py-2 text-sm font-semibold text-slate-900">
                            {row.kind === 'visit' ? 'Visit' : 'Appointment'}
                          </td>
                          <td className="px-2 py-2 text-sm text-slate-700">{row.doctor_name}</td>
                          <td className="px-2 py-2 text-sm text-slate-700">{row.clinic_service_name}</td>
                          <td className="px-2 py-2 text-sm text-slate-700">{row.reason_for_visit}</td>
                          <td className="px-2 py-2 text-sm text-slate-700">
                            {row.kind === 'visit' || hasClinicalDetails(row) ? (
                              <div className="space-y-1">
                                <p>
                                  <span className="font-semibold text-slate-900">Notes:</span>{' '}
                                  {formatClinicalField(row.examination_notes)}
                                </p>
                                <p>
                                  <span className="font-semibold text-slate-900">Diagnosis:</span>{' '}
                                  {formatClinicalField(row.diagnosis)}
                                </p>
                                <p>
                                  <span className="font-semibold text-slate-900">Advice:</span>{' '}
                                  {formatClinicalField(row.advice)}
                                </p>
                              </div>
                            ) : (
                              <span className="text-xs font-semibold text-slate-400">Captured after visit</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-sm text-slate-700">{row.status ?? 'visited'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
