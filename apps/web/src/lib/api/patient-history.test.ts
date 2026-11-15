import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiGet } from '@/lib/api/client';
import { searchPatientHistory } from './clinic-clinical';

vi.mock('@/lib/api/client', () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiGet).mockResolvedValue({ patients: [] });
});

describe('patient history search API', () => {
  it('sends a date-only query unchanged and forwards cancellation', async () => {
    const signal = new AbortController().signal;
    await expect(searchPatientHistory('clinic-1', { date: '2026-11-12' }, signal)).resolves.toEqual(
      [],
    );
    expect(apiGet).toHaveBeenCalledWith(
      '/v1/clinics/clinic-1/patients/history?date=2026-11-12',
      signal,
    );
  });

  it('combines date and existing filters in the clinic-scoped query', async () => {
    await searchPatientHistory('clinic-1', {
      phone: '9876543210',
      name: 'Rajan Kumar',
      age: 60,
      date: '2027-01-15',
    });
    expect(apiGet).toHaveBeenCalledWith(
      '/v1/clinics/clinic-1/patients/history?phone=9876543210&name=Rajan+Kumar&age=60&date=2027-01-15',
      undefined,
    );
  });

  it.each([undefined, ''])('omits date when it is %s', async (date) => {
    await searchPatientHistory('clinic-1', {
      phone: '9876543210',
      ...(date !== undefined ? { date } : {}),
    });
    expect(apiGet).toHaveBeenCalledWith(
      '/v1/clinics/clinic-1/patients/history?phone=9876543210',
      undefined,
    );
  });
});
