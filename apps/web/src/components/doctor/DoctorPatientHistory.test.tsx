import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DoctorPatientHistory } from './DoctorPatientHistory';
import { searchPatientHistory } from '@/lib/api/clinic-clinical';

vi.mock('@/hooks/useActiveClinicId', () => ({
  useActiveClinicId: () => 'clinic-1',
}));

vi.mock('@/lib/api/clinic-clinical', () => ({
  searchPatientHistory: vi.fn(),
}));

const mockedSearchPatientHistory = vi.mocked(searchPatientHistory);

describe('DoctorPatientHistory API loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not query on tab entry and cancels an active search on navigation', async () => {
    mockedSearchPatientHistory.mockImplementation(
      (_clinicId, _query, signal) =>
        new Promise<never>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    const { unmount } = render(<DoctorPatientHistory />);
    expect(mockedSearchPatientHistory).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '9876543210' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search History' }));

    await waitFor(() => expect(mockedSearchPatientHistory).toHaveBeenCalledTimes(1));
    const signal = mockedSearchPatientHistory.mock.calls[0]?.[2];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
