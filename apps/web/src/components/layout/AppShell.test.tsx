import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from '@/components/layout/AppShell';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    me: {
      user: {
        name: 'Merp',
      },
    },
  }),
}));

vi.mock('@/components/auth/DevAuthSwitcher', () => ({
  DevAuthSwitcher: () => <button type="button">Sign out</button>,
}));

vi.mock('@/components/layout/ClinicSwitcher', () => ({
  ClinicSwitcher: () => <div>Clinic details</div>,
}));

vi.mock('@/components/layout/SidebarNav', () => ({
  SidebarNav: () => <nav>Main navigation</nav>,
}));

afterEach(() => {
  cleanup();
});

describe('AppShell', () => {
  it('moves the signed-in account to the sidebar and removes the voice-bot card', () => {
    render(
      <AppShell>
        <h1>Home</h1>
      </AppShell>,
    );

    const sidebar = screen.getByRole('complementary');
    const sidebarAccount = within(sidebar).getByRole('region', { name: 'Signed-in account' });

    expect(within(sidebarAccount).getByText('Signed in')).toBeInTheDocument();
    expect(within(sidebarAccount).getByText('Merp')).toBeInTheDocument();
    expect(within(sidebarAccount).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByText('Voice bot active')).not.toBeInTheDocument();

    const main = screen.getByRole('main');
    expect(main.firstElementChild).toContainElement(screen.getByRole('heading', { name: 'Home' }));
  });
});
