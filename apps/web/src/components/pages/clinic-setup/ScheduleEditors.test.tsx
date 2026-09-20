import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClinicHours } from '@/components/pages/clinic-setup/ClinicHours';
import { DoctorSchedule } from '@/components/pages/clinic-setup/DoctorSchedule';
import { ApiRequestError } from '@/lib/api/client';
import {
  fetchAllDoctorSchedules,
  fetchClinicHours,
  fetchDoctorSchedules,
  fetchDoctors,
  replaceClinicHours,
  replaceDoctorSchedules,
} from '@/lib/api/clinic-clinical';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const DOCTOR_ID = '00000000-0000-0000-0000-000000000201';
const APPOINTMENT_ID = '00000000-0000-0000-0000-000000000301';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    effectiveRole: 'admin',
    me: {
      clinics: [
        {
          clinic_id: CLINIC_ID,
          role: 'clinic_admin',
          doctor_id: null,
          active: true,
        },
      ],
    },
  }),
}));

vi.mock('@/hooks/useActiveClinicId', () => ({
  useActiveClinicId: () => CLINIC_ID,
}));

vi.mock('@/lib/api/clinic-clinical', () => ({
  fetchClinicHours: vi.fn(),
  replaceClinicHours: vi.fn(),
  fetchDoctors: vi.fn(),
  fetchAllDoctorSchedules: vi.fn(),
  fetchDoctorSchedules: vi.fn(),
  replaceDoctorSchedules: vi.fn(),
}));

const mockedFetchClinicHours = vi.mocked(fetchClinicHours);
const mockedReplaceClinicHours = vi.mocked(replaceClinicHours);
const mockedFetchDoctors = vi.mocked(fetchDoctors);
const mockedFetchAllDoctorSchedules = vi.mocked(fetchAllDoctorSchedules);
const mockedFetchDoctorSchedules = vi.mocked(fetchDoctorSchedules);
const mockedReplaceDoctorSchedules = vi.mocked(replaceDoctorSchedules);

function conflictError(reason: 'outside_clinic_hours' | 'outside_doctor_hours') {
  return new ApiRequestError({
    code: 'CONFLICTING_APPOINTMENTS',
    message: 'The proposed hours conflict with an appointment.',
    details: {
      conflicts: [
        {
          appointment_id: APPOINTMENT_ID,
          appointment: {
            patient_name: 'Asha Patient',
            appointment_start: '2026-09-21 09:30:00',
            appointment_end: '2026-09-21 10:00:00',
            doctor_name: 'Dr. Test',
            service_name: 'General consultation',
            status: 'confirmed',
          },
          reason,
        },
      ],
    },
  });
}

function dayEditor(day: string) {
  const label = screen.getByText(day, { selector: 'span' });
  const editor = label.parentElement?.parentElement;
  if (!editor) {
    throw new Error(`Could not find the ${day} schedule editor.`);
  }
  return within(editor);
}

beforeEach(() => {
  mockedFetchClinicHours.mockReset().mockResolvedValue([
    {
      id: 'clinic-hours-monday',
      day_of_week: 1,
      start_time: '09:00',
      end_time: '17:00',
      active: true,
    },
  ]);
  mockedReplaceClinicHours.mockReset().mockResolvedValue([]);

  mockedFetchDoctors.mockReset().mockResolvedValue([
    {
      id: DOCTOR_ID,
      name: 'Dr. Test',
      qualification: 'MD',
      user_id: null,
      active: true,
    },
  ]);
  mockedFetchAllDoctorSchedules.mockReset().mockResolvedValue([
    {
      id: 'doctor-hours-monday',
      doctor_id: DOCTOR_ID,
      day_of_week: 1,
      start_time: '09:00',
      end_time: '17:00',
      active: true,
    },
  ]);
  mockedFetchDoctorSchedules.mockReset().mockResolvedValue([]);
  mockedReplaceDoctorSchedules.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe('ClinicHours', () => {
  it('keeps existing hours in the replacement payload when Saturday and Sunday are added', async () => {
    mockedReplaceClinicHours.mockResolvedValue([
      {
        id: 'clinic-hours-monday',
        day_of_week: 1,
        start_time: '09:00',
        end_time: '17:00',
        active: true,
      },
      {
        id: 'clinic-hours-saturday',
        day_of_week: 6,
        start_time: '09:00',
        end_time: '13:00',
        active: true,
      },
      {
        id: 'clinic-hours-sunday',
        day_of_week: 0,
        start_time: '09:00',
        end_time: '13:00',
        active: true,
      },
    ]);

    render(<ClinicHours />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(dayEditor('Saturday').getByRole('button', { name: /add slot/i }));
    fireEvent.click(dayEditor('Sunday').getByRole('button', { name: /add slot/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockedReplaceClinicHours).toHaveBeenCalledWith(CLINIC_ID, [
        {
          day_of_week: 1,
          start_time: '09:00',
          end_time: '17:00',
          active: true,
        },
        {
          day_of_week: 6,
          start_time: '09:00',
          end_time: '13:00',
          active: true,
        },
        {
          day_of_week: 0,
          start_time: '09:00',
          end_time: '13:00',
          active: true,
        },
      ]);
    });
  });

  it('keeps conflict details visible and can recheck the same hours after resolution', async () => {
    mockedReplaceClinicHours.mockRejectedValueOnce(conflictError('outside_clinic_hours'));

    render(<ClinicHours />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(/Asha Patient.*falls outside the new clinic hours/),
    ).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(APPOINTMENT_ID))).not.toBeInTheDocument();
    const retryButton = screen.getByRole('button', { name: 'Recheck and save' });
    expect(retryButton).toBeEnabled();
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(mockedReplaceClinicHours).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByText(/Asha Patient.*falls outside the new clinic hours/),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });
  });
});

describe('DoctorSchedule', () => {
  it('shows doctor-hours conflict details and can recheck the unchanged schedule', async () => {
    mockedReplaceDoctorSchedules.mockRejectedValueOnce(conflictError('outside_doctor_hours'));

    render(<DoctorSchedule />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(/Asha Patient.*falls outside the doctor's new working hours/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    const retryButton = screen.getByRole('button', { name: 'Recheck and save' });
    expect(retryButton).toBeEnabled();
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(mockedReplaceDoctorSchedules).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByText(/Asha Patient.*falls outside the doctor's new working hours/),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });
  });
});
