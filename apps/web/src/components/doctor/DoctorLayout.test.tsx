import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

import {
  fetchDoctors,
  fetchDoctorServices,
  fetchServices,
  type DoctorApiRow,
  type DoctorServiceApiRow,
  type ServiceApiRow,
} from '@/lib/api/clinic-clinical';
import { clearDevAuthProfile } from '@/lib/dev-auth/storage';
import { ClinicSwitcher } from '@/components/layout/ClinicSwitcher';
import { DoctorLayout, useDoctorNav } from './DoctorLayout';
import { DoctorPortalContent } from './DoctorPortalContent';

const { push, refresh, auth, navigation } = vi.hoisted(() => ({
  navigation: { pathname: '/doctor' },
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => navigation.pathname,
}));
vi.mock('next/link', () => ({
  default: ({ children, ...props }: ComponentProps<'a'>) => (
    <a {...props} onClick={(event) => event.preventDefault()}>
      {children}
    </a>
  ),
}));
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
vi.mock('@/lib/api/clinic-clinical', () => ({
  fetchDoctors: vi.fn(),
  fetchDoctorServices: vi.fn(),
  fetchServices: vi.fn(),
}));
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
const services: ServiceApiRow[] = [
  {
    id: 'service-general',
    service_name: 'General Consultation',
    service_key: 'general',
    active: true,
  },
  {
    id: 'service-pediatric',
    service_name: 'Pediatric Consultation',
    service_key: 'pediatric',
    active: true,
  },
  {
    id: 'service-inactive',
    service_name: 'Inactive Service',
    service_key: 'inactive',
    active: false,
  },
];
const doctorServices: DoctorServiceApiRow[] = [
  {
    id: 'mapping-general',
    doctor_id: 'doctor-1',
    clinic_service_id: 'service-general',
    consultation_fee_amount: '500',
    active: true,
  },
  {
    id: 'mapping-inactive',
    doctor_id: 'doctor-1',
    clinic_service_id: 'service-pediatric',
    consultation_fee_amount: '600',
    active: false,
  },
  {
    id: 'mapping-other-doctor',
    doctor_id: 'doctor-other',
    clinic_service_id: 'service-pediatric',
    consultation_fee_amount: '600',
    active: true,
  },
  {
    id: 'mapping-inactive-service',
    doctor_id: 'doctor-1',
    clinic_service_id: 'service-inactive',
    consultation_fee_amount: '400',
    active: true,
  },
];

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  navigation.pathname = '/doctor';
  auth.clinicRole = { clinic_id: 'clinic-1', doctor_id: 'doctor-1', role: 'doctor', active: true };
  auth.me.user.platform_role = null;
  vi.mocked(fetchDoctors).mockResolvedValue([
    { ...doctor, id: 'doctor-other', name: 'Another doctor', qualification: 'MD (Paediatrics)' },
    doctor,
  ]);
  vi.mocked(fetchDoctorServices).mockResolvedValue(doctorServices);
  vi.mocked(fetchServices).mockResolvedValue(services);
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
    expect(within(sidebar).getByText('Service: General Consultation')).toBeInTheDocument();
    const serviceLabels = screen.getAllByText('Service: General Consultation');
    expect(serviceLabels).toHaveLength(2);
    expect(serviceLabels.every((label) => label.classList.contains('break-words'))).toBe(true);
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
    expect(screen.queryByText(/Pediatric Consultation/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Inactive Service/)).not.toBeInTheDocument();
  });

  it('shows a clear fallback when the linked doctor has no active service', async () => {
    vi.mocked(fetchDoctorServices).mockResolvedValueOnce([]);
    render(portal());
    expect(
      await within(screen.getByRole('complementary')).findByText('Service: Not assigned'),
    ).toBeInTheDocument();
  });

  it('keeps doctor identity visible if service details cannot be loaded', async () => {
    vi.mocked(fetchDoctorServices).mockRejectedValueOnce(new Error('service unavailable'));
    render(portal());
    const sidebar = screen.getByRole('complementary');
    expect(await within(sidebar).findByText(doctor.qualification!)).toBeInTheDocument();
    expect(within(sidebar).getByText('Service: Service details unavailable')).toBeInTheDocument();
  });

  it('uses real section links and follows the URL for navigation, refresh and browser history', async () => {
    const view = render(portal());
    const navigationMenu = screen.getByRole('navigation', { name: 'Doctor navigation' });
    expect(within(navigationMenu).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/doctor/settings',
    );
    expect(within(navigationMenu).getByRole('link', { name: /^Today/ })).toHaveAttribute(
      'href',
      '/doctor',
    );
    const mobile = screen.getByRole('navigation', { name: 'Doctor mobile navigation' });
    expect(within(mobile).getByRole('link', { name: 'Patient History' })).toHaveAttribute(
      'href',
      '/doctor/patient-history',
    );
    expect(within(mobile).getByRole('link', { name: 'Analytics' })).toHaveAttribute(
      'href',
      '/doctor/analytics',
    );

    for (const [path, title, label] of [
      ['/doctor/settings', 'Doctor settings', 'Settings'],
      ['/doctor/patient-history', 'Full patient history', 'Patient History'],
      ['/doctor/analytics', 'Doctor analytics', 'Analytics'],
      ['/doctor/settings', 'Doctor settings', 'Settings'],
    ] as const) {
      navigation.pathname = path;
      view.rerender(portal());
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
      expect(within(navigationMenu).getByRole('link', { name: label })).toHaveAttribute(
        'aria-current',
        'page',
      );
    }
    view.unmount();
    render(portal());
    expect(screen.getByRole('heading', { name: 'Doctor settings' })).toBeInTheDocument();
    await within(screen.getByRole('complementary')).findByText('Dr. Merp');
  });

  it('keeps programmatic section changes routed to the canonical URL', async () => {
    function GoToHistory() {
      const { setActiveSection } = useDoctorNav();
      return <button onClick={() => setActiveSection('history')}>Open history</button>;
    }
    render(
      <DoctorLayout>
        <GoToHistory />
      </DoctorLayout>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open history' }));
    expect(push).toHaveBeenCalledWith('/doctor/patient-history');
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
    vi.mocked(fetchDoctorServices)
      .mockResolvedValueOnce(doctorServices)
      .mockResolvedValueOnce([
        {
          id: 'mapping-new-doctor',
          doctor_id: 'doctor-2',
          clinic_service_id: 'service-pediatric',
          consultation_fee_amount: '700',
          active: true,
        },
      ]);
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
    await screen.findAllByText('Service: Pediatric Consultation');
    await act(async () => {
      resolveFirst([doctor]);
    });
    expect(screen.queryByText('MBBS, MS (Orthopaedics)')).not.toBeInTheDocument();
    expect(screen.queryByText('Service: General Consultation')).not.toBeInTheDocument();
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
