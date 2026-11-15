import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DoctorPatientHistory } from './DoctorPatientHistory';
import {
  searchPatientHistory,
  type PatientHistoryApiRow,
  type PatientHistoryItemApiRow,
} from '@/lib/api/clinic-clinical';
import { updateAppointmentStatus } from '@/lib/api/appointments';

let effectiveRole: 'admin' | 'doctor' = 'admin';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ effectiveRole }),
}));

vi.mock('@/hooks/useActiveClinicId', () => ({
  useActiveClinicId: () => 'clinic-1',
}));

vi.mock('@/lib/api/clinic-clinical', () => ({
  searchPatientHistory: vi.fn(),
}));

vi.mock('@/lib/api/appointments', () => ({ updateAppointmentStatus: vi.fn() }));

const mockedSearchPatientHistory = vi.mocked(searchPatientHistory);
const mockedUpdateAppointmentStatus = vi.mocked(updateAppointmentStatus);

beforeEach(() => {
  effectiveRole = 'admin';
  vi.clearAllMocks();
  mockedSearchPatientHistory.mockReset();
  mockedUpdateAppointmentStatus.mockReset();
});

afterEach(cleanup);

describe('DoctorPatientHistory API loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not query on tab entry and cancels an active search on navigation', async () => {
    mockedSearchPatientHistory.mockImplementation(
      (_clinicId, _query, signal) =>
        new Promise<never>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    const { unmount } = render(<DoctorPatientHistory />);
    expect(mockedSearchPatientHistory).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '9876543210' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search History' }));

    await waitFor(() => expect(mockedSearchPatientHistory).toHaveBeenCalledTimes(1));
    const signal = mockedSearchPatientHistory.mock.calls[0]?.[2];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    unmount();
    expect(signal?.aborted).toBe(true);
  });
});

const appointment: PatientHistoryItemApiRow = {
  kind: 'appointment',
  id: 'appointment-1',
  at: '2026-11-12T09:00:00Z',
  doctor_id: 'doctor-1',
  doctor_name: 'Dr. Kumar',
  clinic_service_id: 'service-1',
  clinic_service_name: 'General consultation',
  reason_for_visit: 'First reason',
  status: 'confirmed',
};
const patient: PatientHistoryApiRow = {
  id: 'patient-1',
  name: 'Rajan',
  phone: '9876543210',
  gender: null,
  age: 60,
  date_of_birth: null,
  history: [
    appointment,
    {
      ...appointment,
      id: 'appointment-2',
      at: '2026-11-11T09:00:00Z',
      reason_for_visit: 'Second reason',
    },
  ],
};

describe('Patient history date filtering', () => {
  it('searches by date alone only after submission and keeps full patient history', async () => {
    mockedSearchPatientHistory.mockResolvedValue([
      {
        ...patient,
        history: [
          { ...appointment, status: 'cancelled' },
          { ...patient.history[1]!, status: 'no_show' },
        ],
      },
    ]);
    render(<DoctorPatientHistory />);
    const search = screen.getByRole('button', { name: 'Search History' });
    const date = screen.getByLabelText('Date');
    expect(search).toBeDisabled();
    expect(date).toHaveAttribute('type', 'date');
    expect(date).not.toHaveAttribute('min');
    expect(date).not.toHaveAttribute('max');

    fireEvent.change(date, { target: { value: '2026-11-12' } });
    expect(search).toBeEnabled();
    expect(mockedSearchPatientHistory).not.toHaveBeenCalled();
    fireEvent.click(search);

    await waitFor(() =>
      expect(mockedSearchPatientHistory).toHaveBeenCalledWith(
        'clinic-1',
        { date: '2026-11-12' },
        expect.any(AbortSignal),
      ),
    );
    fireEvent.click(await screen.findByRole('button', { name: /View details/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('First reason')).toBeInTheDocument();
    expect(within(dialog).getByText('Second reason')).toBeInTheDocument();
    expect(within(dialog).getByText('Cancelled')).toBeInTheDocument();
    expect(within(dialog).getByText('No show')).toBeInTheDocument();
  });

  it('combines the date with phone, patient name and age filters', async () => {
    mockedSearchPatientHistory.mockResolvedValue([]);
    render(<DoctorPatientHistory />);
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: ' 9876543210 ' } });
    fireEvent.change(screen.getByLabelText('Patient Name'), { target: { value: ' Rajan ' } });
    fireEvent.change(screen.getByLabelText('Age'), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2027-01-15' } });
    expect(mockedSearchPatientHistory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Search History' }));

    await waitFor(() =>
      expect(mockedSearchPatientHistory).toHaveBeenCalledWith(
        'clinic-1',
        { phone: '9876543210', name: 'Rajan', age: 60, date: '2027-01-15' },
        expect.any(AbortSignal),
      ),
    );
    expect(await screen.findByText('No patient records found')).toBeInTheDocument();
    expect(
      screen.getByText(/Try a different phone, name, age, or appointment date/),
    ).toBeInTheDocument();
  });

  it('omits a cleared date and disables search when all filters are empty', async () => {
    mockedSearchPatientHistory.mockResolvedValue([]);
    render(<DoctorPatientHistory />);
    const date = screen.getByLabelText('Date');
    const search = screen.getByRole('button', { name: 'Search History' });
    fireEvent.change(date, { target: { value: '2026-10-12' } });
    expect(search).toBeEnabled();
    fireEvent.change(date, { target: { value: '' } });
    expect(search).toBeDisabled();
    expect(mockedSearchPatientHistory).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '9876543210' } });
    fireEvent.click(search);

    await waitFor(() =>
      expect(mockedSearchPatientHistory).toHaveBeenCalledWith(
        'clinic-1',
        { phone: '9876543210' },
        expect.any(AbortSignal),
      ),
    );
  });
});

async function searchAndOpen(history = patient.history) {
  mockedSearchPatientHistory.mockResolvedValue([{ ...patient, history }]);
  render(<DoctorPatientHistory />);
  fireEvent.change(screen.getByLabelText('Phone'), { target: { value: patient.phone } });
  fireEvent.click(screen.getByRole('button', { name: 'Search History' }));
  fireEvent.click(await screen.findByRole('button', { name: /View details/ }));
  return screen.getByRole('dialog');
}

function historyRow(dialog: HTMLElement, text: string) {
  return within(dialog).getByText(text).closest('tr')!;
}

describe('Patient history appointment status editing', () => {
  it('edits only the selected status, saves it, and retains the change when reopening history', async () => {
    mockedUpdateAppointmentStatus.mockResolvedValue({
      appointment: { id: appointment.id, status: 'no_show' },
    });
    const dialog = await searchAndOpen();
    const first = historyRow(dialog, 'First reason');
    const second = historyRow(dialog, 'Second reason');
    fireEvent.click(within(first).getByRole('button', { name: /Edit appointment status/ }));
    const select = within(first).getByRole('combobox');
    expect(within(second).queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Confirmed', 'Cancelled', 'No show', 'Visited']);
    fireEvent.change(select, { target: { value: 'no_show' } });
    fireEvent.click(within(first).getByRole('button', { name: 'Save appointment status' }));
    await waitFor(() =>
      expect(mockedUpdateAppointmentStatus).toHaveBeenCalledWith(
        'clinic-1',
        'appointment-1',
        'no_show',
      ),
    );
    expect(await within(first).findByText('No show')).toBeInTheDocument();
    expect(within(second).getByText('Confirmed')).toBeInTheDocument();
    expect(within(first).getByText('First reason')).toBeInTheDocument();
    expect(within(first).getByText('Dr. Kumar')).toBeInTheDocument();
    expect(within(dialog).getByRole('status')).toHaveTextContent('Appointment status updated.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: /View details/ }));
    expect(
      within(historyRow(screen.getByRole('dialog'), 'First reason')).getByText('No show'),
    ).toBeInTheDocument();
  });

  it('keeps the existing status on failure and permits cancellation without saving', async () => {
    mockedUpdateAppointmentStatus.mockRejectedValue(new Error('Unable to save status.'));
    const dialog = await searchAndOpen();
    const row = historyRow(dialog, 'First reason');
    fireEvent.click(within(row).getByRole('button', { name: /Edit appointment status/ }));
    fireEvent.change(within(row).getByRole('combobox'), { target: { value: 'visited' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save appointment status' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Unable to save status.');
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel editing status' }));
    expect(within(row).getByText('Confirmed')).toBeInTheDocument();
    expect(mockedUpdateAppointmentStatus).toHaveBeenCalledOnce();
  });

  it('uses the appointment ID for a linked visit, updates both rows and preserves clinical notes', async () => {
    const visit: PatientHistoryItemApiRow = {
      ...appointment,
      kind: 'visit',
      id: 'visit-1',
      appointment_request_id: appointment.id,
      status: 'visited',
      reason_for_visit: 'Clinical visit',
      examination_notes: 'Original examination',
      diagnosis: 'Original diagnosis',
      advice: 'Original advice',
    };
    mockedUpdateAppointmentStatus.mockResolvedValue({
      appointment: { id: appointment.id, status: 'cancelled' },
    });
    const dialog = await searchAndOpen([{ ...appointment, status: 'visited' }, visit]);
    const visitRow = historyRow(dialog, 'Clinical visit');
    fireEvent.click(within(visitRow).getByRole('button', { name: /Edit appointment status/ }));
    fireEvent.change(within(visitRow).getByRole('combobox'), { target: { value: 'cancelled' } });
    fireEvent.click(within(visitRow).getByRole('button', { name: 'Save appointment status' }));
    await waitFor(() =>
      expect(mockedUpdateAppointmentStatus).toHaveBeenCalledWith(
        'clinic-1',
        appointment.id,
        'cancelled',
      ),
    );
    await waitFor(() => expect(within(dialog).getAllByText('Cancelled')).toHaveLength(2));
    expect(within(visitRow).getByText('Original examination')).toBeInTheDocument();
    expect(within(visitRow).getByText('Original diagnosis')).toBeInTheDocument();
    expect(within(visitRow).getByText('Original advice')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.getByText('No completed visit yet')).toBeInTheDocument();
  });

  it('keeps unlinked visit records read-only', async () => {
    const dialog = await searchAndOpen([
      { ...appointment, kind: 'visit', id: 'standalone-visit', status: 'visited' },
    ]);
    expect(
      within(dialog).queryByRole('button', { name: /Edit appointment status/ }),
    ).not.toBeInTheDocument();
  });

  it('shows visited appointment corrections without inventing clinical details', async () => {
    mockedUpdateAppointmentStatus.mockResolvedValue({
      appointment: { id: appointment.id, status: 'visited' },
    });
    const dialog = await searchAndOpen([appointment]);
    const row = historyRow(dialog, 'First reason');
    fireEvent.click(within(row).getByRole('button', { name: /Edit appointment status/ }));
    fireEvent.change(within(row).getByRole('combobox'), { target: { value: 'visited' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save appointment status' }));
    await waitFor(() => expect(within(row).queryByRole('combobox')).not.toBeInTheDocument());
    expect(within(row).getByText('Visited')).toBeInTheDocument();
    expect(within(row).getAllByText('Not recorded')).toHaveLength(3);
    expect(within(row).getByText('Appointment')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.getByText(/Last visited:/)).toBeInTheDocument();
  });

  it('keeps history read-only for doctors', async () => {
    effectiveRole = 'doctor';
    const dialog = await searchAndOpen();
    expect(
      within(dialog).queryByRole('button', { name: /Edit appointment status/ }),
    ).not.toBeInTheDocument();
  });

  it('prevents duplicate saves and ignores a save response after a new search', async () => {
    let finishSave!: (value: Awaited<ReturnType<typeof updateAppointmentStatus>>) => void;
    mockedUpdateAppointmentStatus.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        }),
    );
    const dialog = await searchAndOpen();
    const row = historyRow(dialog, 'First reason');
    fireEvent.click(within(row).getByRole('button', { name: /Edit appointment status/ }));
    fireEvent.change(within(row).getByRole('combobox'), { target: { value: 'no_show' } });
    const save = within(row).getByRole('button', { name: 'Save appointment status' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mockedUpdateAppointmentStatus).toHaveBeenCalledOnce();
    mockedSearchPatientHistory.mockResolvedValue([
      { ...patient, name: 'New search patient', history: [] },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Search History' }));
    expect(await screen.findByText('New search patient')).toBeInTheDocument();
    await act(async () => finishSave({ appointment: { id: appointment.id, status: 'no_show' } }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Appointment status updated.')).not.toBeInTheDocument();
    expect(screen.getByText('New search patient')).toBeInTheDocument();
  });
});
