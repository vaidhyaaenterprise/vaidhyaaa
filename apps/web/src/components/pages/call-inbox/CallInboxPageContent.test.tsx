import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CallInboxPageContent } from '@/components/pages/call-inbox/CallInboxPageContent';
import { fetchCallInbox, type CallInboxApiRow } from '@/lib/api/clinic-clinical';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ effectiveRole: 'admin' }),
}));

vi.mock('@/hooks/useActiveClinicId', () => ({
  useActiveClinicId: () => CLINIC_ID,
}));

vi.mock('@/lib/api/clinic-clinical', () => ({
  fetchCallInbox: vi.fn(),
}));

const mockedFetchCallInbox = vi.mocked(fetchCallInbox);

function inboxRow(
  index: number,
  outcome: CallInboxApiRow['outcome'],
  summary: string,
): CallInboxApiRow {
  const id = `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`;
  return {
    id,
    call_id: id,
    source_type: 'call',
    source_id: id,
    patient_phone: `98765432${String(index).padStart(2, '0')}`,
    patient_name: `Patient ${index}`,
    patient_id: null,
    occurred_at: `2026-09-22T0${index}:00:00.000Z`,
    started_at: `2026-09-22T0${index}:00:00.000Z`,
    ended_at: `2026-09-22T0${index}:05:00.000Z`,
    duration_seconds: 300,
    outcome,
    action_needed: 'none',
    summary,
    recording_url: null,
    recording_expires_at: null,
    transcript_expires_at: null,
    created_appointment_request_id: null,
    created_callback_request_id: null,
    created_emergency_incident_id: null,
    appointment_action_request_id: null,
    source_status: null,
  };
}

const ROWS: CallInboxApiRow[] = [
  inboxRow(1, 'appointment_booked', 'Booked summary'),
  inboxRow(2, 'appointment_cancelled', 'Cancelled summary'),
  inboxRow(3, 'appointment_rescheduled', 'Rescheduled summary'),
  inboxRow(4, 'general_inquiry', 'Inquiry summary'),
  inboxRow(5, 'callback_requested', 'Callback summary'),
  inboxRow(6, 'emergency', 'Emergency summary'),
];

beforeEach(() => {
  mockedFetchCallInbox.mockReset().mockImplementation(async (_clinicId, outcomes = []) =>
    outcomes.length > 0 ? ROWS.filter((row) => outcomes.includes(row.outcome)) : ROWS,
  );
});

afterEach(() => {
  cleanup();
});

describe('CallInboxPageContent', () => {
  it('loads one normalized clinic-scoped inbox and shows all six outcomes', async () => {
    render(<CallInboxPageContent />);

    expect(await screen.findByText('Booked summary')).toBeInTheDocument();
    expect(screen.getByText('Cancelled summary')).toBeInTheDocument();
    expect(screen.getByText('Rescheduled summary')).toBeInTheDocument();
    expect(screen.getByText('Inquiry summary')).toBeInTheDocument();
    expect(screen.getByText('Callback summary')).toBeInTheDocument();
    expect(screen.getByText('Emergency summary')).toBeInTheDocument();
    expect(mockedFetchCallInbox).toHaveBeenCalledWith(CLINIC_ID, []);
    expect(mockedFetchCallInbox).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Emergency only')).not.toBeInTheDocument();
    expect(screen.queryByText('Callback only')).not.toBeInTheDocument();
    expect(screen.queryByText('Appointment requests only')).not.toBeInTheDocument();
    expect(screen.queryByText('Action needed')).not.toBeInTheDocument();
  });

  it('does not show recording or transcript sections in call details', async () => {
    render(<CallInboxPageContent />);

    fireEvent.click(await screen.findByText('Booked summary'));

    expect(screen.getByText('Call details')).toBeInTheDocument();
    expect(screen.queryByText('Recording')).not.toBeInTheDocument();
    expect(screen.queryByText('Transcript')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Recording unavailable (expired or not available)'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Transcript unavailable (expired or not available)'),
    ).not.toBeInTheDocument();
  });

  it('supports checkbox multi-selection with OR semantics and All outcomes reset', async () => {
    render(<CallInboxPageContent />);
    await screen.findByText('Booked summary');

    fireEvent.click(screen.getByRole('button', { name: 'All outcomes' }));
    expect(screen.getByRole('dialog', { name: 'Filter by outcomes' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Cancelled Appointment' }));
    expect(await screen.findByRole('button', { name: 'Cancelled Appointment' })).toBeInTheDocument();
    expect(await screen.findByText('Cancelled summary')).toBeInTheDocument();
    expect(screen.queryByText('Booked summary')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Appointment Rescheduled' }));
    expect(await screen.findByRole('button', { name: '2 outcomes selected' })).toBeInTheDocument();
    expect(await screen.findByText('Cancelled summary')).toBeInTheDocument();
    expect(await screen.findByText('Rescheduled summary')).toBeInTheDocument();
    expect(screen.queryByText('Inquiry summary')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'All outcomes' }));
    await waitFor(() => {
      expect(screen.getByText('Booked summary')).toBeInTheDocument();
      expect(screen.getByText('Inquiry summary')).toBeInTheDocument();
    });
  });

  it('closes the outcome menu with Escape', async () => {
    render(<CallInboxPageContent />);
    await screen.findByText('Booked summary');

    const trigger = screen.getByRole('button', { name: 'All outcomes' });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog', { name: 'Filter by outcomes' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
