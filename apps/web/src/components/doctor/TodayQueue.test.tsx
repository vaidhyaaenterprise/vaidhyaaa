import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TodayQueue } from './TodayQueue';
import { fetchAppointments } from '@/lib/api/appointments';

vi.mock('@/hooks/useActiveClinicId', () => ({
  useActiveClinicId: () => 'clinic-1',
}));

vi.mock('./DoctorLayout', () => ({
  useDoctorNav: () => ({ setPatientCount: vi.fn() }),
}));

vi.mock('@/lib/api/appointments', () => ({
  fetchAppointments: vi.fn(),
  markAppointmentVisited: vi.fn(),
}));

const mockedFetchAppointments = vi.mocked(fetchAppointments);

describe('TodayQueue API loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchAppointments.mockResolvedValue([]);
  });

  it('loads the clinic queue once and filters cached rows when the date changes', async () => {
    render(<TodayQueue />);

    await waitFor(() => expect(mockedFetchAppointments).toHaveBeenCalledTimes(1));
    expect(mockedFetchAppointments).toHaveBeenCalledWith(
      'clinic-1',
      ['confirmed', 'visited'],
      expect.any(AbortSignal),
    );

    fireEvent.change(screen.getByLabelText('Select Date'), {
      target: { value: '2026-10-05' },
    });

    await waitFor(() => expect(screen.getByDisplayValue('2026-10-05')).toBeInTheDocument());
    expect(mockedFetchAppointments).toHaveBeenCalledTimes(1);
  });
});
