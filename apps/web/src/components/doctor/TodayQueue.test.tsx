import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TodayQueue } from './TodayQueue';
import {
  fetchAppointments,
  markAppointmentVisited,
  type AppointmentApiRow,
} from '@/lib/api/appointments';
import {
  fetchClinicHours,
  fetchDoctorSchedules,
  fetchDoctorServices,
  fetchHolidays,
  fetchServices,
} from '@/lib/api/clinic-clinical';

const { auth, profile, setPatientCount } = vi.hoisted(() => {
  const membership = {
    clinic_id: 'clinic-1',
    doctor_id: 'doctor-1' as string | null,
    role: 'doctor',
    active: true,
  };
  return {
    auth: {
      status: 'authenticated',
      effectiveRole: 'doctor',
      clinicRole: membership as typeof membership | null,
      me: { user: { name: 'Doctor' }, clinics: [membership] },
    },
    profile: { status: 'ready', profile: { timezone: 'Asia/Kolkata' } },
    setPatientCount: vi.fn(),
  };
});
vi.mock('@/components/auth/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('@/components/clinic/ClinicProfileProvider', () => ({ useClinicProfile: () => profile }));
vi.mock('@/hooks/useActiveClinicId', () => ({ useActiveClinicId: () => 'clinic-1' }));
vi.mock('./DoctorLayout', () => ({ useDoctorNav: () => ({ setPatientCount }) }));
vi.mock('@/lib/api/appointments', () => ({
  fetchAppointments: vi.fn(),
  markAppointmentVisited: vi.fn(),
}));
vi.mock('@/lib/api/clinic-clinical', () => ({
  fetchClinicHours: vi.fn(),
  fetchDoctorSchedules: vi.fn(),
  fetchDoctorServices: vi.fn(),
  fetchHolidays: vi.fn(),
  fetchServices: vi.fn(),
}));

function appointment(patch: Partial<AppointmentApiRow> = {}): AppointmentApiRow {
  return {
    id: 'appointment-1',
    patient_name: 'Arun Kumar',
    patient_phone: '+91 98400 12345',
    doctor_id: 'doctor-1',
    doctor_name: 'Dr. Database',
    clinic_service_id: 'service-1',
    service_name: 'Skin Consultation',
    appointment_start: '2026-11-16 11:00:00',
    appointment_end: '2026-11-16 11:30:00',
    reason_for_visit: 'Persisted concern',
    visit_type: 'new',
    routing_source: null,
    source: 'manual',
    status: 'confirmed',
    created_at: '2026-11-15T10:00:00.000Z',
    has_history: false,
    patient_age: null,
    patient_gender: null,
    ...patch,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-16T10:00:00.000Z'));
  const membership = { clinic_id: 'clinic-1', doctor_id: 'doctor-1', role: 'doctor', active: true };
  auth.clinicRole = membership;
  auth.me.clinics = [membership];
  profile.status = 'ready';
  profile.profile.timezone = 'Asia/Kolkata';
  vi.mocked(fetchAppointments).mockReset().mockResolvedValue([]);
  vi.mocked(markAppointmentVisited)
    .mockReset()
    .mockResolvedValue({ appointment: {}, patient_visit: {} });
  vi.mocked(fetchClinicHours)
    .mockReset()
    .mockResolvedValue([
      { id: 'hours-1', day_of_week: 1, start_time: '09:00', end_time: '18:00', active: true },
      { id: 'hours-2', day_of_week: 2, start_time: '10:00', end_time: '20:00', active: true },
    ]);
  vi.mocked(fetchDoctorSchedules)
    .mockReset()
    .mockResolvedValue([
      {
        id: 'schedule-1',
        doctor_id: 'doctor-1',
        day_of_week: 1,
        start_time: '10:30',
        end_time: '14:00',
        active: true,
      },
      {
        id: 'schedule-2',
        doctor_id: 'doctor-1',
        day_of_week: 2,
        start_time: '15:00',
        end_time: '17:30',
        active: true,
      },
    ]);
  vi.mocked(fetchHolidays).mockReset().mockResolvedValue([]);
  vi.mocked(fetchDoctorServices)
    .mockReset()
    .mockResolvedValue([
      {
        id: 'mapping-1',
        doctor_id: 'doctor-1',
        clinic_service_id: 'service-1',
        consultation_fee_amount: null,
        active: true,
      },
      {
        id: 'mapping-2',
        doctor_id: 'doctor-2',
        clinic_service_id: 'service-2',
        consultation_fee_amount: null,
        active: true,
      },
    ]);
  vi.mocked(fetchServices)
    .mockReset()
    .mockResolvedValue([
      {
        id: 'service-1',
        service_name: 'Skin Consultation',
        service_key: 'dermatology_consultation',
        active: true,
      },
      {
        id: 'service-2',
        service_name: 'Other Doctor Service',
        service_key: 'general_consultation',
        active: true,
      },
    ]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function settledQueue() {
  await waitFor(() => expect(fetchAppointments).toHaveBeenCalled());
  await screen.findByText(/10:30 AM – 0?2:00 PM/);
}

describe('database-backed doctor dashboard', () => {
  it('shows the real title, own schedule/service and database appointment counts', async () => {
    vi.mocked(fetchAppointments).mockResolvedValue([
      appointment(),
      appointment({
        id: 'appointment-2',
        patient_name: 'Visited Patient',
        status: 'visited',
        appointment_start: '2026-11-16 12:00:00',
      }),
      appointment({
        id: 'appointment-other',
        patient_name: 'Another Doctor Patient',
        doctor_id: 'doctor-2',
      }),
    ]);
    render(<TodayQueue />);
    await settledQueue();
    expect(fetchAppointments).toHaveBeenCalledWith(
      'clinic-1',
      ['confirmed', 'visited'],
      expect.any(AbortSignal),
      '2026-11-16',
    );
    expect(fetchDoctorSchedules).toHaveBeenCalledWith(
      'clinic-1',
      'doctor-1',
      expect.any(AbortSignal),
    );
    expect(screen.getByRole('heading', { name: "Today's Queue" })).toBeInTheDocument();
    expect(screen.getByText('Skin Consultation')).toBeInTheDocument();
    expect(screen.queryByText('Another Doctor Patient')).not.toBeInTheDocument();
    expect(screen.queryByText('Other Doctor Service')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Morning 9AM|Evening 5PM|Morning shift|Orthopaedic|Today&apos;/),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Confirmed', { exact: true }).parentElement).toHaveTextContent('1');
    expect(screen.getByText('Total', { exact: true }).parentElement).toHaveTextContent('2');
    fireEvent.click(screen.getByRole('button', { name: /Start Consultation/ }));
    expect(screen.getByText('Confirmed', { exact: true }).parentElement).toHaveTextContent('1');
    expect(screen.getByText('Total', { exact: true }).parentElement).toHaveTextContent('2');
  });
  it('fetches each selected day and refreshes on focus instead of using stale cached rows', async () => {
    render(<TodayQueue />);
    await settledQueue();
    fireEvent.change(screen.getByLabelText(/Appointment date/i), {
      target: { value: '2026-11-17' },
    });
    await waitFor(() =>
      expect(fetchAppointments).toHaveBeenLastCalledWith(
        'clinic-1',
        ['confirmed', 'visited'],
        expect.any(AbortSignal),
        '2026-11-17',
      ),
    );
    await screen.findByText(/0?3:00 PM – 0?5:30 PM/);
    expect(screen.getByRole('heading', { name: 'Appointment Queue' })).toBeInTheDocument();
    const previousCount = vi.mocked(fetchAppointments).mock.calls.length;
    fireEvent(window, new Event('focus'));
    await waitFor(() =>
      expect(vi.mocked(fetchAppointments).mock.calls.length).toBeGreaterThan(previousCount),
    );
    expect(fetchAppointments).toHaveBeenLastCalledWith(
      'clinic-1',
      ['confirmed', 'visited'],
      expect.any(AbortSignal),
      '2026-11-17',
    );
  });
  it('uses the saved holiday instead of inventing working shifts', async () => {
    vi.mocked(fetchHolidays).mockResolvedValue([
      {
        id: 'holiday-1',
        holiday_date: '2026-11-16',
        reason: 'Clinic closed',
        is_full_day: true,
        active: true,
        applies_to_clinic: true,
        doctor_ids: [],
      },
    ]);
    render(<TodayQueue />);
    await waitFor(() => expect(fetchHolidays).toHaveBeenCalled());
    expect(await screen.findByText(/holiday|closed/i)).toBeInTheDocument();
    expect(screen.queryByText(/10:30 AM – 0?2:00 PM/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Morning shift|Evening 5PM/)).not.toBeInTheDocument();
  });
  it('fails closed without an active linked doctor instead of loading clinic-wide data', async () => {
    auth.clinicRole = null;
    auth.me.clinics = [];
    render(<TodayQueue />);
    expect(
      await screen.findByText(/doctor profile|doctor account|doctor context/i),
    ).toBeInTheDocument();
    expect(fetchAppointments).not.toHaveBeenCalled();
    expect(fetchDoctorSchedules).not.toHaveBeenCalled();
    expect(screen.queryByText(/0 appointments/)).not.toBeInTheDocument();
  });
  it('distinguishes pending data from an actual empty dashboard', () => {
    vi.mocked(fetchAppointments).mockReturnValue(new Promise(() => {}));
    render(<TodayQueue />);
    expect(screen.queryByText(/0 appointments/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No confirmed or visited appointments/)).not.toBeInTheDocument();
    expect(screen.queryByText('Total', { exact: true })).not.toBeInTheDocument();
  });
  it('does not replace a request failure with zero appointments', async () => {
    vi.mocked(fetchAppointments).mockRejectedValue(new Error('Queue unavailable'));
    render(<TodayQueue />);
    expect(await screen.findByText('Queue unavailable')).toBeInTheDocument();
    expect(
      screen.queryByText(/0 appointments|No confirmed or visited appointments/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Total', { exact: true })).not.toBeInTheDocument();
  });
  it('never fills missing demographics or clinical details from a matching demo patient', async () => {
    vi.mocked(fetchAppointments).mockResolvedValue([appointment({ has_history: true })]);
    render(<TodayQueue />);
    await settledQueue();
    fireEvent.click(screen.getByRole('button', { name: /Start Consultation/ }));
    expect(
      screen.getByText('Clinical history is available in Patient History.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/52y|52 yrs|Male|Osteoarthritis|Diclofenac|ROM improved/),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Diagnosis')).toHaveValue('');
    expect(screen.getByLabelText('Findings / Notes')).toHaveValue('');
    expect(screen.getByLabelText('Advice')).toHaveValue('');
  });
  it('keeps examination saving and visited details tied to the actual appointment', async () => {
    vi.mocked(fetchAppointments).mockResolvedValue([
      appointment({ patient_age: 37, patient_gender: 'female' }),
    ]);
    render(<TodayQueue />);
    await settledQueue();
    fireEvent.click(screen.getByRole('button', { name: /Start Consultation/ }));
    fireEvent.change(screen.getByLabelText('Findings / Notes'), {
      target: { value: 'Recorded findings' },
    });
    fireEvent.change(screen.getByLabelText('Diagnosis'), {
      target: { value: 'Recorded diagnosis' },
    });
    fireEvent.change(screen.getByLabelText('Advice'), { target: { value: 'Recorded advice' } });
    fireEvent.click(screen.getByRole('button', { name: /Mark as Visited/ }));
    await waitFor(() =>
      expect(markAppointmentVisited).toHaveBeenCalledWith('clinic-1', 'appointment-1', {
        visit_reason: 'Recorded findings',
        examination_notes: 'Recorded findings',
        diagnosis: 'Recorded diagnosis',
        advice: 'Recorded advice',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Mark as Visited/ })).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText('Arun Kumar'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Examination Notes').parentElement).toHaveTextContent(
      'Recorded findings',
    );
    expect(within(dialog).getByText('Recorded diagnosis')).toBeInTheDocument();
    expect(within(dialog).getByText('Recorded advice')).toBeInTheDocument();
    expect(within(dialog).getByText('Dr. Database')).toBeInTheDocument();
  });
  it('keeps an unsaved consultation mounted during a same-day background refresh', async () => {
    let resolveRefresh!: (rows: AppointmentApiRow[]) => void;
    const refreshed = new Promise<AppointmentApiRow[]>((resolve) => {
      resolveRefresh = resolve;
    });
    vi.mocked(fetchAppointments)
      .mockResolvedValueOnce([appointment()])
      .mockReturnValueOnce(refreshed);
    render(<TodayQueue />);
    await settledQueue();
    fireEvent.click(screen.getByRole('button', { name: /Start Consultation/ }));
    const notes = screen.getByLabelText('Findings / Notes');
    const diagnosis = screen.getByLabelText('Diagnosis');
    const advice = screen.getByLabelText('Advice');
    fireEvent.change(notes, { target: { value: 'Unsaved examination' } });
    fireEvent.change(diagnosis, { target: { value: 'Unsaved diagnosis' } });
    fireEvent.change(advice, { target: { value: 'Unsaved advice' } });
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(fetchAppointments).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Findings / Notes')).toBe(notes);
    expect(screen.getByLabelText('Diagnosis')).toBe(diagnosis);
    expect(screen.getByLabelText('Advice')).toBe(advice);
    expect(notes).toHaveValue('Unsaved examination');
    expect(diagnosis).toHaveValue('Unsaved diagnosis');
    expect(advice).toHaveValue('Unsaved advice');
    expect(screen.queryByRole('heading', { name: /^0 appointments/ })).not.toBeInTheDocument();
    await act(async () => resolveRefresh([appointment()]));
    expect(screen.getByLabelText('Findings / Notes')).toBe(notes);
    expect(screen.getByLabelText('Diagnosis')).toBe(diagnosis);
    expect(screen.getByLabelText('Advice')).toBe(advice);
    expect(notes).toHaveValue('Unsaved examination');
    expect(diagnosis).toHaveValue('Unsaved diagnosis');
    expect(advice).toHaveValue('Unsaved advice');
    expect(markAppointmentVisited).not.toHaveBeenCalled();
  });

  it('does not let an older background response revive a just-completed appointment', async () => {
    let resolveRefresh!: (rows: AppointmentApiRow[]) => void;
    const refreshed = new Promise<AppointmentApiRow[]>((resolve) => {
      resolveRefresh = resolve;
    });
    vi.mocked(fetchAppointments)
      .mockResolvedValueOnce([appointment()])
      .mockReturnValueOnce(refreshed);
    render(<TodayQueue />);
    await settledQueue();
    fireEvent.click(screen.getByRole('button', { name: /Start Consultation/ }));
    fireEvent.change(screen.getByLabelText('Findings / Notes'), {
      target: { value: 'Final saved examination' },
    });
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(fetchAppointments).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: /Mark as Visited/ }));
    await waitFor(() =>
      expect(markAppointmentVisited).toHaveBeenCalledWith('clinic-1', 'appointment-1', {
        visit_reason: 'Final saved examination',
        examination_notes: 'Final saved examination',
      }),
    );
    const summary = screen.getByRole('region', { name: 'Appointment summary' });
    await waitFor(() =>
      expect(within(summary).getByText('Visited', { exact: true }).parentElement).toHaveTextContent(
        '1',
      ),
    );
    await act(async () => resolveRefresh([appointment()]));
    expect(within(summary).getByText('Visited', { exact: true }).parentElement).toHaveTextContent(
      '1',
    );
    expect(within(summary).getByText('Confirmed', { exact: true }).parentElement).toHaveTextContent(
      '0',
    );
    expect(within(summary).getByText('Total', { exact: true }).parentElement).toHaveTextContent(
      '1',
    );
    expect(screen.queryByRole('button', { name: /Start Consultation/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Arun Kumar'));
    expect(
      within(screen.getByRole('dialog')).getByText('Examination Notes').parentElement,
    ).toHaveTextContent('Final saved examination');
  });

  it('clears one patient unsaved examination when starting another patient consultation', async () => {
    vi.mocked(fetchAppointments).mockResolvedValue([
      appointment(),
      appointment({
        id: 'appointment-2',
        patient_name: 'Second Patient',
        patient_phone: '9999999999',
        appointment_start: '2026-11-16 12:00:00',
      }),
    ]);
    render(<TodayQueue />);
    await settledQueue();
    const firstCard = screen.getByText('Arun Kumar').closest('article')!;
    fireEvent.click(within(firstCard).getByRole('button', { name: /Start Consultation/ }));
    const oldNotes = screen.getByLabelText('Findings / Notes');
    fireEvent.change(oldNotes, { target: { value: 'Private notes for the first patient' } });
    fireEvent.change(screen.getByLabelText('Diagnosis'), {
      target: { value: 'First patient diagnosis' },
    });
    fireEvent.change(screen.getByLabelText('Advice'), {
      target: { value: 'First patient advice' },
    });
    const secondCard = screen.getByText('Second Patient').closest('article')!;
    fireEvent.click(within(secondCard).getByRole('button', { name: /Start Consultation/ }));
    expect(screen.getByLabelText('Findings / Notes')).not.toBe(oldNotes);
    expect(screen.getByLabelText('Findings / Notes')).toHaveValue('');
    expect(screen.getByLabelText('Diagnosis')).toHaveValue('');
    expect(screen.getByLabelText('Advice')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: /Mark as Visited/ }));
    await waitFor(() =>
      expect(markAppointmentVisited).toHaveBeenCalledWith('clinic-1', 'appointment-2', {
        visit_reason: 'Persisted concern',
      }),
    );
  });

  it('chooses today in the clinic timezone and advances at the clinic date rollover', async () => {
    vi.setSystemTime(new Date('2026-11-16T20:00:00.000Z'));
    render(<TodayQueue />);
    await waitFor(() =>
      expect(fetchAppointments).toHaveBeenLastCalledWith(
        'clinic-1',
        ['confirmed', 'visited'],
        expect.any(AbortSignal),
        '2026-11-17',
      ),
    );
    expect(screen.getByLabelText(/Appointment date/i)).toHaveValue('2026-11-17');
    expect(await screen.findByText(/0?3:00 PM – 0?5:30 PM/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "Today's Queue" })).toBeInTheDocument();
    await act(async () => {
      vi.setSystemTime(new Date('2026-11-17T20:00:00.000Z'));
      fireEvent(window, new Event('focus'));
    });
    await waitFor(() =>
      expect(fetchAppointments).toHaveBeenLastCalledWith(
        'clinic-1',
        ['confirmed', 'visited'],
        expect.any(AbortSignal),
        '2026-11-18',
      ),
    );
  });
});
