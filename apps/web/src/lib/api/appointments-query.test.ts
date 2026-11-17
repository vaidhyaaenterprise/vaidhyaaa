import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet } from './client';
import { fetchAppointments } from './appointments';

vi.mock('./client', () => ({ apiGet: vi.fn(), apiPatch: vi.fn(), apiPost: vi.fn() }));
beforeEach(() => vi.mocked(apiGet).mockReset().mockResolvedValue({ appointments: [] }));

describe('appointments date query', () => {
  it('adds the selected calendar date while retaining status filters and cancellation', async () => {
    const signal = new AbortController().signal;
    await fetchAppointments('clinic-1', ['confirmed', 'visited'], signal, '2026-11-16');
    expect(apiGet).toHaveBeenCalledWith(
      '/v1/clinics/clinic-1/appointments?status=confirmed,visited&date=2026-11-16',
      signal,
    );
  });
  it('supports a date without status and preserves the existing undated request', async () => {
    await fetchAppointments('clinic-1', undefined, undefined, '2026-11-17');
    await fetchAppointments('clinic-1', ['confirmed']);
    expect(vi.mocked(apiGet).mock.calls).toEqual([
      ['/v1/clinics/clinic-1/appointments?date=2026-11-17', undefined],
      ['/v1/clinics/clinic-1/appointments?status=confirmed', undefined],
    ]);
  });
});
