import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BookingRules } from './BookingRules';
import { HolidaySetup } from './HolidaySetup';
import {
  fetchBookingRules,
  fetchDoctors,
  fetchHolidays,
  patchBookingRule,
  patchHoliday,
  type BookingRuleApiRow,
  type HolidayApiRow,
} from '@/lib/api/clinic-clinical';
import { fetchClinicSettings, patchClinicSettings } from '@/lib/api/clinic-settings';

const FIRST_CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const SECOND_CLINIC_ID = '00000000-0000-0000-0000-000000000002';
const DOCTOR_ID = '00000000-0000-0000-0000-000000000101';
let activeClinicId = FIRST_CLINIC_ID;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function bookingRule(id: string, serviceId: string): BookingRuleApiRow {
  return {
    id,
    doctor_id: DOCTOR_ID,
    clinic_service_id: serviceId,
    slot_duration_minutes: 30,
    capacity_per_slot: 1,
    booking_horizon_days: 30,
    manual_edit_cutoff_before_start_minutes: 60,
    manual_edit_max_shift_minutes: 120,
    version: 1,
    active: true,
  };
}

const FIRST_RULE = bookingRule('rule-1', 'service-1');
const SECOND_RULE = bookingRule('rule-2', 'service-2');
const FIRST_HOLIDAY: HolidayApiRow = {
  id: 'holiday-1',
  holiday_date: '2026-10-02',
  reason: 'First closure',
  is_full_day: true,
  active: true,
  applies_to_clinic: true,
  doctor_ids: [],
};
const SECOND_HOLIDAY: HolidayApiRow = {
  ...FIRST_HOLIDAY,
  id: 'holiday-2',
  holiday_date: '2026-10-03',
  reason: 'Second closure',
};

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ effectiveRole: 'admin', me: { clinics: [] } }),
}));

vi.mock('@/hooks/useActiveClinicId', () => ({
  useActiveClinicId: () => activeClinicId,
}));

vi.mock('@/lib/api/clinic-clinical', () => ({
  createHoliday: vi.fn(),
  fetchBookingRules: vi.fn(),
  fetchDoctors: vi.fn(),
  fetchHolidays: vi.fn(),
  patchBookingRule: vi.fn(),
  patchHoliday: vi.fn(),
}));

vi.mock('@/lib/api/clinic-settings', () => ({
  fetchClinicSettings: vi.fn(),
  patchClinicSettings: vi.fn(),
}));

vi.mock('@/lib/api/clinic-subscription', () => ({
  previewBookingRuleChange: vi.fn(),
}));

const mockedFetchBookingRules = vi.mocked(fetchBookingRules);
const mockedFetchDoctors = vi.mocked(fetchDoctors);
const mockedFetchHolidays = vi.mocked(fetchHolidays);
const mockedPatchBookingRule = vi.mocked(patchBookingRule);
const mockedPatchHoliday = vi.mocked(patchHoliday);
const mockedFetchClinicSettings = vi.mocked(fetchClinicSettings);
const mockedPatchClinicSettings = vi.mocked(patchClinicSettings);

beforeEach(() => {
  activeClinicId = FIRST_CLINIC_ID;
  vi.clearAllMocks();
  mockedFetchBookingRules.mockImplementation((clinicId) =>
    Promise.resolve(clinicId === FIRST_CLINIC_ID ? [FIRST_RULE, SECOND_RULE] : []),
  );
  mockedFetchDoctors.mockImplementation((clinicId) =>
    Promise.resolve(
      clinicId === FIRST_CLINIC_ID
        ? [
            {
              id: DOCTOR_ID,
              name: 'Dr. Context',
              qualification: 'MD',
              user_id: null,
              active: true,
            },
          ]
        : [],
    ),
  );
  mockedFetchHolidays.mockImplementation((clinicId) =>
    Promise.resolve(clinicId === FIRST_CLINIC_ID ? [FIRST_HOLIDAY, SECOND_HOLIDAY] : []),
  );
  mockedFetchClinicSettings.mockImplementation((clinicId) =>
    Promise.resolve({
      clinic_id: clinicId,
      agent_enabled: true,
      answering_mode: 'always',
      fallback_phone: null,
      overflow_after_rings: null,
      booking_mode: 'pending_confirmation',
      max_concurrent_calls: 3,
      recording_retention_days: 10,
      transcript_retention_days: 30,
      notify_staff_on_pending_appointment: true,
      pending_appointment_notification_channel: null,
      allow_doctor_service_edit: false,
      allow_patient_auto_cancel: false,
    }),
  );
});

afterEach(cleanup);

describe('Clinic Setup mutation navigation safety', () => {
  it.each([
    'Slot duration (minutes)',
    'Capacity per slot',
    'Booking horizon (days)',
    'Edit cutoff (minutes before start)',
    'Max edit shift (minutes)',
  ])('keeps %s digits-only and allows clearing and typing fresh', async (label) => {
    render(<BookingRules />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const input = screen.getByRole('textbox', { name: label });
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue('');
    for (const invalid of ['e', '-', '+', '.', '1e2', 'abc']) {
      fireEvent.change(input, { target: { value: invalid } });
      expect(input).toHaveValue('');
    }
    fireEvent.change(input, { target: { value: '25' } });
    expect(input).toHaveValue('25');
  });

  it.each(['0', '5', '10', '14'])(
    'rejects a slot duration of %s minutes before any API update',
    async (duration) => {
      render(<BookingRules />);
      fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
      fireEvent.change(screen.getByLabelText('Slot duration (minutes)'), {
        target: { value: duration },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(
        await screen.findByText('Slot duration must be a number between 15 and 120.'),
      ).toBeInTheDocument();
      expect(mockedPatchBookingRule).not.toHaveBeenCalled();
    },
  );

  it('allows blank booking numbers during editing and validates before sending a numeric update', async () => {
    mockedPatchBookingRule.mockImplementation(async (_clinicId, ruleId, patch) => ({
      ...FIRST_RULE,
      id: ruleId,
      ...patch,
    }));
    render(<BookingRules />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const horizon = screen.getByRole('textbox', { name: 'Booking horizon (days)' });
    fireEvent.change(horizon, { target: { value: '' } });
    expect(horizon).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Booking horizon must be a number between 1 and 180.'),
    ).toBeInTheDocument();
    expect(mockedPatchBookingRule).not.toHaveBeenCalled();
    fireEvent.change(horizon, { target: { value: '45' } });
    expect(horizon).toHaveValue('45');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockedPatchBookingRule).toHaveBeenCalledTimes(2));
    expect(mockedPatchBookingRule).toHaveBeenCalledWith(FIRST_CLINIC_ID, FIRST_RULE.id, {
      booking_horizon_days: 45,
    });
  });

  it('does not patch later booking rules or settings after an A-B-A clinic switch', async () => {
    const firstPatch = deferred<BookingRuleApiRow>();
    mockedPatchBookingRule.mockReturnValueOnce(firstPatch.promise);

    const { rerender } = render(<BookingRules />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getAllByRole('textbox')[2]!, { target: { value: '45' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Allow doctor service edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockedPatchBookingRule).toHaveBeenCalledTimes(1);
    });

    activeClinicId = SECOND_CLINIC_ID;
    rerender(<BookingRules />);
    activeClinicId = FIRST_CLINIC_ID;
    rerender(<BookingRules />);
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument();

    await act(async () => {
      firstPatch.resolve({ ...FIRST_RULE, booking_horizon_days: 45 });
      await firstPatch.promise;
    });

    expect(mockedPatchBookingRule).toHaveBeenCalledTimes(1);
    expect(mockedPatchClinicSettings).not.toHaveBeenCalled();
    expect(screen.queryByText('Failed to save booking rules.')).not.toBeInTheDocument();
  });

  it('stops a multi-holiday save before issuing the next write after an A-B-A switch', async () => {
    const firstPatch = deferred<HolidayApiRow>();
    mockedPatchHoliday.mockReturnValueOnce(firstPatch.promise);

    const { rerender } = render(<HolidaySetup />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    for (const removeButton of screen.getAllByRole('button', { name: /^Remove holiday / })) {
      fireEvent.click(removeButton);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockedPatchHoliday).toHaveBeenCalledTimes(1);
    });

    activeClinicId = SECOND_CLINIC_ID;
    rerender(<HolidaySetup />);
    activeClinicId = FIRST_CLINIC_ID;
    rerender(<HolidaySetup />);
    expect(await screen.findByText('First closure')).toBeInTheDocument();

    await act(async () => {
      firstPatch.resolve({ ...FIRST_HOLIDAY, active: false });
      await firstPatch.promise;
    });

    expect(mockedPatchHoliday).toHaveBeenCalledTimes(1);
    expect(screen.getByText('First closure')).toBeInTheDocument();
    expect(screen.getByText('Second closure')).toBeInTheDocument();
  });
});
