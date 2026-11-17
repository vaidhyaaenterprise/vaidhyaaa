'use client';

import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import {
  fetchDoctorAnalytics,
  type DoctorAnalyticsData,
  type DoctorAnalyticsPoint,
} from '@/lib/api/doctor-analytics';

type GroupBy = 'daily' | 'weekly' | 'monthly';
type ChartType = 'area' | 'bar' | 'line';

const CONDITION_COLORS = ['#0f766e', '#2563eb', '#d97706', '#dc2626', '#7c3aed'];
const TREND_SERIES = [
  { key: 'total', label: 'Total', color: '#0f766e' },
  { key: 'new_patients', label: 'New', color: '#2563eb' },
  { key: 'follow_ups', label: 'Follow-up', color: '#d97706' },
] as const;

export function DoctorAnalytics() {
  const { clinicRole, me } = useAuth();
  const [groupBy, setGroupBy] = useState<GroupBy>('daily');
  const [chartType, setChartType] = useState<ChartType>('area');
  const [reloadKey, setReloadKey] = useState(0);
  const [loadState, setLoadState] = useState<
    | { status: 'loading' }
    | { status: 'error' }
    | {
        status: 'ready';
        clinicId: string;
        doctorId: string;
        data: DoctorAnalyticsData;
      }
  >({ status: 'loading' });
  const clinicId =
    clinicRole?.active && clinicRole.role === 'doctor' && clinicRole.doctor_id
      ? clinicRole.clinic_id
      : null;
  const doctorId = clinicRole?.active && clinicRole.role === 'doctor' ? clinicRole.doctor_id : null;

  useEffect(() => {
    if (!clinicId || !doctorId) {
      setLoadState({ status: 'error' });
      return;
    }
    const controller = new AbortController();
    setLoadState({ status: 'loading' });
    void fetchDoctorAnalytics(clinicId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setLoadState({ status: 'ready', clinicId, doctorId, data });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadState({ status: 'error' });
      });
    return () => controller.abort();
  }, [clinicId, doctorId, reloadKey]);

  const analytics =
    loadState.status === 'ready' &&
    loadState.clinicId === clinicId &&
    loadState.doctorId === doctorId
      ? loadState.data
      : null;
  const data = analytics?.trends[groupBy] ?? [];
  const hasTrendData = data.some(
    (point) => point.total > 0 || point.new_patients > 0 || point.follow_ups > 0,
  );
  const topConditions = useMemo(
    () =>
      (analytics?.top_conditions ?? [])
        .filter((item) => item.condition.trim() && item.count > 0)
        .sort(
          (left, right) =>
            right.count - left.count || left.condition.localeCompare(right.condition),
        )
        .slice(0, 5),
    [analytics],
  );
  const conditionSegments: [string, number, string][] = topConditions.map((item, index) => [
    item.condition,
    item.count,
    CONDITION_COLORS[index]!,
  ]);
  const monthlySummary = useMemo(
    () =>
      [...(analytics?.monthly_summary ?? [])]
        .sort((left, right) => left.period_start.localeCompare(right.period_start))
        .slice(-6),
    [analytics],
  );

  const totalThisMonth = analytics?.stats.confirmed_this_month ?? 0;
  const totalNew = analytics?.stats.new_confirmed_this_month ?? 0;
  const avgPerDay = analytics?.stats.average_confirmed_per_day ?? 0;
  const followUps = analytics?.stats.follow_up_confirmed_this_month ?? 0;

  return (
    <>
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-[26px] font-black tracking-tight text-slate-900">Patient Analytics</h1>
        <p className="mt-1 text-sm text-slate-500">
          Visualise patient visits, conditions, and trends for{' '}
          {me?.user.name ?? 'the signed-in doctor'}
        </p>
      </div>

      {!clinicId || !doctorId ? (
        <ErrorState
          title="Doctor profile not linked"
          description="Your doctor login is not linked to an active clinic profile. Contact the clinic administrator."
        />
      ) : loadState.status === 'loading' || !analytics ? (
        loadState.status === 'error' ? (
          <ErrorState
            title="Could not load analytics"
            description="The analytics service is temporarily unavailable. Please try again."
          >
            <button
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
              className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white hover:bg-teal-800"
            >
              Retry
            </button>
          </ErrorState>
        ) : (
          <LoadingState
            title="Loading analytics"
            description="Calculating appointment trends from your clinic data."
          />
        )
      ) : (
        <>
          {/* Stats */}
          <div className="portal-stat-grid mb-5 gap-[14px]">
            <StatCard
              label="Total This Month"
              value={totalThisMonth}
              sub="confirmed appointments"
            />
            <StatCard label="New Patients" value={totalNew} sub="confirmed appointments" />
            <StatCard label="Avg Per Day" value={avgPerDay} sub="confirmed appointments" />
            <StatCard label="Follow-ups" value={followUps} sub="confirmed appointments" />
          </div>

          {/* Trend Chart */}
          <div className="mb-5 rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-base font-extrabold text-slate-900">Appointment Trends</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Confirmed and completed appointments over time
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <FilterBox
                  options={['daily', 'weekly', 'monthly'] as const}
                  value={groupBy}
                  onChange={setGroupBy}
                />
                <FilterBox
                  options={['area', 'bar', 'line'] as const}
                  value={chartType}
                  onChange={setChartType}
                />
              </div>
            </div>
            <div className="min-h-[280px]">
              {hasTrendData ? (
                chartType === 'bar' ? (
                  <BarChart data={data} />
                ) : (
                  <LineAreaChart data={data} filled={chartType === 'area'} />
                )
              ) : (
                <EmptyPanel message="No confirmed or completed appointment trend data is available yet." />
              )}
            </div>
            <div className="mt-[10px] flex flex-wrap justify-center gap-[14px]">
              {TREND_SERIES.map((series) => (
                <LegendDot key={series.key} color={series.color} label={series.label} />
              ))}
            </div>
          </div>

          {/* Bottom Grid */}
          <div
            data-testid="doctor-analytics-breakdown"
            className="portal-breakdown-grid mb-5 gap-4"
          >
            {/* Top Conditions */}
            <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
              <p className="mb-4 flex items-center gap-[7px] text-[15px] font-extrabold text-slate-900">
                ◉ Top Conditions
              </p>
              <div className="grid min-w-0 gap-4 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center">
                <div
                  className="mx-auto h-[150px] w-[150px] rounded-full"
                  style={{ background: `conic-gradient(${buildConicGradient(conditionSegments)})` }}
                >
                  <div className="flex h-full items-center justify-center">
                    <div className="h-[74px] w-[74px] rounded-full bg-white" />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  {conditionSegments.length ? (
                    conditionSegments.map(([name, value, color]) => (
                      <div key={name} className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span
                            className="inline-block h-[10px] w-[10px] flex-shrink-0 rounded-[3px]"
                            style={{ background: color }}
                          />
                          <span className="break-words">{name}</span>
                        </span>
                        <strong>{value}</strong>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">No diagnosed conditions recorded yet.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Age Distribution */}
            <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
              <p className="mb-4 flex items-center gap-[7px] text-[15px] font-extrabold text-slate-900">
                👥 Age Distribution
              </p>
              <AgeDistribution data={analytics.age_groups} />
            </div>
          </div>

          {/* Monthly Summary Table */}
          <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
            <p className="mb-4 flex items-center gap-[7px] text-[15px] font-extrabold text-slate-900">
              Monthly Summary
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="border-b border-slate-100 px-3 py-[10px] text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-400">
                      Month
                    </th>
                    <th className="border-b border-slate-100 px-3 py-[10px] text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-400">
                      Total Patients
                    </th>
                    <th className="border-b border-slate-100 px-3 py-[10px] text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-400">
                      New Patients
                    </th>
                    <th className="border-b border-slate-100 px-3 py-[10px] text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-400">
                      Follow-ups
                    </th>
                    <th className="border-b border-slate-100 px-3 py-[10px] text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-400">
                      Avg / Day
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {monthlySummary.length ? (
                    monthlySummary.map((row) => (
                      <tr key={row.period_start} className="even:bg-slate-50">
                        <td className="px-3 py-3 text-sm font-bold text-slate-900">{row.label}</td>
                        <td className="px-3 py-3 text-sm text-slate-700">{row.total}</td>
                        <td className="px-3 py-3">
                          <span className="inline-block rounded-full border border-blue-200 bg-blue-50 px-[10px] py-0.5 text-[11px] font-extrabold text-blue-700">
                            {row.new_patients}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="inline-block rounded-full border border-green-200 bg-green-50 px-[10px] py-0.5 text-[11px] font-extrabold text-green-700">
                            {row.follow_ups}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-500">{row.average_per_day}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-500">
                        No appointment data is available for the last six months.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ─── Sub-components ─── */

function StatCard({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-white px-5 py-[18px] shadow-sm">
      <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-[32px] font-black text-slate-900">{value}</p>
      <p className="mt-0.5 text-[13px] text-slate-500">{sub}</p>
    </div>
  );
}

function FilterBox<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`rounded-[10px] border px-[13px] py-[7px] text-[13px] font-bold transition-colors ${
            value === opt
              ? 'border-teal-700 bg-teal-50 text-teal-700'
              : 'border-transparent bg-white text-slate-600 hover:text-slate-900'
          }`}
        >
          {opt.charAt(0).toUpperCase() + opt.slice(1)}
        </button>
      ))}
    </div>
  );
}

function BarChart({ data }: { data: DoctorAnalyticsPoint[] }) {
  const max = Math.max(...data.map((d) => d.total), 1);
  const height = (value: number) => (value > 0 ? Math.max(8, (value / max) * 205) : 0);
  return (
    <div className="flex h-[235px] items-end gap-3 border-b border-slate-100 px-1.5 pt-5">
      {data.map((d) => {
        return (
          <div
            key={d.period_start}
            className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2"
          >
            <div className="flex h-[205px] w-full max-w-[72px] items-end justify-center gap-1">
              {TREND_SERIES.map((series) => (
                <div
                  key={series.key}
                  className="min-w-0 flex-1 rounded-t-[5px]"
                  style={{ height: height(d[series.key]), background: series.color }}
                  title={`${d.label}: ${series.label} ${d[series.key]}`}
                />
              ))}
            </div>
            <span className="text-center text-[11px] text-slate-400">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function LineAreaChart({ data, filled }: { data: DoctorAnalyticsPoint[]; filled: boolean }) {
  const max = Math.max(...data.map((d) => d.total), 1);
  const seriesPoints = TREND_SERIES.map((series) => ({
    ...series,
    points: data.map((d, i) => {
      const value = d[series.key];
      const x = data.length === 1 ? 40 : 40 + i * (520 / (data.length - 1));
      const y = 220 - (value / max) * 180;
      return { x, y, value, d };
    }),
  }));
  const totalPoints = seriesPoints[0]?.points ?? [];
  const totalLine = totalPoints.map((point) => `${point.x},${point.y}`).join(' ');

  return (
    <svg
      viewBox="0 0 600 260"
      role="img"
      aria-label="Patient trend chart"
      className="h-[260px] w-full"
    >
      <line x1="40" y1="40" x2="560" y2="40" stroke="#f1f5f9" strokeWidth="1" />
      <line x1="40" y1="100" x2="560" y2="100" stroke="#f1f5f9" strokeWidth="1" />
      <line x1="40" y1="160" x2="560" y2="160" stroke="#f1f5f9" strokeWidth="1" />
      <line x1="40" y1="220" x2="560" y2="220" stroke="#f1f5f9" strokeWidth="1" />
      {filled && <polygon points={`40,220 ${totalLine} 560,220`} fill="rgba(15,118,110,0.12)" />}
      {seriesPoints.map((series) => (
        <polyline
          key={series.key}
          points={series.points.map((point) => `${point.x},${point.y}`).join(' ')}
          fill="none"
          stroke={series.color}
          strokeWidth={series.key === 'total' ? 4 : 3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {seriesPoints.flatMap((series) =>
        series.points.map((point) => (
          <circle
            key={`${series.key}-${point.d.period_start}`}
            cx={point.x}
            cy={point.y}
            r={series.key === 'total' ? 5 : 4}
            fill={series.color}
          >
            <title>
              {point.d.label}: {series.label} {point.value}
            </title>
          </circle>
        )),
      )}
      {totalPoints.map((point) => (
        <text
          key={`label-${point.d.period_start}`}
          x={point.x}
          y="245"
          textAnchor="middle"
          fill="#94a3b8"
          fontSize="12"
        >
          {point.d.label}
        </text>
      ))}
    </svg>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-600">
      <span
        className="inline-block h-[10px] w-[10px] rounded-[3px]"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

function AgeDistribution({ data }: { data: Array<{ label: string; count: number }> }) {
  if (!data.some((item) => item.count > 0)) {
    return <EmptyPanel message="No patient age data is available yet." compact />;
  }
  const max = Math.max(...data.map((item) => item.count), 1);
  return (
    <div className="flex h-[210px] items-end gap-2">
      {data.map(({ label, count }, idx) => (
        <div
          key={label}
          className="flex flex-1 flex-col items-center justify-end gap-1.5"
          style={{ height: '100%' }}
        >
          <div
            className={`w-full max-w-[34px] rounded-t-[5px] ${idx % 2 === 0 ? 'bg-amber-600' : 'bg-amber-400'}`}
            style={{ height: count > 0 ? `${Math.max(8, (count / max) * 180)}px` : 0 }}
            title={`${label}: ${count}`}
          />
          <span className="text-[11px] text-slate-400">{label}</span>
        </div>
      ))}
    </div>
  );
}

function buildConicGradient(items: [string, number, string][]): string {
  const total = items.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return '#e2e8f0 0% 100%';
  let cumulative = 0;
  const segments: string[] = [];
  for (const [, value, color] of items) {
    const start = cumulative / total;
    cumulative += value;
    const end = cumulative / total;
    segments.push(`${color} ${(start * 100).toFixed(1)}% ${(end * 100).toFixed(1)}%`);
  }
  return segments.join(', ');
}

function EmptyPanel({ message, compact = false }: { message: string; compact?: boolean }) {
  return (
    <div
      role="status"
      className={`flex items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 text-center text-sm text-slate-500 ${compact ? 'h-[210px]' : 'h-[260px]'}`}
    >
      {message}
    </div>
  );
}
