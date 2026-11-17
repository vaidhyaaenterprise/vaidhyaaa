import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchDoctorAnalytics, type DoctorAnalyticsData } from '@/lib/api/doctor-analytics';
import { DoctorAnalytics } from './DoctorAnalytics';

const { auth } = vi.hoisted(() => ({
  auth: {
    clinicRole: {
      clinic_id: 'clinic-1',
      doctor_id: 'doctor-1' as string | null,
      role: 'doctor',
      active: true,
    },
    me: { user: { name: 'Dr. Dynamic' } },
  },
}));

vi.mock('@/components/auth/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('@/lib/api/doctor-analytics', () => ({ fetchDoctorAnalytics: vi.fn() }));

function point(periodStart: string, label: string, total: number) {
  return {
    period_start: periodStart,
    label,
    total,
    new_patients: Math.floor(total / 2),
    follow_ups: Math.ceil(total / 2),
  };
}

function analyticsData(): DoctorAnalyticsData {
  return {
    stats: {
      confirmed_this_month: 42,
      new_confirmed_this_month: 17,
      follow_up_confirmed_this_month: 25,
      average_confirmed_per_day: 3,
    },
    trends: {
      daily: [point('2026-11-17', '17 Nov', 8)],
      weekly: [point('2026-11-16', '16–22 Nov', 19)],
      monthly: [point('2026-11-01', 'Nov 2026', 42)],
    },
    top_conditions: [
      { condition: 'Condition Six', count: 1 },
      { condition: 'Condition Three', count: 4 },
      { condition: 'Condition One', count: 6 },
      { condition: 'Condition Five', count: 2 },
      { condition: 'Condition Two', count: 5 },
      { condition: 'Condition Four', count: 3 },
      { condition: '   ', count: 100 },
    ],
    age_groups: [
      { label: '0–18', count: 4 },
      { label: '19–30', count: 12 },
    ],
    monthly_summary: [
      { ...point('2026-05-01', 'May 2026', 5), average_per_day: 1 },
      { ...point('2026-06-01', 'Jun 2026', 6), average_per_day: 1 },
      { ...point('2026-07-01', 'Jul 2026', 7), average_per_day: 1 },
      { ...point('2026-08-01', 'Aug 2026', 8), average_per_day: 1 },
      { ...point('2026-09-01', 'Sep 2026', 9), average_per_day: 1 },
      { ...point('2026-10-01', 'Oct 2026', 10), average_per_day: 2 },
      { ...point('2026-11-01', 'Nov 2026', 42), average_per_day: 3 },
    ],
  };
}

function emptyAnalytics(): DoctorAnalyticsData {
  const zeroMonthly = ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'].map((label, index) => ({
    ...point(`2026-${String(index + 6).padStart(2, '0')}-01`, `${label} 2026`, 0),
    average_per_day: 0,
  }));
  return {
    stats: {
      confirmed_this_month: 0,
      new_confirmed_this_month: 0,
      follow_up_confirmed_this_month: 0,
      average_confirmed_per_day: 0,
    },
    trends: {
      daily: [point('2026-11-17', '17 Nov', 0)],
      weekly: [point('2026-11-16', '16–22 Nov', 0)],
      monthly: zeroMonthly,
    },
    top_conditions: [],
    age_groups: [
      { label: '0–18', count: 0 },
      { label: '19–30', count: 0 },
      { label: '31–45', count: 0 },
      { label: '46–60', count: 0 },
      { label: '61–75', count: 0 },
      { label: '76+', count: 0 },
    ],
    monthly_summary: zeroMonthly,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.clinicRole = {
    clinic_id: 'clinic-1',
    doctor_id: 'doctor-1',
    role: 'doctor',
    active: true,
  };
  vi.mocked(fetchDoctorAnalytics).mockResolvedValue(analyticsData());
});

afterEach(cleanup);

describe('DoctorAnalytics', () => {
  it('renders database analytics, limits conditions to five and monthly summary to six months', async () => {
    render(<DoctorAnalytics />);

    const totalCard = (await screen.findByText('Total This Month')).parentElement!;
    expect(within(totalCard).getByText('42')).toBeInTheDocument();
    expect(within(totalCard).getByText('confirmed appointments')).toBeInTheDocument();
    expect(screen.getByText('17 Nov')).toBeInTheDocument();
    expect(screen.getByText('17 Nov: New 4')).toBeInTheDocument();
    expect(screen.getByText('17 Nov: Follow-up 4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bar' }));
    expect(screen.getByTitle('17 Nov: Total 8')).toBeInTheDocument();
    expect(screen.getByTitle('17 Nov: New 4')).toBeInTheDocument();
    expect(screen.getByTitle('17 Nov: Follow-up 4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    expect(screen.getByText('16–22 Nov')).toBeInTheDocument();

    for (const condition of [
      'Condition One',
      'Condition Two',
      'Condition Three',
      'Condition Four',
      'Condition Five',
    ]) {
      expect(screen.getByText(condition)).toBeInTheDocument();
    }
    expect(screen.queryByText('Condition Six')).not.toBeInTheDocument();
    expect(screen.queryByText('Visit Type')).not.toBeInTheDocument();

    const summary = screen.getByRole('table');
    expect(within(summary).getAllByRole('row')).toHaveLength(7);
    expect(within(summary).queryByText('May 2026')).not.toBeInTheDocument();
    for (const month of ['Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026', 'Nov 2026']) {
      expect(within(summary).getByText(month)).toBeInTheDocument();
    }
    expect(fetchDoctorAnalytics).toHaveBeenCalledWith('clinic-1', expect.any(AbortSignal));
  });

  it('recognizes zero-filled database buckets as empty while retaining six summary months', async () => {
    vi.mocked(fetchDoctorAnalytics).mockResolvedValueOnce(emptyAnalytics());
    render(<DoctorAnalytics />);
    expect(
      await screen.findByText('No confirmed or completed appointment trend data is available yet.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No diagnosed conditions recorded yet.')).toBeInTheDocument();
    expect(screen.getByText('No patient age data is available yet.')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(7);
    expect(
      screen.queryByText('No appointment data is available for the last six months.'),
    ).not.toBeInTheDocument();
  });

  it('shows an error and retries the database request', async () => {
    vi.mocked(fetchDoctorAnalytics)
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(analyticsData());
    render(<DoctorAnalytics />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load analytics');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Total This Month')).toBeInTheDocument();
    expect(fetchDoctorAnalytics).toHaveBeenCalledTimes(2);
  });

  it('does not request clinic analytics without an active linked doctor', () => {
    auth.clinicRole.doctor_id = null;
    render(<DoctorAnalytics />);
    expect(screen.getByRole('alert')).toHaveTextContent('Doctor profile not linked');
    expect(fetchDoctorAnalytics).not.toHaveBeenCalled();
  });

  it('aborts and ignores a stale request when the doctor membership changes', async () => {
    let resolveFirst!: (data: DoctorAnalyticsData) => void;
    vi.mocked(fetchDoctorAnalytics)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({
        ...analyticsData(),
        stats: { ...analyticsData().stats, confirmed_this_month: 7 },
      });

    const view = render(<DoctorAnalytics />);
    const firstSignal = vi.mocked(fetchDoctorAnalytics).mock.calls[0]![1]!;
    auth.clinicRole = { ...auth.clinicRole, clinic_id: 'clinic-2', doctor_id: 'doctor-2' };
    view.rerender(<DoctorAnalytics />);
    expect(firstSignal.aborted).toBe(true);
    const totalCard = (await screen.findByText('Total This Month')).parentElement!;
    expect(within(totalCard).getByText('7')).toBeInTheDocument();
    resolveFirst(analyticsData());
    await waitFor(() => expect(within(totalCard).queryByText('42')).not.toBeInTheDocument());
  });
});
