import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchDoctors, type DoctorApiRow } from '@/lib/api/clinic-clinical';
import { clearDevAuthProfile } from '@/lib/dev-auth/storage';
import { ClinicSwitcher } from '@/components/layout/ClinicSwitcher';
import { DoctorLayout } from './DoctorLayout';
import { DoctorPortalContent } from './DoctorPortalContent';

const { push, refresh, auth } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
  auth: {
    clinicRole: {
      clinic_id: 'clinic-1',
      doctor_id: 'doctor-1' as string | null,
      role: 'doctor',
      active: true,
    },
    me: { user: { name: 'Login account', platform_role: null as string | null } },
  },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/components/auth/AuthProvider', () => ({ useAuth: () => ({ ...auth, refresh }) }));
vi.mock('@/components/clinic/ClinicProfileProvider', () => ({
  useClinicProfile: () => ({
    clinicId: 'clinic-1',
    profile: {
      name: 'High on Love',
      clinic_unique_number: '1003',
      primary_phone: '9876543211',
      address_line1: 'VPG Avenue 3rd Street',
      address_line2: 'Metukuppam, Thoraipakkam',
      city: 'Chennai',
      state: 'Tamil Nadu',
      postal_code: '600097',
    },
    status: 'ready',
    refresh: vi.fn(),
    updateProfile: vi.fn(),
  }),
}));
vi.mock('@/lib/api/clinic-clinical', () => ({ fetchDoctors: vi.fn() }));
vi.mock('@/lib/dev-auth/storage', () => ({ clearDevAuthProfile: vi.fn() }));
vi.mock('./TodayQueue', () => ({ TodayQueue: () => <h1>Today queue</h1> }));
vi.mock('./DoctorAnalytics', () => ({ DoctorAnalytics: () => <h1>Doctor analytics</h1> }));
vi.mock('./DoctorPatientHistory', () => ({
  DoctorPatientHistory: () => <h1>Full patient history</h1>,
}));
vi.mock('./DoctorSettings', () => ({ DoctorSettings: () => <h1>Doctor settings</h1> }));

const doctor: DoctorApiRow = {
  id: 'doctor-1',
  name: 'Dr. Merp',
  qualification: 'MBBS, MS (Orthopaedics)',
  active: true,
  user_id: 'user-1',
};

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  auth.clinicRole = { clinic_id: 'clinic-1', doctor_id: 'doctor-1', role: 'doctor', active: true };
  auth.me.user.platform_role = null;
  vi.mocked(fetchDoctors).mockResolvedValue([
    { ...doctor, id: 'doctor-other', name: 'Another doctor', qualification: 'MD (Paediatrics)' },
    doctor,
  ]);
});

function portal() {
  return (
    <DoctorLayout>
      <DoctorPortalContent />
    </DoctorLayout>
  );
}

describe('doctor portal sidebar and navigation', () => {
  it('uses the linked doctor qualification and shows full clinic details without an edit action', async () => {
    render(portal());
    const sidebar = screen.getByRole('complementary');
    expect(await within(sidebar).findByText(doctor.qualification!)).toBeInTheDocument();
    expect(within(sidebar).getByText('Dr. Merp')).toBeInTheDocument();
    expect(within(sidebar).getByText('High on Love')).toBeInTheDocument();
    expect(
      within(sidebar).getByText(
        'VPG Avenue 3rd Street, Metukuppam, Thoraipakkam, Chennai, Tamil Nadu, 600097',
      ),
    ).toBeInTheDocument();
    expect(within(sidebar).getByText('Clinic line: 9876543211')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit clinic details' })).not.toBeInTheDocument();
    expect(screen.queryByText('Orthopaedic Surgeon')).not.toBeInTheDocument();
    expect(screen.queryByText('On Duty')).not.toBeInTheDocument();
    expect(screen.queryByText('MD (Paediatrics)')).not.toBeInTheDocument();
  });

  it('opens Settings from the sidebar and keeps the existing sections accessible on mobile', async () => {
    render(portal());
    const navigation = screen.getByRole('navigation', { name: 'Doctor navigation' });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Doctor settings' })).toBeInTheDocument();
    expect(within(navigation).getByRole('button', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.queryByRole('heading', { name: 'Today queue' })).not.toBeInTheDocument();
    const mobile = screen.getByRole('navigation', { name: 'Doctor mobile navigation' });
    fireEvent.click(within(mobile).getByRole('button', { name: 'Patient History' }));
    expect(screen.getByRole('heading', { name: 'Full patient history' })).toBeInTheDocument();
    fireEvent.click(within(mobile).getByRole('button', { name: 'Analytics' }));
    expect(screen.getByRole('heading', { name: 'Doctor analytics' })).toBeInTheDocument();
    fireEvent.click(within(mobile).getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Doctor settings' })).toBeInTheDocument();
    await within(screen.getByRole('complementary')).findByText('Dr. Merp');
  });

  it('keeps logout outside the navigation, clears this tab session and returns to login', async () => {
    render(portal());
    const sidebar = screen.getByRole('complementary');
    expect(
      within(screen.getByRole('navigation', { name: 'Doctor navigation' })).queryByRole('button', {
        name: /Logout/,
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(sidebar).getByRole('button', { name: /Logout/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
    expect(clearDevAuthProfile).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('does not show a previous doctor qualification after the active membership changes', async () => {
    let resolveFirst!: (rows: DoctorApiRow[]) => void;
    vi.mocked(fetchDoctors).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const view = render(portal());
    const firstSignal = vi.mocked(fetchDoctors).mock.calls[0]![1]!;
    auth.clinicRole = {
      clinic_id: 'clinic-2',
      doctor_id: 'doctor-2',
      role: 'doctor',
      active: true,
    };
    vi.mocked(fetchDoctors).mockResolvedValueOnce([
      { ...doctor, id: 'doctor-2', name: 'Dr. New', qualification: 'MD (General Medicine)' },
    ]);
    view.rerender(portal());
    expect(firstSignal.aborted).toBe(true);
    await screen.findAllByText('MD (General Medicine)');
    await act(async () => {
      resolveFirst([doctor]);
    });
    expect(screen.queryByText('MBBS, MS (Orthopaedics)')).not.toBeInTheDocument();
    expect(within(screen.getByRole('complementary')).getByText('Dr. New')).toBeInTheDocument();
  });

  it('never falls back to an unrelated doctor when no doctor is linked', () => {
    auth.clinicRole.doctor_id = null;
    render(portal());
    expect(fetchDoctors).not.toHaveBeenCalled();
    expect(screen.queryByText(doctor.qualification!)).not.toBeInTheDocument();
    expect(screen.queryByText('Another doctor')).not.toBeInTheDocument();
  });

  it('can force the clinic card read-only while leaving the admin card editable', () => {
    auth.clinicRole.role = 'clinic_admin';
    const view = render(<ClinicSwitcher readOnly />);
    expect(screen.queryByRole('button', { name: 'Edit clinic details' })).not.toBeInTheDocument();
    view.rerender(<ClinicSwitcher />);
    expect(screen.getByRole('button', { name: 'Edit clinic details' })).toBeInTheDocument();
  });
});
