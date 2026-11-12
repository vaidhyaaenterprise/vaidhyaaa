'use client';

import { useEffect, useState } from 'react';
import {
  fetchSlotUpdateStatus,
  retrySlotUpdates,
  type SlotUpdateStatus as UpdateStatus,
} from '@/lib/api/slot-updates';
import { isAbortError } from '@/lib/api/client';

export function SlotUpdateStatus({
  clinicId,
  doctorId,
  canRetry,
  refreshKey,
}: {
  clinicId: string;
  doctorId: string;
  canRetry: boolean;
  refreshKey: number;
}) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [check, setCheck] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setStatus(null);
    setError(false);
    const poll = async () => {
      try {
        const result = await fetchSlotUpdateStatus(clinicId, doctorId, controller.signal);
        if (controller.signal.aborted) return;
        setStatus(result);
        setError(false);
        if (result.state === 'updating') timer = setTimeout(() => void poll(), 5_000);
      } catch (reason) {
        if (!controller.signal.aborted && !isAbortError(reason)) setError(true);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [clinicId, doctorId, refreshKey, check]);

  const retry = async () => {
    setRetrying(true);
    try {
      await retrySlotUpdates(clinicId);
      setCheck((value) => value + 1);
    } catch {
      setError(true);
    } finally {
      setRetrying(false);
    }
  };

  if (!error && status?.state === 'ready' && (refreshKey > 0 || check > 0)) {
    return (
      <p
        role="status"
        className="mb-4 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800"
      >
        Appointment slots are up to date.
      </p>
    );
  }
  if (!error && (!status || status.state === 'ready')) return null;
  const failed = status?.state === 'failed';
  return (
    <div
      role={failed ? 'alert' : 'status'}
      className={`mb-4 rounded-xl border p-3 text-sm ${failed ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
    >
      <p>
        {error
          ? 'Unable to check the slot update status. Your saved rules have not been changed.'
          : failed
            ? 'Your rules are saved, but appointment slots could not be updated. Retry the slot update.'
            : 'Your rules are saved. Appointment slots are updating in the background.'}
      </p>
      {status && canRetry && (
        <button
          type="button"
          disabled={retrying}
          onClick={() => void retry()}
          className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-2 font-semibold disabled:opacity-50"
        >
          {retrying ? 'Retrying…' : 'Retry slot update'}
        </button>
      )}
      {error && (
        <button
          type="button"
          onClick={() => setCheck((value) => value + 1)}
          className="mt-2 rounded-lg border bg-white px-3 py-2 font-semibold"
        >
          Check again
        </button>
      )}
    </div>
  );
}
