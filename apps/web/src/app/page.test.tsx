import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HomePageContent } from '@/components/pages/HomePageContent';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    me: {
      user: {
        id: '00000000-0000-0000-0000-000000000102',
        name: 'Clinic Admin',
        email: 'admin@sri-murugan.local',
        phone: null,
        platform_role: null,
        active: true,
      },
      clinics: [
        {
          clinic_id: '00000000-0000-0000-0000-000000000001',
          role: 'clinic_admin',
          doctor_id: null,
          active: true,
        },
      ],
    },
    effectiveRole: 'admin',
    clinicRole: {
      clinic_id: '00000000-0000-0000-0000-000000000001',
      role: 'clinic_admin',
      doctor_id: null,
      active: true,
    },
    error: null,
    errorCode: null,
    refresh: async () => {},
  }),
}));

vi.mock('@/lib/api/appointments', () => ({
  fetchAppointments: vi.fn(async () => []),
}));

vi.mock('@/lib/api/clinic-settings', () => ({
  fetchClinicSettings: vi.fn(async () => null),
}));

describe('HomePage shell', () => {
  it('renders the portal home heading and agent toggle for admin', () => {
    render(<HomePageContent />);

    expect(screen.getByRole('heading', { name: /^home$/i })).toBeInTheDocument();
    expect(screen.getByLabelText('AI Voice Agent status')).toBeInTheDocument();
    expect(screen.getByText('Clinic Admin')).toBeInTheDocument();
  });
});
