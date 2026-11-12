import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ManualAppointmentModal, type ManualAppointmentData } from './ManualAppointmentModal';
import {
  fetchAvailableAppointmentSlots,
  type AppointmentAvailableSlotApiRow,
} from '@/lib/api/appointments';
import { buildManualAppointmentPayload, DEFAULT_BOOKING_RULES } from '@/lib/manual-appointment';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ effectiveRole: 'admin' }),
}));
vi.mock('@/hooks/useActiveClinicId', () => ({ useActiveClinicId: () => 'clinic-1' }));
vi.mock('@/lib/api/appointments', () => ({ fetchAvailableAppointmentSlots: vi.fn() }));
vi.mock('@/lib/api/clinic-clinical', () => ({
  fetchHolidays: vi.fn().mockResolvedValue([]),
  searchPatientHistory: vi.fn().mockResolvedValue([]),
}));

const slots: AppointmentAvailableSlotApiRow[] = [
  {
    slot_id: 'slot-1',
    doctor_id: 'doctor-1',
    clinic_service_id: 'service-1',
    appointment_start: '2026-10-24 09:00:00',
    appointment_end: '2026-10-24 09:30:00',
    available_count: 2,
  },
  {
    slot_id: 'slot-2',
    doctor_id: 'doctor-1',
    clinic_service_id: 'service-1',
    appointment_start: '2026-10-24 11:30:00',
    appointment_end: '2026-10-24 12:00:00',
    available_count: 2,
  },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
  vi.mocked(fetchAvailableAppointmentSlots).mockReset().mockResolvedValue(slots);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function openModal() {
  const onCreate = vi.fn().mockResolvedValue(undefined);
  render(
    <ManualAppointmentModal
      isOpen
      onClose={vi.fn()}
      bookingRules={DEFAULT_BOOKING_RULES}
      doctors={[{ id: 'doctor-1', name: 'Doctor' }]}
      services={[{ id: 'service-1', name: 'Consultation' }]}
      doctorServiceMappings={[{ doctorId: 'doctor-1', serviceId: 'service-1' }]}
      onCreateAppointment={onCreate}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Select date/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Today' }));
  return onCreate;
}

async function selectSecondSlot() {
  await screen.findByRole('option', { name: '11:30 AM (2 left)' });
  fireEvent.change(screen.getByLabelText('Time *'), { target: { value: 'slot-2' } });
}

function fillPatient() {
  fireEvent.change(screen.getByPlaceholderText('Enter patient name'), {
    target: { value: 'Patient' },
  });
  fireEvent.change(screen.getByLabelText('Patient phone *'), { target: { value: '9876543210' } });
  fireEvent.change(screen.getByPlaceholderText('e.g. 38'), { target: { value: '38' } });
  fireEvent.change(screen.getByPlaceholderText('Describe the reason for visit'), {
    target: { value: 'Review' },
  });
}

function fillOverrideTime(value = '18:45') {
  fireEvent.change(screen.getByLabelText('Manual override time *'), { target: { value } });
  fireEvent.change(
    screen.getByPlaceholderText('Explain why this appointment is outside normal hours'),
    {
      target: { value: 'Admin approved evening consultation' },
    },
  );
}

function submit() {
  fireEvent.submit(screen.getByRole('button', { name: 'Create appointment' }).closest('form')!);
}

describe('Manual appointment override time', () => {
  it('preserves the selected slot when enabling, editing and disabling override', async () => {
    openModal();
    await selectSecondSlot();
    const toggle = screen.getByRole('checkbox', { name: 'Override clinic hours' });
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Time *')).toHaveValue('slot-2');
    expect(screen.getByLabelText('Manual override time *')).toHaveValue('11:30');
    fillOverrideTime();
    expect(screen.getByLabelText('Time *')).toHaveValue('slot-2');
    expect(screen.getByText('Slot ends at 12:00 PM')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Time *')).toHaveValue('slot-2');
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Manual override time *')).toHaveValue('18:45');
    expect(fetchAvailableAppointmentSlots).toHaveBeenCalledTimes(1);
  });

  it('submits the manual time without the retained slot ID or its timestamps', async () => {
    const onCreate = openModal();
    await selectSecondSlot();
    fillPatient();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Override clinic hours' }));
    fillOverrideTime();
    submit();
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    const data = onCreate.mock.calls[0]![0] as ManualAppointmentData;
    expect(data).toMatchObject({
      appointmentTime: '18:45',
      slotId: undefined,
      appointmentStart: undefined,
      appointmentEnd: undefined,
    });
    const payload = buildManualAppointmentPayload(data, 30);
    expect(payload).toMatchObject({
      appointment_start: '2026-10-24T18:45:00Z',
      appointment_end: '2026-10-24T19:15:00.000Z',
      override_reason: 'Admin approved evening consultation',
    });
    expect(payload).not.toHaveProperty('slot_id');
  });

  it('submits the original slot and no override reason after override is disabled', async () => {
    const onCreate = openModal();
    await selectSecondSlot();
    fillPatient();
    const toggle = screen.getByRole('checkbox', { name: 'Override clinic hours' });
    fireEvent.click(toggle);
    fillOverrideTime();
    fireEvent.click(toggle);
    submit();
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    const data = onCreate.mock.calls[0]![0] as ManualAppointmentData;
    expect(data).toMatchObject({
      appointmentTime: '11:30',
      slotId: 'slot-2',
      appointmentStart: '2026-10-24 11:30:00',
      appointmentEnd: '2026-10-24 12:00:00',
    });
    expect(buildManualAppointmentPayload(data, 30)).not.toHaveProperty('override_reason');
  });

  it('does not overwrite a manual time when an in-flight slot request completes', async () => {
    let resolveSlots!: (rows: AppointmentAvailableSlotApiRow[]) => void;
    vi.mocked(fetchAvailableAppointmentSlots).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSlots = resolve;
      }),
    );
    openModal();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Override clinic hours' }));
    fillOverrideTime();
    await act(async () => resolveSlots(slots));
    expect(screen.getByLabelText('Time *')).toHaveValue('slot-1');
    expect(screen.getByLabelText('Manual override time *')).toHaveValue('18:45');
  });

  it('allows clearing manual time without falling back to the retained slot on submit', async () => {
    const onCreate = openModal();
    await selectSecondSlot();
    fillPatient();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Override clinic hours' }));
    fillOverrideTime('');
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    expect(screen.getByLabelText('Manual override time *')).toHaveValue('');
    submit();
    expect(alert).toHaveBeenCalledWith('Please select date and time.');
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Time *')).toHaveValue('slot-2');
  });
});
