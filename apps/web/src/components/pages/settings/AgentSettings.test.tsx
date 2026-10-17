import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSettings } from './AgentSettings';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ effectiveRole: 'admin' }),
}));

afterEach(cleanup);

describe('AgentSettings', () => {
  it('edits the agent language while omitting answering and fallback controls', async () => {
    const onUpdateSettings = vi.fn().mockResolvedValue(undefined);

    render(
      <AgentSettings
        settings={{
          agentEnabled: false,
          bookingMode: 'pending_confirmation',
          language: 'ta_tanglish',
          onboardingComplete: true,
        }}
        onUpdateSettings={onUpdateSettings}
      />,
    );

    expect(screen.queryByText('Answering mode')).not.toBeInTheDocument();
    expect(screen.queryByText('Fallback phone')).not.toBeInTheDocument();
    expect(screen.getByText('Tanglish')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.queryByText('Answering mode')).not.toBeInTheDocument();
    expect(screen.queryByText('Rings before overflow')).not.toBeInTheDocument();
    expect(screen.queryByText(/Fallback phone/)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('+91 98765 43210')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable voice agent' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Booking mode' }), {
      target: { value: 'auto_confirm' },
    });
    const languageSelect = screen.getByRole('combobox', { name: 'Agent language' });
    expect(languageSelect).toHaveValue('ta_tanglish');
    fireEvent.change(languageSelect, { target: { value: 'english' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onUpdateSettings).toHaveBeenCalledWith({
        agentEnabled: true,
        bookingMode: 'auto_confirm',
        language: 'english',
        onboardingComplete: true,
      });
    });
  });
});
