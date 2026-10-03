import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppointmentsPageContent } from '@/components/pages/AppointmentsPageContent';
import type { AppointmentActivityApiRow, AppointmentApiRow } from '@/lib/api/appointments';
import {
  fetchAppointments,
  fetchAppointmentActionRequests,
  fetchAppointmentActivity,
  fetchAvailableAppointmentSlots,
  markAppointmentVisited,
  rescheduleAppointment,
} from '@/lib/api/appointments';
import { fetchDoctorServices, fetchDoctors, fetchServices } from '@/lib/api/clinic-clinical';
import { fetchClinicSettings } from '@/lib/api/clinic-settings';
import { getClinicDate } from '@/lib/home-dashboard';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const SECOND_CLINIC_ID = '00000000-0000-0000-0000-000000000002';
let effectiveRole: 'admin' | 'doctor' = 'admin';
let activeClinicId = CLINIC_ID;

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    effectiveRole,
  }),
}));

vi.mock('@/components/clinic/ClinicProfileProvider', () => ({
  useClinicProfile: () => ({
    profile: { timezone: 'Asia/Kolkata' },
    status: 'ready',
  }),
}));

vi.mock('@/hooks/useActiveClinicId', () => ({
  useActiveClinicId: () => activeClinicId,
}));

vi.mock('@/lib/api/appointments', () => ({
  fetchAppointments: vi.fn(),
  fetchAvailableAppointmentSlots: vi.fn(),
  fetchAppointmentActionRequests: vi.fn().mockResolvedValue([]),
  fetchAppointmentActivity: vi.fn().mockResolvedValue([]),
  cancelAppointment: vi.fn(),
  confirmAppointment: vi.fn(),
  createManualAppointment: vi.fn(),
  markAppointmentVisited: vi.fn(),
  rescheduleAppointment: vi.fn(),
  resolveAppointmentActionRequest: vi.fn(),
}));

vi.mock('@/lib/api/clinic-clinical', () => ({
  fetchDoctorServices: vi.fn().mockResolvedValue([]),
  fetchDoctors: vi.fn().mockResolvedValue([]),
  fetchServices: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/api/clinic-settings', () => ({
  fetchClinicSettings: vi.fn().mockResolvedValue({
    allow_doctor_service_edit: false,
  }),
}));

vi.mock('@/components/pages/appointments/PendingAppointments', () => ({
  PendingAppointments: ({
    appointments,
  }: {
    appointments: Array<{ id: string; patientName: string }>;
  }) => (
    <section aria-label="Pending confirmation">
      {appointments.map((appointment) => (
        <p key={appointment.id}>{appointment.patientName}</p>
      ))}
    </section>
  ),
}));

vi.mock('@/components/pages/appointments/VisitedPatients', () => ({
  VisitedPatients: ({
    appointments,
  }: {
    appointments: Array<{ id: string; patientName: string }>;
  }) => (
    <section aria-label="Visited appointments">
      {appointments.map((appointment) => (
        <p key={appointment.id}>{appointment.patientName}</p>
      ))}
    </section>
  ),
}));

vi.mock('@/components/pages/appointments/MissedAppointments', () => ({
  MissedAppointments: ({
    appointments,
  }: {
    appointments: Array<{ id: string; patientName: string }>;
  }) => (
    <section aria-label="Missed actions">
      {appointments.map((appointment) => (
        <p key={appointment.id}>{appointment.patientName}</p>
      ))}
    </section>
  ),
}));

vi.mock('@/components/pages/appointments/RescheduleCancelRequests', () => ({
  RescheduleCancelRequests: ({
    activities,
  }: {
    activities: Array<{ id: string; patientName: string }>;
  }) => (
    <section aria-label="Appointment requests">
      {activities.map((activity) => (
        <p key={activity.id}>{activity.patientName}</p>
      ))}
    </section>
  ),
}));

vi.mock('@/components/pages/appointments/ManualAppointmentModal', () => ({
  ManualAppointmentModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div role="dialog" aria-label="New manual appointment">
        Manual appointment modal
        <button type="button" onClick={onClose}>
          Close manual appointment
        </button>
      </div>
    ) : null,
}));

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days))
    .toISOString()
    .slice(0, 10);
}

function appointmentRow(
  id: string,
  patientName: string,
  date: string,
  status = 'pending_confirmation',
  time = '09:00:00',
): AppointmentApiRow {
  return {
    id,
    patient_name: patientName,
    patient_phone: '9876543210',
    doctor_id: '00000000-0000-0000-0000-000000000201',
    doctor_name: 'Doctor',
    clinic_service_id: '00000000-0000-0000-0000-000000000301',
    service_name: 'Consultation',
    appointment_start: `${date} ${time}`,
    appointment_end: `${date} ${time === '09:00:00' ? '09:30:00' : '10:30:00'}`,
    reason_for_visit: 'Checkup',
    visit_type: 'new',
    routing_source: 'voice_bot',
    source: 'agent',
    status,
    has_history: false,
  };
}

function appointmentActivityRow(
  id: string,
  patientName: string,
  actionType: 'reschedule' | 'cancel',
  previousDate: string,
  date: string,
): AppointmentActivityApiRow {
  return {
    id,
    appointment_id: `appointment-${id}`,
    patient_name: patientName,
    patient_phone: '9876543210',
    doctor_id: '00000000-0000-0000-0000-000000000201',
    doctor_name: 'Doctor',
    clinic_service_id: '00000000-0000-0000-0000-000000000301',
    service_name: 'Consultation',
    reason_for_visit: 'Checkup',
    action_type: actionType,
    occurred_at: `${date}T08:00:00.000Z`,
    previous_appointment_start: `${previousDate} 09:00:00`,
    previous_appointment_end: `${previousDate} 09:30:00`,
    appointment_start: `${date} 10:00:00`,
    appointment_end: `${date} 10:30:00`,
  };
}

const mockedFetchAppointments = vi.mocked(fetchAppointments);
const mockedFetchAppointmentActionRequests = vi.mocked(fetchAppointmentActionRequests);
const mockedFetchAppointmentActivity = vi.mocked(fetchAppointmentActivity);
const mockedFetchAvailableAppointmentSlots = vi.mocked(fetchAvailableAppointmentSlots);
const mockedMarkAppointmentVisited = vi.mocked(markAppointmentVisited);
const mockedRescheduleAppointment = vi.mocked(rescheduleAppointment);
const mockedFetchClinicSettings = vi.mocked(fetchClinicSettings);
const mockedFetchDoctors = vi.mocked(fetchDoctors);
const mockedFetchServices = vi.mocked(fetchServices);
const mockedFetchDoctorServices = vi.mocked(fetchDoctorServices);

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  effectiveRole = 'admin';
  activeClinicId = CLINIC_ID;
  mockedFetchAppointments.mockReset();
  mockedFetchAppointmentActionRequests.mockReset();
  mockedFetchAppointmentActionRequests.mockResolvedValue([]);
  mockedFetchAppointmentActivity.mockReset();
  mockedFetchAppointmentActivity.mockResolvedValue([]);
  mockedFetchAvailableAppointmentSlots.mockReset();
  mockedMarkAppointmentVisited.mockReset();
  mockedRescheduleAppointment.mockReset();
  mockedFetchClinicSettings.mockReset();
  mockedFetchClinicSettings.mockResolvedValue({
    clinic_id: CLINIC_ID,
    agent_enabled: false,
    answering_mode: 'always',
    fallback_phone: null,
    overflow_after_rings: null,
    booking_mode: 'request',
    max_concurrent_calls: 1,
    recording_retention_days: 30,
    transcript_retention_days: 30,
    notify_staff_on_pending_appointment: false,
    pending_appointment_notification_channel: null,
    allow_doctor_service_edit: false,
    allow_patient_auto_cancel: false,
  });
  mockedFetchDoctors.mockReset();
  mockedFetchDoctors.mockResolvedValue([]);
  mockedFetchServices.mockReset();
  mockedFetchServices.mockResolvedValue([]);
  mockedFetchDoctorServices.mockReset();
  mockedFetchDoctorServices.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe('AppointmentsPageContent', () => {
  it('separates missed confirmations from current and future pending appointments', async () => {
    const clinicToday = getClinicDate(new Date(), 'Asia/Kolkata');
    mockedFetchAppointments.mockResolvedValue([
      appointmentRow('past', 'Past pending patient', shiftDate(clinicToday, -1)),
      appointmentRow('today', 'Today pending patient', clinicToday),
      appointmentRow('future', 'Future pending patient', shiftDate(clinicToday, 1)),
    ]);

    render(<AppointmentsPageContent />);

    const pending = await screen.findByRole('region', { name: 'Pending confirmation' });
    const missed = screen.getByRole('region', { name: 'Missed actions' });

    expect(within(pending).getByText('Today pending patient')).toBeInTheDocument();
    expect(within(pending).getByText('Future pending patient')).toBeInTheDocument();
    expect(within(pending).queryByText('Past pending patient')).not.toBeInTheDocument();
    expect(within(missed).getByText('Past pending patient')).toBeInTheDocument();
  });

  it('shows only today and future appointments in the confirmed block', async () => {
    const clinicToday = getClinicDate(new Date(), 'Asia/Kolkata');
    mockedFetchAppointments.mockResolvedValue([
      appointmentRow('past', 'Past confirmed patient', shiftDate(clinicToday, -1), 'confirmed'),
      appointmentRow('today', 'Today confirmed patient', clinicToday, 'confirmed'),
      appointmentRow('future', 'Future confirmed patient', shiftDate(clinicToday, 1), 'confirmed'),
    ]);

    render(<AppointmentsPageContent />);

    expect(await screen.findByText('Today confirmed patient')).toBeInTheDocument();
    expect(screen.getByText('Future confirmed patient')).toBeInTheDocument();
    expect(screen.queryByText('Past confirmed patient')).not.toBeInTheDocument();
  });

  it('marks a confirmed appointment visited, prevents duplicate saves, and refetches it into Visited', async () => {
    const clinicToday = getClinicDate(new Date(), 'Asia/Kolkata');
    let resolveMarkVisited:
      | ((value: { appointment: unknown; patient_visit: unknown }) => void)
      | undefined;

    mockedFetchAppointments
      .mockResolvedValueOnce([
        appointmentRow('confirmed-1', 'Visited transition patient', clinicToday, 'confirmed'),
      ])
      .mockResolvedValueOnce([
        appointmentRow('confirmed-1', 'Visited transition patient', clinicToday, 'visited'),
      ]);
    mockedMarkAppointmentVisited.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMarkVisited = resolve;
        }),
    );

    render(<AppointmentsPageContent />);

    expect(await screen.findByText('Visited transition patient')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Mark Visited/i }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Visit reason' }), {
      target: { value: 'Routine consultation completed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Visit' }));

    const savingButton = await screen.findByRole('button', { name: 'Saving Visit…' });
    expect(savingButton).toBeDisabled();
    fireEvent.click(savingButton);
    expect(mockedMarkAppointmentVisited).toHaveBeenCalledTimes(1);
    expect(mockedMarkAppointmentVisited).toHaveBeenCalledWith(CLINIC_ID, 'confirmed-1', {
      visit_reason: 'Routine consultation completed',
    });

    await act(async () => {
      resolveMarkVisited?.({ appointment: {}, patient_visit: {} });
    });

    const visited = screen.getByRole('region', { name: 'Visited appointments' });
    await waitFor(() => {
      expect(mockedFetchAppointments).toHaveBeenCalledTimes(2);
      expect(within(visited).getByText('Visited transition patient')).toBeInTheDocument();
    });
    const confirmed = screen.getByRole('heading', { name: 'Confirmed appointments' }).parentElement;
    expect(confirmed).not.toBeNull();
    expect(within(confirmed as HTMLElement).queryByText('Visited transition patient')).toBeNull();
  });

  it('keeps the mark-visited form open and exposes the API error when saving fails', async () => {
    const clinicToday = getClinicDate(new Date(), 'Asia/Kolkata');
    mockedFetchAppointments.mockResolvedValue([
      appointmentRow('confirmed-1', 'Failed visit patient', clinicToday, 'confirmed'),
    ]);
    mockedMarkAppointmentVisited.mockRejectedValue(new Error('Visit update failed.'));

    render(<AppointmentsPageContent />);

    expect(await screen.findByText('Failed visit patient')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Mark Visited/i }));
    const visitReason = screen.getByRole('textbox', { name: 'Visit reason' });
    fireEvent.change(visitReason, { target: { value: 'Consultation completed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Visit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Visit update failed.');
    expect(visitReason).toHaveValue('Consultation completed');
    expect(visitReason).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save Visit' })).toBeEnabled();
    expect(mockedFetchAppointments).toHaveBeenCalledTimes(1);
  });

  it('looks up a free slot and saves an edited confirmed appointment time', async () => {
    const clinicToday = getClinicDate(new Date(), 'Asia/Kolkata');
    mockedFetchAppointments
      .mockResolvedValueOnce([
        appointmentRow('confirmed-1', 'Confirmed patient', clinicToday, 'confirmed'),
      ])
      .mockResolvedValueOnce([
        appointmentRow('confirmed-1', 'Confirmed patient', clinicToday, 'confirmed', '10:00:00'),
      ]);
    mockedFetchAvailableAppointmentSlots.mockResolvedValue([
      {
        slot_id: 'slot-10am',
        doctor_id: '00000000-0000-0000-0000-000000000201',
        clinic_service_id: '00000000-0000-0000-0000-000000000301',
        appointment_start: `${clinicToday} 10:00:00`,
        appointment_end: `${clinicToday} 10:30:00`,
        available_count: 1,
      },
    ]);
    mockedRescheduleAppointment.mockResolvedValue({ appointment: {} });

    render(<AppointmentsPageContent />);

    expect(await screen.findByText('Confirmed patient')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Time' }));
    fireEvent.change(screen.getByDisplayValue('09:00'), { target: { value: '10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockedFetchAvailableAppointmentSlots).toHaveBeenCalledWith(
        CLINIC_ID,
        {
          doctor_id: '00000000-0000-0000-0000-000000000201',
          clinic_service_id: '00000000-0000-0000-0000-000000000301',
          date: clinicToday,
        },
        expect.any(AbortSignal),
      );
      expect(mockedRescheduleAppointment).toHaveBeenCalledWith(
        CLINIC_ID,
        'confirmed-1',
        'slot-10am',
      );
    });
    await waitFor(() => {
      expect(screen.queryByDisplayValue('10:00')).not.toBeInTheDocument();
      expect(screen.getByText('10:00 AM')).toBeInTheDocument();
    });
  });

  it('shows a slot-full conflict and keeps the time editor open', async () => {
    const clinicToday = getClinicDate(new Date(), 'Asia/Kolkata');
    mockedFetchAppointments.mockResolvedValue([
      appointmentRow('confirmed-1', 'Confirmed patient', clinicToday, 'confirmed'),
    ]);
    mockedFetchAvailableAppointmentSlots.mockResolvedValue([]);

    render(<AppointmentsPageContent />);

    expect(await screen.findByText('Confirmed patient')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Time' }));
    fireEvent.change(screen.getByDisplayValue('09:00'), { target: { value: '10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Slot is full for that time. Choose another available time.'),
    ).toHaveAttribute('role', 'alert');
    expect(screen.getByDisplayValue('10:00')).toBeInTheDocument();
    expect(mockedRescheduleAppointment).not.toHaveBeenCalled();
  });

  it('looks up availability on the edited date before rescheduling', async () => {
    const clinicToday = getClinicDate(new Date(), 'Asia/Kolkata');
    const newDate = shiftDate(clinicToday, 2);
    mockedFetchAppointments
      .mockResolvedValueOnce([
        appointmentRow('confirmed-1', 'Cross-date patient', clinicToday, 'confirmed'),
      ])
      .mockResolvedValueOnce([
        appointmentRow('confirmed-1', 'Cross-date patient', newDate, 'confirmed', '10:00:00'),
      ]);
    mockedFetchAvailableAppointmentSlots.mockResolvedValue([
      {
        slot_id: 'future-slot-10am',
        doctor_id: '00000000-0000-0000-0000-000000000201',
        clinic_service_id: '00000000-0000-0000-0000-000000000301',
        appointment_start: `${newDate} 10:00:00`,
        appointment_end: `${newDate} 10:30:00`,
        available_count: 1,
      },
    ]);
    mockedRescheduleAppointment.mockResolvedValue({ appointment: {} });

    render(<AppointmentsPageContent />);

    expect(await screen.findByText('Cross-date patient')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Time' }));
    fireEvent.change(screen.getByLabelText('Appointment date'), {
      target: { value: newDate },
    });
    fireEvent.change(screen.getByLabelText('Appointment time'), {
      target: { value: '10:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockedFetchAvailableAppointmentSlots).toHaveBeenCalledWith(
        CLINIC_ID,
        {
          doctor_id: '00000000-0000-0000-0000-000000000201',
          clinic_service_id: '00000000-0000-0000-0000-000000000301',
          date: newDate,
        },
        expect.any(AbortSignal),
      );
      expect(mockedRescheduleAppointment).toHaveBeenCalledWith(
        CLINIC_ID,
        'confirmed-1',
        'future-slot-10am',
      );
    });
  });

  it('maps completed appointment activity into the requests block', async () => {
    const clinicToday = getClinicDate(new Date(), 'Asia/Kolkata');
    mockedFetchAppointments.mockResolvedValue([]);
    mockedFetchAppointmentActivity.mockResolvedValue([
      appointmentActivityRow(
        'activity-1',
        'Rescheduled activity patient',
        'reschedule',
        clinicToday,
        shiftDate(clinicToday, 1),
      ),
    ]);

    render(<AppointmentsPageContent />);

    const activityBlock = await screen.findByRole('region', { name: 'Appointment requests' });
    expect(within(activityBlock).getByText('Rescheduled activity patient')).toBeInTheDocument();
  });

  it('shows completed activity only within its three-day retention window', async () => {
    const clinicToday = getClinicDate(new Date(), 'Asia/Kolkata');
    mockedFetchAppointments.mockResolvedValue([]);
    mockedFetchAppointmentActivity.mockResolvedValue([
      appointmentActivityRow(
        'cancel-retained',
        'Retained cancellation',
        'cancel',
        shiftDate(clinicToday, -5),
        shiftDate(clinicToday, -3),
      ),
      appointmentActivityRow(
        'cancel-expired',
        'Expired cancellation',
        'cancel',
        shiftDate(clinicToday, -5),
        shiftDate(clinicToday, -4),
      ),
      appointmentActivityRow(
        'reschedule-retained',
        'Retained reschedule',
        'reschedule',
        shiftDate(clinicToday, -5),
        shiftDate(clinicToday, -3),
      ),
      appointmentActivityRow(
        'reschedule-expired',
        'Expired reschedule',
        'reschedule',
        shiftDate(clinicToday, -5),
        shiftDate(clinicToday, -4),
      ),
    ]);

    render(<AppointmentsPageContent />);

    const activityBlock = await screen.findByRole('region', { name: 'Appointment requests' });
    expect(within(activityBlock).getByText('Retained cancellation')).toBeInTheDocument();
    expect(within(activityBlock).getByText('Retained reschedule')).toBeInTheDocument();
    expect(within(activityBlock).queryByText('Expired cancellation')).not.toBeInTheDocument();
    expect(within(activityBlock).queryByText('Expired reschedule')).not.toBeInTheDocument();
  });

  it('loads only visible appointment statuses and defers manual-booking reference data', async () => {
    mockedFetchAppointments.mockResolvedValue([]);

    render(<AppointmentsPageContent />);

    await waitFor(() => {
      expect(mockedFetchAppointments).toHaveBeenCalledWith(
        CLINIC_ID,
        ['pending_confirmation', 'confirmed', 'visited'],
        expect.any(AbortSignal),
      );
    });
    expect(mockedFetchAppointmentActionRequests).toHaveBeenCalledTimes(1);
    expect(mockedFetchAppointmentActivity).toHaveBeenCalledTimes(1);
    expect(mockedFetchClinicSettings).toHaveBeenCalledTimes(1);
    expect(mockedFetchDoctors).not.toHaveBeenCalled();
    expect(mockedFetchServices).not.toHaveBeenCalled();
    expect(mockedFetchDoctorServices).not.toHaveBeenCalled();
  });

  it('does not request admin-only resources for a doctor', async () => {
    effectiveRole = 'doctor';
    mockedFetchAppointments.mockResolvedValue([]);

    render(<AppointmentsPageContent />);

    await waitFor(() => expect(mockedFetchAppointments).toHaveBeenCalledTimes(1));
    expect(mockedFetchAppointmentActionRequests).not.toHaveBeenCalled();
    expect(mockedFetchAppointmentActivity).not.toHaveBeenCalled();
    expect(mockedFetchClinicSettings).not.toHaveBeenCalled();
    expect(mockedFetchDoctors).not.toHaveBeenCalled();
    expect(mockedFetchServices).not.toHaveBeenCalled();
    expect(mockedFetchDoctorServices).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'New appointment' })).not.toBeInTheDocument();
  });

  it('loads manual-booking reference data on first use and reuses the clinic cache', async () => {
    mockedFetchAppointments.mockResolvedValue([]);
    mockedFetchDoctors.mockResolvedValue([
      {
        id: 'doctor-1',
        name: 'Dr One',
        qualification: null,
        user_id: null,
        active: true,
      },
    ]);
    mockedFetchServices.mockResolvedValue([
      {
        id: 'service-1',
        service_name: 'General Consultation',
        service_key: 'general_consultation',
        active: true,
      },
    ]);
    mockedFetchDoctorServices.mockResolvedValue([
      {
        id: 'mapping-1',
        doctor_id: 'doctor-1',
        clinic_service_id: 'service-1',
        consultation_fee_amount: null,
        active: true,
      },
    ]);

    render(<AppointmentsPageContent />);

    const newAppointment = await screen.findByRole('button', { name: 'New appointment' });
    expect(mockedFetchDoctors).not.toHaveBeenCalled();
    fireEvent.click(newAppointment);

    expect(
      await screen.findByRole('dialog', { name: 'New manual appointment' }),
    ).toBeInTheDocument();
    expect(mockedFetchDoctors).toHaveBeenCalledWith(CLINIC_ID, expect.any(AbortSignal));
    expect(mockedFetchServices).toHaveBeenCalledWith(CLINIC_ID, expect.any(AbortSignal));
    expect(mockedFetchDoctorServices).toHaveBeenCalledWith(CLINIC_ID, expect.any(AbortSignal));

    fireEvent.click(screen.getByRole('button', { name: 'Close manual appointment' }));
    fireEvent.click(screen.getByRole('button', { name: 'New appointment' }));
    expect(
      await screen.findByRole('dialog', { name: 'New manual appointment' }),
    ).toBeInTheDocument();
    expect(mockedFetchDoctors).toHaveBeenCalledTimes(1);
    expect(mockedFetchServices).toHaveBeenCalledTimes(1);
    expect(mockedFetchDoctorServices).toHaveBeenCalledTimes(1);
  });

  it('keeps the manual modal closed after a reference-data failure and supports retry', async () => {
    mockedFetchAppointments.mockResolvedValue([]);
    mockedFetchDoctors.mockRejectedValueOnce(new Error('Doctors unavailable'));

    render(<AppointmentsPageContent />);

    fireEvent.click(await screen.findByRole('button', { name: 'New appointment' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Unable to load appointment booking options. Please try again.',
    );
    expect(
      screen.queryByRole('dialog', { name: 'New manual appointment' }),
    ).not.toBeInTheDocument();

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(
      await screen.findByRole('dialog', { name: 'New manual appointment' }),
    ).toBeInTheDocument();
    expect(mockedFetchDoctors).toHaveBeenCalledTimes(2);
    expect(mockedFetchServices).toHaveBeenCalledTimes(2);
    expect(mockedFetchDoctorServices).toHaveBeenCalledTimes(2);
  });

  it('ignores an older clinic response after the active clinic changes', async () => {
    const clinicToday = getClinicDate(new Date(), 'Asia/Kolkata');
    const firstClinicResponse = deferred<AppointmentApiRow[]>();
    const secondClinicResponse = deferred<AppointmentApiRow[]>();
    mockedFetchAppointments.mockImplementation((clinicId) =>
      clinicId === CLINIC_ID ? firstClinicResponse.promise : secondClinicResponse.promise,
    );

    const { rerender } = render(<AppointmentsPageContent />);
    await waitFor(() => expect(mockedFetchAppointments).toHaveBeenCalledTimes(1));

    activeClinicId = SECOND_CLINIC_ID;
    rerender(<AppointmentsPageContent />);
    await waitFor(() => expect(mockedFetchAppointments).toHaveBeenCalledTimes(2));

    await act(async () => {
      secondClinicResponse.resolve([
        appointmentRow('second-clinic', 'Second clinic patient', clinicToday),
      ]);
    });
    expect(await screen.findByText('Second clinic patient')).toBeInTheDocument();

    await act(async () => {
      firstClinicResponse.resolve([
        appointmentRow('first-clinic', 'First clinic patient', clinicToday),
      ]);
    });
    expect(screen.queryByText('First clinic patient')).not.toBeInTheDocument();
    expect(screen.getByText('Second clinic patient')).toBeInTheDocument();
  });

  it('cancels an edit-time slot lookup and does not mutate after leaving the page', async () => {
    const clinicToday = getClinicDate(new Date(), 'Asia/Kolkata');
    const slotsResponse = deferred<Awaited<ReturnType<typeof fetchAvailableAppointmentSlots>>>();
    mockedFetchAppointments.mockResolvedValue([
      appointmentRow('confirmed-navigation', 'Navigation patient', clinicToday, 'confirmed'),
    ]);
    mockedFetchAvailableAppointmentSlots.mockReturnValue(slotsResponse.promise);

    const { unmount } = render(<AppointmentsPageContent />);

    expect(await screen.findByText('Navigation patient')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Time' }));
    fireEvent.change(screen.getByDisplayValue('09:00'), { target: { value: '10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockedFetchAvailableAppointmentSlots).toHaveBeenCalledTimes(1));
    const requestSignal = mockedFetchAvailableAppointmentSlots.mock.calls[0]?.[2];
    unmount();
    expect(requestSignal?.aborted).toBe(true);

    await act(async () => {
      slotsResponse.resolve([
        {
          slot_id: 'slot-after-navigation',
          doctor_id: '00000000-0000-0000-0000-000000000201',
          clinic_service_id: '00000000-0000-0000-0000-000000000301',
          appointment_start: `${clinicToday} 10:00:00`,
          appointment_end: `${clinicToday} 10:30:00`,
          available_count: 1,
        },
      ]);
      await Promise.resolve();
    });

    expect(mockedRescheduleAppointment).not.toHaveBeenCalled();
  });
});
