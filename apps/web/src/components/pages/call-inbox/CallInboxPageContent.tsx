'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import { ApiRequestError } from '@/lib/api/client';
import { fetchCallInbox, type CallInboxApiRow } from '@/lib/api/clinic-clinical';

import type { Call, CallAction, CallFilters, CallOutcome } from './types';

const OUTCOME_OPTIONS: ReadonlyArray<{ value: CallOutcome; label: string }> = [
  { value: 'appointment_booked', label: 'Appointment booked' },
  { value: 'appointment_cancelled', label: 'Cancelled Appointment' },
  { value: 'appointment_rescheduled', label: 'Appointment Rescheduled' },
  { value: 'general_inquiry', label: 'General inquiry' },
  { value: 'callback_requested', label: 'Callback requested' },
  { value: 'emergency', label: 'Emergency' },
];

function mapOutcome(value: string | null): CallOutcome | null {
  const known: CallOutcome[] = [
    'appointment_booked',
    'appointment_cancelled',
    'appointment_rescheduled',
    'callback_requested',
    'emergency',
    'general_inquiry',
  ];
  if (value && known.includes(value as CallOutcome)) {
    return value as CallOutcome;
  }
  return null;
}

function matchesFilters(call: Call, filters: CallFilters): boolean {
  if (filters.outcomes.length > 0 && !filters.outcomes.includes(call.outcome)) return false;
  return true;
}

function mapAction(outcome: CallOutcome): CallAction {
  switch (outcome) {
    case 'appointment_booked':
      return 'confirmation_needed';
    case 'callback_requested':
      return 'callback_needed';
    case 'emergency':
      return 'emergency_response';
    default:
      return 'none';
  }
}

export function CallInboxPageContent() {
  const { effectiveRole } = useAuth();
  const clinicId = useActiveClinicId();
  const isAdmin = effectiveRole === 'admin';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [filters, setFilters] = useState<CallFilters>({ outcomes: [] });
  const [outcomeMenuOpen, setOutcomeMenuOpen] = useState(false);
  const outcomeMenuRef = useRef<HTMLDivElement>(null);
  const outcomeTriggerRef = useRef<HTMLButtonElement>(null);
  const requestSequence = useRef(0);
  const loadedClinicRef = useRef<string | null>(null);

  const mapCallRows = (rows: unknown): Call[] => {
    if (!Array.isArray(rows)) {
      return [];
    }

    return rows
      .filter((row): row is CallInboxApiRow => Boolean(row && typeof row === 'object' && 'id' in row))
      .flatMap((row) => {
        const outcome = mapOutcome(row.outcome);
        if (!outcome) return [];
        const call: Call = {
          id: row.id,
          callTime: row.occurred_at ?? row.started_at ?? new Date().toISOString(),
          callerPhone: row.patient_phone ?? 'Unknown',
          duration: row.duration_seconds ?? 0,
          summary: row.summary ?? '',
          outcome,
          actionNeeded: row.action_needed ?? mapAction(outcome),
          source: 'voice_bot',
        };
        if (row.source_status) {
          call.sourceStatus = row.source_status;
        }
        if (row.patient_name) {
          call.patientName = row.patient_name;
        }
        if (row.recording_url) {
          call.recordingUrl = row.recording_url;
        }
        if (row.recording_expires_at) {
          call.recordingExpiresAt = row.recording_expires_at;
        }
        if (row.transcript_expires_at) {
          call.transcriptExpiresAt = row.transcript_expires_at;
        }
        if (row.created_appointment_request_id) {
          call.linkedAppointmentId = row.created_appointment_request_id;
        }
        if (row.created_callback_request_id) {
          call.linkedCallbackId = row.created_callback_request_id;
        }
        if (row.created_emergency_incident_id) {
          call.linkedEmergencyId = row.created_emergency_incident_id;
        }
        return [call];
      });
  };

  const loadCalls = useCallback(async () => {
    const requestId = ++requestSequence.current;
    if (!isAdmin || !clinicId) {
      setCalls([]);
      setSelectedCall(null);
      setError(null);
      setOutcomeMenuOpen(false);
      loadedClinicRef.current = null;
      setLoading(false);
      return;
    }
    if (loadedClinicRef.current !== clinicId) {
      setCalls([]);
      setSelectedCall(null);
      setLoading(true);
    }
    setError(null);
    try {
      const rows = await fetchCallInbox(clinicId, filters.outcomes);
      if (requestId !== requestSequence.current) return;
      const mapped = mapCallRows(rows);
      loadedClinicRef.current = clinicId;
      setCalls(mapped);
      setSelectedCall((current) =>
        current ? (mapped.find((call) => call.id === current.id) ?? null) : null,
      );
    } catch (err) {
      if (requestId !== requestSequence.current) return;
      setError(
        err instanceof ApiRequestError
          ? err.apiError.message
          : err instanceof Error
            ? err.message
            : 'Failed to load calls.',
      );
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
      }
    }
  }, [isAdmin, clinicId, filters.outcomes]);

  useEffect(() => {
    void loadCalls();
  }, [loadCalls]);

  useEffect(() => {
    if (selectedCall && !matchesFilters(selectedCall, filters)) {
      setSelectedCall(null);
    }
  }, [filters, selectedCall]);

  useEffect(() => {
    if (!outcomeMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!outcomeMenuRef.current?.contains(event.target as Node)) {
        setOutcomeMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOutcomeMenuOpen(false);
        outcomeTriggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [outcomeMenuOpen]);

  if (!isAdmin) {
    return (
      <>
        <PageHeader
          title="Call inbox"
          description="Review call outcomes and required actions."
        />
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Access denied. Call inbox is admin-only.</p>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <PageHeader
          title="Call inbox"
          description="Review call outcomes and required actions."
        />
        <LoadingState title="Loading calls" description="Fetching call inbox from the API." />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader
          title="Call inbox"
          description="Review call outcomes and required actions."
        />
        <ErrorState title="Could not load calls" description={error}>
          <button
            type="button"
            onClick={() => void loadCalls()}
            className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white"
          >
            Retry
          </button>
        </ErrorState>
      </>
    );
  }

  const getOutcomeBadge = (outcome: string, sourceStatus?: string) => {
    switch (outcome) {
      case 'appointment_booked':
        return <span className="rounded-full border-2 border-green-300 bg-green-50 px-3 py-1 text-xs font-bold text-green-700">Booked</span>;
      case 'appointment_cancelled':
        return <span className="rounded-full border-2 border-rose-300 bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700">{sourceStatus === 'pending' ? 'Cancellation requested' : 'Cancelled'}</span>;
      case 'appointment_rescheduled':
        return <span className="rounded-full border-2 border-violet-300 bg-violet-50 px-3 py-1 text-xs font-bold text-violet-700">{sourceStatus === 'pending' ? 'Reschedule requested' : 'Rescheduled'}</span>;
      case 'callback_requested':
        return <span className="rounded-full border-2 border-amber-300 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">Callback</span>;
      case 'emergency':
        return <span className="rounded-full border-2 border-red-300 bg-red-50 px-3 py-1 text-xs font-bold text-red-700">Emergency</span>;
      case 'general_inquiry':
        return <span className="rounded-full border-2 border-blue-300 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">Inquiry</span>;
      default:
        return <span className="rounded-full border-2 border-slate-300 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-700">{outcome}</span>;
    }
  };

  const getActionBadge = (action: string) => {
    if (action === 'none') return null;
    switch (action) {
      case 'confirmation_needed':
        return <span className="rounded-full border-2 border-amber-300 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">Confirm</span>;
      case 'appointment_action_needed':
        return <span className="rounded-full border-2 border-amber-300 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">Review</span>;
      case 'callback_needed':
        return <span className="rounded-full border-2 border-amber-300 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">Callback</span>;
      case 'emergency_response':
        return <span className="rounded-full border-2 border-red-300 bg-red-50 px-3 py-1 text-xs font-bold text-red-700">Emergency</span>;
      default:
        return <span className="rounded-full border-2 border-slate-300 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-700">{action}</span>;
    }
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const filteredCalls = calls.filter((call) => matchesFilters(call, filters));
  const outcomeTriggerLabel =
    filters.outcomes.length === 0
      ? 'All outcomes'
      : filters.outcomes.length === 1
        ? OUTCOME_OPTIONS.find((option) => option.value === filters.outcomes[0])?.label ??
          '1 outcome selected'
        : `${filters.outcomes.length} outcomes selected`;

  const toggleOutcome = (outcome: CallOutcome) => {
    setFilters((current) => ({
      ...current,
      outcomes: current.outcomes.includes(outcome)
        ? current.outcomes.filter((value) => value !== outcome)
        : [...current.outcomes, outcome],
    }));
  };

  return (
    <>
      <PageHeader
        title="Call inbox"
        description="Review call outcomes and required actions."
      />

      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-3">
          <div ref={outcomeMenuRef} className="relative">
            <button
              ref={outcomeTriggerRef}
              type="button"
              aria-haspopup="dialog"
              aria-controls="call-inbox-outcome-menu"
              aria-expanded={outcomeMenuOpen}
              onClick={() => setOutcomeMenuOpen((open) => !open)}
              className="flex min-w-48 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
            >
              <span>{outcomeTriggerLabel}</span>
              <span aria-hidden="true" className="text-slate-500">⌄</span>
            </button>

            {outcomeMenuOpen && (
              <div
                id="call-inbox-outcome-menu"
                role="dialog"
                aria-label="Filter by outcomes"
                className="absolute left-0 top-full z-30 mt-2 min-w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl"
              >
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={filters.outcomes.length === 0}
                    onChange={() => setFilters((current) => ({ ...current, outcomes: [] }))}
                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                  />
                  <span className="text-sm font-semibold text-slate-900">All outcomes</span>
                </label>
                <div className="my-1 border-t border-slate-100" />
                {OUTCOME_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={filters.outcomes.includes(option.value)}
                      onChange={() => toggleOutcome(option.value)}
                      className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                    />
                    <span className="text-sm font-medium text-slate-800">{option.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-lg font-bold text-slate-900">Call list</h3>
          
          {filteredCalls.length === 0 ? (
            <p className="text-sm text-slate-500">No calls match the current filters</p>
          ) : (
            <div className="space-y-2">
              {filteredCalls.map((call) => (
                <div
                  key={call.id}
                  onClick={() => setSelectedCall(call)}
                  className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                    selectedCall?.id === call.id
                      ? 'border-teal-500 bg-teal-50'
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="mb-1 flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-900">{formatTime(call.callTime)}</span>
                        <span className="text-xs text-slate-500">{formatDate(call.callTime)}</span>
                        <span className="text-xs text-slate-500">{formatDuration(call.duration)}</span>
                      </div>
                      <p className="text-sm text-slate-600">{call.callerPhone}</p>
                      {call.patientName && (
                        <p className="text-sm font-semibold text-slate-900">{call.patientName}</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      {getOutcomeBadge(call.outcome, call.sourceStatus)}
                      {getActionBadge(call.actionNeeded)}
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">{call.summary}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedCall && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-4 text-lg font-bold text-slate-900">Call details</h3>
            
            <div className="space-y-4">
              <div>
                <h4 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-500">Patient information</h4>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-900">{selectedCall.patientName || 'Unknown'}</p>
                  <p className="text-sm text-slate-600">{selectedCall.callerPhone}</p>
                </div>
              </div>

              <div>
                <h4 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-500">Summary</h4>
                <p className="text-sm text-slate-700">{selectedCall.summary}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <h4 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-500">Outcome</h4>
                  {getOutcomeBadge(selectedCall.outcome, selectedCall.sourceStatus)}
                </div>
                <div>
                  <h4 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-500">Action needed</h4>
                  {getActionBadge(selectedCall.actionNeeded) || <span className="text-sm text-slate-500">None</span>}
                </div>
              </div>

              {selectedCall.linkedAppointmentId && (
                <div>
                  <h4 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-500">Linked appointment</h4>
                  <p className="text-sm text-slate-700">{selectedCall.linkedAppointmentId}</p>
                </div>
              )}

              {selectedCall.linkedCallbackId && (
                <div>
                  <h4 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-500">Linked callback</h4>
                  <p className="text-sm text-slate-700">{selectedCall.linkedCallbackId}</p>
                </div>
              )}

              {selectedCall.linkedEmergencyId && (
                <div>
                  <h4 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-500">Linked emergency</h4>
                  <p className="text-sm text-slate-700">{selectedCall.linkedEmergencyId}</p>
                </div>
              )}

              {selectedCall.intent && (
                <div>
                  <h4 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-500">Intent/Source</h4>
                  <p className="text-sm text-slate-700">{selectedCall.intent} · {selectedCall.source}</p>
                </div>
              )}

            </div>
          </div>
        )}
      </div>
    </>
  );
}
