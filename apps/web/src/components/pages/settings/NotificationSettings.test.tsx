import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationSettings } from './NotificationSettings';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ effectiveRole: 'admin' }),
}));

afterEach(cleanup);

describe('NotificationSettings', () => {
  it('omits pending channel and test controls while saving the remaining setting', async () => {
    const onUpdateSettings = vi.fn().mockResolvedValue(undefined);

    render(
      <NotificationSettings
        settings={{ notifyStaffOnPendingAppointment: true }}
        notificationEvents={[]}
        onUpdateSettings={onUpdateSettings}
      />,
    );

    expect(screen.queryByText('Pending notification channel')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Test notification' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Test notification' })).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Notify staff on pending appointment' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onUpdateSettings).toHaveBeenCalledWith({
        notifyStaffOnPendingAppointment: false,
      });
    });
  });
});
