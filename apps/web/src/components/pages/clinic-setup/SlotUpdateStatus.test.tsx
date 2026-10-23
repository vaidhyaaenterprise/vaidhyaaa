import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlotUpdateStatus } from './SlotUpdateStatus';
import { fetchSlotUpdateStatus, retrySlotUpdates } from '@/lib/api/slot-updates';

vi.mock('@/lib/api/slot-updates', () => ({
  fetchSlotUpdateStatus: vi.fn(),
  retrySlotUpdates: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe('slot update status', () => {
  it('shows a failure and lets an administrator requeue the update without resaving rules', async () => {
    vi.mocked(fetchSlotUpdateStatus)
      .mockResolvedValueOnce({ state: 'failed', remaining: 0, failed: 1 })
      .mockResolvedValue({ state: 'updating', remaining: 1, failed: 0 });
    vi.mocked(retrySlotUpdates).mockResolvedValue({ state: 'updating', remaining: 1, failed: 0 });
    render(<SlotUpdateStatus clinicId="clinic-1" doctorId="doctor-1" canRetry refreshKey={0} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be updated');
    fireEvent.click(screen.getByRole('button', { name: 'Retry slot update' }));
    await waitFor(() => expect(retrySlotUpdates).toHaveBeenCalledWith('clinic-1'));
    expect(await screen.findByRole('status')).toHaveTextContent('updating in the background');
  });

  it('polls while updating and clears the warning only after completion', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchSlotUpdateStatus)
      .mockResolvedValueOnce({ state: 'updating', remaining: 1, failed: 0 })
      .mockResolvedValue({ state: 'ready', remaining: 0, failed: 0 });
    await act(async () => {
      render(
        <SlotUpdateStatus
          clinicId="clinic-1"
          doctorId="doctor-1"
          canRetry={false}
          refreshKey={0}
        />,
      );
    });
    expect(screen.getByRole('status')).toHaveTextContent('updating');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('never offers the mutation to a doctor login', async () => {
    vi.mocked(fetchSlotUpdateStatus).mockResolvedValue({
      state: 'failed',
      remaining: 0,
      failed: 1,
    });
    render(
      <SlotUpdateStatus clinicId="clinic-1" doctorId="doctor-1" canRetry={false} refreshKey={0} />,
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
