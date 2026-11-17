import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import DoctorRouteLayout from '@/app/doctor/layout';
import HomePage from '@/app/page';
import { RequireAuth } from '@/components/auth/RequireAuth';

const { auth, replace, doctorLayout, navigation } = vi.hoisted(() => ({
  auth: { status: 'authenticated', effectiveRole: 'doctor', error: null, errorCode: null },
  replace: vi.fn(),
  doctorLayout: vi.fn(),
  navigation: { pathname: '/doctor/settings' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => navigation.pathname,
}));
vi.mock('@/components/auth/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('@/components/doctor/DoctorLayout', () => ({
  DoctorLayout: ({ children }: { children: ReactNode }) => {
    doctorLayout();
    return <div>{children}</div>;
  },
}));
vi.mock('@/components/layout/PortalLayout', () => ({
  PortalLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/pages/HomePageContent', () => ({
  HomePageContent: () => <h1>Clinic admin home</h1>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  auth.status = 'authenticated';
  auth.effectiveRole = 'doctor';
  navigation.pathname = '/doctor/settings';
});
afterEach(cleanup);

describe('doctor portal route access', () => {
  it('opens authenticated doctor deep links without redirecting to Today', () => {
    render(
      <DoctorRouteLayout>
        <h1>Personal settings</h1>
      </DoctorRouteLayout>,
    );
    expect(screen.getByRole('heading', { name: 'Personal settings' })).toBeInTheDocument();
    expect(doctorLayout).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('keeps the doctor deep link when asking a new tab to sign in', async () => {
    auth.status = 'unauthenticated';
    render(
      <DoctorRouteLayout>
        <h1>Personal settings</h1>
      </DoctorRouteLayout>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Fdoctor%2Fsettings'));
    expect(screen.queryByRole('heading', { name: 'Personal settings' })).not.toBeInTheDocument();
    expect(doctorLayout).not.toHaveBeenCalled();
  });

  it('blocks clinic admins from loading the doctor portal or its data', async () => {
    auth.effectiveRole = 'admin';
    render(
      <DoctorRouteLayout>
        <h1>Personal settings</h1>
      </DoctorRouteLayout>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(screen.queryByRole('heading', { name: 'Personal settings' })).not.toBeInTheDocument();
    expect(doctorLayout).not.toHaveBeenCalled();
  });

  it.each(['loading', 'inactive', 'error'])(
    'does not render protected children while auth is %s',
    (status) => {
      auth.status = status;
      render(
        <DoctorRouteLayout>
          <h1>Personal settings</h1>
        </DoctorRouteLayout>,
      );
      expect(screen.queryByRole('heading', { name: 'Personal settings' })).not.toBeInTheDocument();
      expect(doctorLayout).not.toHaveBeenCalled();
    },
  );

  it('redirects the legacy doctor homepage to the canonical Today route', async () => {
    render(<HomePage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/doctor'));
    expect(screen.queryByRole('heading', { name: 'Clinic admin home' })).not.toBeInTheDocument();
  });

  it('leaves the clinic admin homepage intact', () => {
    auth.effectiveRole = 'admin';
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: 'Clinic admin home' })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('retains the existing admin-only route fence for doctors', async () => {
    render(
      <RequireAuth pathname="/call-inbox">
        <h1>Call records</h1>
      </RequireAuth>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(screen.queryByRole('heading', { name: 'Call records' })).not.toBeInTheDocument();
  });
});
