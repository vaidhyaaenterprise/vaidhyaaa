'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { useActiveClinicId } from '@/hooks/useActiveClinicId';
import { ApiRequestError } from '@/lib/api/client';
import {
  fetchCallbackRequests,
  fetchCalls,
  type CallApiRow,
} from '@/lib/api/clinic-clinical';

import type { Call, CallAction, CallFilters, CallOutcome } from './types';

function mapOutcome(value: string | null): CallOutcome {
  const known: CallOutcome[] = [
    'appointment_booked',
    'callback_requested',
    'emergency',
    'general_inquiry',
    'no_action_needed',
    'voicemail',
  ];
  if (value && known.includes(value as CallOutcome)) {
    return value as CallOutcome;
  }
  return 'general_inquiry';
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
  const [filters, setFilters] = useState<CallFilters>({ emergencyOnly: false, callbackOnly: false });

  const mapCallRows = (rows: unknown): Call[] => {
    if (!Array.isArray(rows)) {
      return [];
    }

    return rows
      .filter((row): row is CallApiRow => Boolean(row && typeof row === 'object' && 'id' in row))
      .map((row) => {
        const outcome = mapOutcome(row.outcome);
        const call: Call = {
          id: row.id,
          callTime: row.started_at ?? new Date().toISOString(),
          callerPhone: row.patient_phone ?? 'Unknown',
          duration: row.duration_seconds ?? 0,
          summary: row.summary ?? '',
          outcome,
          actionNeeded: mapAction(outcome),
          source: 'voice_bot',
        };
        if (row.patient_name) {
          call.patientName = row.patient_name;
        }
        if (row.recording_url) {
          call.recordingUrl = row.recording_url;
        }
        return call;
      });
  };

  const loadCalls = useCallback(async () => {
    if (!isAdmin || !clinicId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [rows, callbackRequests] = await Promise.all([
        fetchCalls(clinicId),
        fetchCallbackRequests(clinicId).catch(() => []),
      ]);
      const callbackRows: CallApiRow[] = callbackRequests.map((row) => ({
        id: row.id,
        patient_phone: row.patient_phone,
        patient_name: row.patient_name,
        started_at: row.created_at,
        duration_seconds: 0,
        outcome: 'callback_requested',
        summary: row.reason ?? '',
        recording_url: null,
      }));
      const mapped = mapCallRows([...callbackRows, ...rows]);
      setCalls(mapped);
      setSelectedCall((current) =>
        current && mapped.some((call) => call.id === current.id) ? current : null,
      );
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.apiError.message
          : err instanceof Error
            ? err.message
            : 'Failed to load calls.',
      );
    } finally {
      setLoading(false);
    }
  }, [isAdmin, clinicId]);

  useEffect(() => {
    void loadCalls();
  }, [loadCalls]);

  if (!isAdmin) {
    return (
      <>
        <PageHeader
          title="Call inbox"
          description="Review call recordings and transcripts."
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
          description="Review call recordings and transcripts."
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
          description="Review call recordings and transcripts."
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

  const getOutcomeBadge = (outcome: string) => {
    switch (outcome) {
      case 'appointment_booked':
        return <span className="rounded-full border-2 border-green-300 bg-green-50 px-3 py-1 text-xs font-bold text-green-700">Booked</span>;
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

  const isRecordingExpired = (expiresAt?: string) => {
    if (!expiresAt) return true;
    return new Date(expiresAt) < new Date();
  };

  const isTranscriptExpired = (expiresAt?: string) => {
    if (!expiresAt) return true;
    return new Date(expiresAt) < new Date();
  };

  const handlePlayRecording = (call: Call) => {
    if (call.recordingUrl) {
      window.open(call.recordingUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const filteredCalls = calls.filter(call => {
    if (filters.emergencyOnly && call.outcome !== 'emergency') return false;
    if (filters.callbackOnly && call.outcome !== 'callback_requested') return false;
    if (filters.appointmentRequestOnly && call.outcome !== 'appointment_booked') return false;
    if (filters.actionNeeded && call.actionNeeded === 'none') return false;
    if (filters.outcome && call.outcome !== filters.outcome) return false;
    return true;
  });

  return (
    <>
      <PageHeader
        title="Call inbox"
        description="Review call recordings and transcripts."
      />

      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap gap-3">
          <select
            value={filters.outcome || ''}
            onChange={(e) => setFilters({ ...filters, outcome: e.target.value as Call['outcome'] })}
            className="rounded-xl border-1.5 border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/12"
          >
            <option value="">All outcomes</option>
            <option value="appointment_booked">Appointment booked</option>
            <option value="callback_requested">Callback requested</option>
            <option value="emergency">Emergency</option>
            <option value="general_inquiry">General inquiry</option>
          </select>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={filters.emergencyOnly}
              onChange={(e) => setFilters({ ...filters, emergencyOnly: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
            />
            <span className="text-sm font-semibold text-slate-900">Emergency only</span>
          </label>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={filters.callbackOnly}
              onChange={(e) => setFilters({ ...filters, callbackOnly: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
            />
            <span className="text-sm font-semibold text-slate-900">Callback only</span>
          </label>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={filters.appointmentRequestOnly}
              onChange={(e) => setFilters({ ...filters, appointmentRequestOnly: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
            />
            <span className="text-sm font-semibold text-slate-900">Appointment requests only</span>
          </label>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={filters.actionNeeded}
              onChange={(e) => setFilters({ ...filters, actionNeeded: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-600"
            />
            <span className="text-sm font-semibold text-slate-900">Action needed</span>
          </label>
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
                      {getOutcomeBadge(call.outcome)}
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
                  {getOutcomeBadge(selectedCall.outcome)}
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

              <div>
                <h4 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-500">Recording</h4>
                {selectedCall.recordingUrl && !isRecordingExpired(selectedCall.recordingExpiresAt) ? (
                  <div>
                    <p className="mb-2 text-xs text-slate-500">Audio retained for 10 days</p>
                    <button
                      onClick={() => handlePlayRecording(selectedCall)}
                      className="rounded-xl border-2 border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-700 hover:bg-teal-100"
                    >
                      ▶ Play recording
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Recording unavailable (expired or not available)</p>
                )}
              </div>

              <div>
                <h4 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-500">Transcript</h4>
                {selectedCall.transcript && !isTranscriptExpired(selectedCall.transcriptExpiresAt) ? (
                  <div>
                    <p className="mb-2 text-xs text-slate-500">Transcript retained for 30 days</p>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{selectedCall.transcript}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Transcript unavailable (expired or not available)</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
