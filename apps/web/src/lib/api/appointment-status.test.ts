import { describe, expect, it, vi } from 'vitest';

import { apiPatch } from '@/lib/api/client';
import { updateAppointmentStatus } from './appointments';

vi.mock('@/lib/api/client', () => ({ apiGet: vi.fn(), apiPatch: vi.fn(), apiPost: vi.fn() }));

describe('appointment status correction API', () => {
  it('sends only the selected status to the clinic-scoped appointment endpoint', async () => {
    await updateAppointmentStatus('clinic-1', 'appointment-1', 'visited');
    expect(apiPatch).toHaveBeenCalledWith(
      '/v1/clinics/clinic-1/appointments/appointment-1/status',
      { status: 'visited' },
    );
  });
});
