import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClinicHours } from '@/components/pages/clinic-setup/ClinicHours';
import { DoctorSchedule } from '@/components/pages/clinic-setup/DoctorSchedule';
import { HolidaySetup } from '@/components/pages/clinic-setup/HolidaySetup';
import { ApiRequestError } from '@/lib/api/client';
import {
  fetchAllDoctorSchedules,
  fetchClinicHours,
  fetchDoctorSchedules,
  fetchDoctors,
  replaceClinicHours,
  replaceDoctorSchedules,
  replaceAllDoctorSchedules,
  fetchHolidays,
  patchHoliday,
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
  replaceAllDoctorSchedules: vi.fn(),
  fetchHolidays: vi.fn(),
  patchHoliday: vi.fn(),
  createHoliday: vi.fn(),
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
  vi.mocked(replaceAllDoctorSchedules).mockReset().mockResolvedValue([]);
  vi.mocked(fetchHolidays)
    .mockReset()
    .mockResolvedValue([
      {
        id: 'holiday-1',
        holiday_date: '2026-10-20',
        reason: 'Dasara',
        is_full_day: true,
        active: true,
        applies_to_clinic: true,
        doctor_ids: [],
      },
    ]);
  vi.mocked(patchHoliday).mockReset().mockResolvedValue({
    id: 'holiday-1',
    holiday_date: '2026-10-21',
    reason: 'Dasara',
    is_full_day: true,
    active: true,
    applies_to_clinic: true,
    doctor_ids: [],
  });
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
      await screen.findByText(
        /Asha Patient has booked an appointment.*These clinic hours would exclude/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(APPOINTMENT_ID))).not.toBeInTheDocument();
    const retryButton = screen.getByRole('button', { name: 'Recheck and save' });
    expect(retryButton).toBeEnabled();
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(mockedReplaceClinicHours).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByText(
          /Asha Patient has booked an appointment.*These clinic hours would exclude/,
        ),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    });
  });
});

describe('DoctorSchedule', () => {
  it('explains an end time before the start time without calling the API', async () => {
    render(<DoctorSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '23:00' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '13:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Choose valid working hours with the end time after the start time.'),
    ).toBeInTheDocument();
    expect(replaceAllDoctorSchedules).not.toHaveBeenCalled();
    expect(replaceDoctorSchedules).not.toHaveBeenCalled();
    expect(screen.queryByText(/temporarily unavailable/)).not.toBeInTheDocument();
  });

  it('shows doctor-hours conflict details and can recheck the unchanged schedule', async () => {
    mockedReplaceDoctorSchedules.mockRejectedValueOnce(conflictError('outside_doctor_hours'));

    render(<DoctorSchedule />);

    await screen.findByRole('button', { name: 'Edit' });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: DOCTOR_ID } });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(
        /Asha Patient has booked an appointment.*These doctor working hours would exclude/,
      ),
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

  it('saves shared hours through the bulk endpoint and explains replacement', async () => {
    render(<DoctorSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByText(/Saving replaces the existing weekly schedules/)).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(replaceAllDoctorSchedules).toHaveBeenCalledWith(CLINIC_ID, [
        { day_of_week: 1, start_time: '09:00', end_time: '17:00', active: true },
      ]),
    );
    expect(replaceDoctorSchedules).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('saved');
  });

  it('blocks overlapping hours before making a save request', async () => {
    render(<DoctorSchedule />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(dayEditor('Monday').getByRole('button', { name: /add slot/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(/Working hours for the same doctor must not overlap/),
    ).toBeInTheDocument();
    expect(replaceAllDoctorSchedules).not.toHaveBeenCalled();
    expect(replaceDoctorSchedules).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});

describe('HolidaySetup', () => {
  it('clears a stale conflict after the date changes and allows saving again', async () => {
    vi.mocked(patchHoliday).mockRejectedValueOnce(conflictError('outside_clinic_hours'));
    render(<HolidaySetup />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Holiday reason'), {
      target: { value: 'Updated holiday' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Asha Patient has booked an appointment/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recheck and save' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Holiday date'), { target: { value: '2026-10-21' } });
    expect(screen.queryByText(/Asha Patient has booked an appointment/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(patchHoliday).toHaveBeenLastCalledWith(
        CLINIC_ID,
        'holiday-1',
        expect.objectContaining({ holiday_date: '2026-10-21' }),
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Holidays saved');
  });

  it('removes a saved holiday instead of offering Disable', async () => {
    render(<HolidaySetup />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(patchHoliday).toHaveBeenCalledWith(CLINIC_ID, 'holiday-1', { active: false }),
    );
    expect(await screen.findByText('No holidays configured')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disable' })).not.toBeInTheDocument();
  });
});
