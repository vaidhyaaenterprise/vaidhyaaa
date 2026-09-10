'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { useIsPlatformAdmin } from '@/hooks/useActiveClinicId';
import { ApiRequestError } from '@/lib/api/client';
import { fetchPlatformJobHealth } from '@/lib/api/clinic-clinical';

import type { JobHealth, JobRunLog } from './types';

type ApiJobRunRow = {
  id: string;
  clinic_id: string | null;
  job_type: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  scheduled_at: string;
  completed_at: string | null;
  created_at: string;
};

function formatElapsed(startedAt: string, finishedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const diff = end - start;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

function countByStatus(health: Array<{ status: string; count: number }>, status: string): number {
  return health.find((row) => row.status === status)?.count ?? 0;
}

function latestRunForType(runs: ApiJobRunRow[], jobType: string): string | null {
  const match = runs.find((row) => row.job_type === jobType);
  return match?.scheduled_at ?? match?.created_at ?? null;
}

function mapRunStatus(status: string): JobRunLog['status'] {
  if (status === 'completed' || status === 'success') {
    return 'completed';
  }
  if (status === 'failed') {
    return 'failed';
  }
  return 'running';
}

function mapRunLog(row: ApiJobRunRow): JobRunLog {
  return {
    id: row.id,
    jobName: row.job_type,
    startedAt: row.scheduled_at || row.created_at,
    finishedAt: row.completed_at,
    status: mapRunStatus(row.status),
    processedCount: row.attempt_count,
    error: row.last_error,
  };
}

function HealthCard({
  label,
  value,
  ok,
}: {
  label: string;
  value: string | number | null;
  ok?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p>
      {value !== null ? (
        <p
          className={`text-lg font-black ${
            ok === false ? 'text-red-600' : ok === true ? 'text-teal-700' : 'text-slate-900'
          }`}
        >
          {value}
        </p>
      ) : (
        <p className="text-lg font-black text-slate-400">Never</p>
      )}
    </div>
  );
}

export function JobHealthDashboard() {
  const isPlatformAdmin = useIsPlatformAdmin();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<JobHealth>({
    queueMode: 'inline',
    redisConnected: false,
    pendingJobs: 0,
    failedJobs: 0,
    lastRunSlotGeneration: null,
    lastRunHoldExpiry: null,
    lastRunRecordingCleanup: null,
    lastRunTranscriptCleanup: null,
  });
  const [runLogs, setRunLogs] = useState<JobRunLog[]>([]);

  const loadHealth = useCallback(async () => {
    if (!isPlatformAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPlatformJobHealth();
      const runs = (data.recent_runs as ApiJobRunRow[]).map(mapRunLog);
      setRunLogs(runs);
      setHealth({
        queueMode: 'inline',
        redisConnected: false,
        pendingJobs: countByStatus(data.health, 'pending') + countByStatus(data.health, 'processing'),
        failedJobs: countByStatus(data.health, 'failed'),
        lastRunSlotGeneration: latestRunForType(data.recent_runs as ApiJobRunRow[], 'GENERATE_SLOTS'),
        lastRunHoldExpiry: latestRunForType(data.recent_runs as ApiJobRunRow[], 'EXPIRE_SLOT_HOLDS'),
        lastRunRecordingCleanup: latestRunForType(
          data.recent_runs as ApiJobRunRow[],
          'CLEANUP_EXPIRED_RECORDINGS',
        ),
        lastRunTranscriptCleanup: latestRunForType(
          data.recent_runs as ApiJobRunRow[],
          'CLEANUP_EXPIRED_TRANSCRIPTS',
        ),
      });
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.apiError.message : 'Failed to load job health.',
      );
    } finally {
      setLoading(false);
    }
  }, [isPlatformAdmin]);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  if (!isPlatformAdmin) {
    return (
      <>
        <PageHeader title="Job health" description="Background job processing status and run history." />
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Access denied. Platform admin only.</p>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Job health" description="Background job processing status and run history." />
        <LoadingState title="Loading job health" description="Fetching from the platform API." />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Job health" description="Background job processing status and run history." />
        <ErrorState title="Could not load job health" description={error}>
          <button
            type="button"
            onClick={() => void loadHealth()}
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
        title="Job health"
        description="Background job processing status and run history."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HealthCard
          label="Queue mode"
          value={health.queueMode === 'bullmq' ? 'BullMQ' : 'Inline'}
          ok
        />
        <HealthCard
          label="Redis connected"
          value={health.redisConnected ? 'Yes' : 'No'}
          ok={health.redisConnected}
        />
        <HealthCard
          label="Pending jobs"
          value={health.pendingJobs}
          ok={health.pendingJobs === 0}
        />
        <HealthCard
          label="Failed jobs"
          value={health.failedJobs}
          ok={health.failedJobs === 0}
        />
      </div>

      <div className="mb-6">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-500">
          Last scheduled run
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <HealthCard
            label="Slot generation"
            value={
              health.lastRunSlotGeneration
                ? formatElapsed(health.lastRunSlotGeneration, null) + ' ago'
                : null
            }
            ok={!!health.lastRunSlotGeneration}
          />
          <HealthCard
            label="Hold expiry"
            value={
              health.lastRunHoldExpiry
                ? formatElapsed(health.lastRunHoldExpiry, null) + ' ago'
                : null
            }
            ok={!!health.lastRunHoldExpiry}
          />
          <HealthCard
            label="Recording cleanup"
            value={
              health.lastRunRecordingCleanup
                ? formatElapsed(health.lastRunRecordingCleanup, null) + ' ago'
                : null
            }
            ok={!!health.lastRunRecordingCleanup}
          />
          <HealthCard
            label="Transcript cleanup"
            value={
              health.lastRunTranscriptCleanup
                ? formatElapsed(health.lastRunTranscriptCleanup, null) + ' ago'
                : null
            }
            ok={!!health.lastRunTranscriptCleanup}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-lg font-bold text-slate-900">Job run history</h3>
          <p className="mt-0.5 text-sm text-slate-500">Recent execution logs for background jobs.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                  Job name
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                  Started at
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                  Duration
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                  Status
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                  Processed
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                  Error
                </th>
              </tr>
            </thead>
            <tbody>
              {runLogs.map((log) => (
                <tr key={log.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-bold text-slate-900">
                    {log.jobName}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-700">
                    {new Date(log.startedAt).toLocaleString('en-IN')}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-700">
                    {formatElapsed(log.startedAt, log.finishedAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {log.status === 'completed' && (
                      <span className="inline-flex items-center rounded-full border border-green-300 bg-green-50 px-2.5 py-0.5 text-xs font-bold text-green-700">
                        Completed
                      </span>
                    )}
                    {log.status === 'running' && (
                      <span className="inline-flex items-center rounded-full border border-blue-300 bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-blue-700">
                        Running
                      </span>
                    )}
                    {log.status === 'failed' && (
                      <span className="inline-flex items-center rounded-full border border-red-300 bg-red-50 px-2.5 py-0.5 text-xs font-bold text-red-700">
                        Failed
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-slate-900">
                    {log.processedCount}
                  </td>
                  <td className="max-w-[240px] truncate px-4 py-3 text-xs text-red-600">
                    {log.error ?? <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
              {runLogs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">
                    No job run logs available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
