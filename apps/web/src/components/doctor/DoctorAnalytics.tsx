'use client';

import { useState } from 'react';
import { DAILY_DATA, WEEKLY_DATA, MONTHLY_DATA, CONDITIONS, VISIT_TYPES, AGE_GROUPS, type DailyData } from './doctor-data';

type GroupBy = 'daily' | 'weekly' | 'monthly';
type ChartType = 'area' | 'bar' | 'line';

function dataForGroup(groupBy: GroupBy): DailyData[] {
  if (groupBy === 'weekly') return WEEKLY_DATA;
  if (groupBy === 'monthly') return MONTHLY_DATA;
  return DAILY_DATA;
}

export function DoctorAnalytics() {
  const [groupBy, setGroupBy] = useState<GroupBy>('daily');
  const [chartType, setChartType] = useState<ChartType>('area');

  const data = dataForGroup(groupBy);
  const totalThisMonth = MONTHLY_DATA.at(-1)!.patients;
  const totalNew = MONTHLY_DATA.at(-1)!.newPatients;
  const avgPerDay = Math.round(totalThisMonth / 18);

  return (
    <>
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-[26px] font-black tracking-tight text-slate-900">Patient Analytics</h1>
        <p className="mt-1 text-sm text-slate-500">Visualise patient visits, conditions, and trends for Dr. M. Kumar</p>
      </div>

      {/* Stats */}
      <div className="mb-5 grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatCard label="Total This Month" value={totalThisMonth} sub="+12% vs last month" />
        <StatCard label="New Patients" value={totalNew} sub="of this month's total" />
        <StatCard label="Avg Per Day" value={avgPerDay} sub="across working days" />
        <StatCard label="Follow-ups" value={totalThisMonth - totalNew} sub="returning patients" />
      </div>

      {/* Trend Chart */}
      <div className="mb-5 rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-base font-extrabold text-slate-900">Patient Visit Trends</p>
            <p className="mt-0.5 text-xs text-slate-500">Total, new, and follow-up patients over time</p>
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
          {chartType === 'bar' ? <BarChart data={data} /> : <LineAreaChart data={data} filled={chartType === 'area'} />}
        </div>
        <div className="mt-[10px] flex flex-wrap justify-center gap-[14px]">
          <LegendDot color="#0f766e" label="Total" />
          <LegendDot color="#2563eb" label="New" />
          <LegendDot color="#d97706" label="Follow-up" />
        </div>
      </div>

      {/* Bottom Grid */}
      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        {/* Top Conditions */}
        <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-4 flex items-center gap-[7px] text-[15px] font-extrabold text-slate-900">◉ Top Conditions</p>
          <div className="grid grid-cols-[150px_1fr] items-center gap-[14px]">
            <div
              className="h-[150px] w-[150px] rounded-full"
              style={{ background: `conic-gradient(${buildConicGradient(CONDITIONS)})` }}
            >
              <div className="flex h-full items-center justify-center">
                <div className="h-[74px] w-[74px] rounded-full bg-white" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              {CONDITIONS.slice(0, 5).map(([name, value, color]) => (
                <div key={name} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-[10px] w-[10px] rounded-[3px]" style={{ background: color }} />
                    {name}
                  </span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Visit Type */}
        <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-4 flex items-center gap-[7px] text-[15px] font-extrabold text-slate-900">▥ Visit Type</p>
          <div className="grid grid-cols-[150px_1fr] items-center gap-[14px]">
            <div
              className="h-[150px] w-[150px] rounded-full"
              style={{ background: `conic-gradient(${buildConicGradient(VISIT_TYPES)})` }}
            >
              <div className="flex h-full items-center justify-center">
                <div className="h-[74px] w-[74px] rounded-full bg-white" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              {VISIT_TYPES.map(([name, value, color]) => (
                <div key={name} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-[10px] w-[10px] rounded-[3px]" style={{ background: color }} />
                    {name}
                  </span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Age Distribution */}
        <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-4 flex items-center gap-[7px] text-[15px] font-extrabold text-slate-900">👥 Age Distribution</p>
          <AgeDistribution />
        </div>
      </div>

      {/* Monthly Summary Table */}
      <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
        <p className="mb-4 flex items-center gap-[7px] text-[15px] font-extrabold text-slate-900">Monthly Summary</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border-b border-slate-100 px-3 py-[10px] text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Month</th>
                <th className="border-b border-slate-100 px-3 py-[10px] text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Total Patients</th>
                <th className="border-b border-slate-100 px-3 py-[10px] text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-400">New Patients</th>
                <th className="border-b border-slate-100 px-3 py-[10px] text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Follow-ups</th>
                <th className="border-b border-slate-100 px-3 py-[10px] text-left text-[11px] font-extrabold uppercase tracking-wide text-slate-400">Avg / Day</th>
              </tr>
            </thead>
            <tbody>
              {MONTHLY_DATA.map((row) => {
                const workDays = row.label === 'Jun' ? 10 : 22;
                return (
                  <tr key={row.label} className="even:bg-slate-50">
                    <td className="px-3 py-3 text-sm font-bold text-slate-900">{row.label} 2026</td>
                    <td className="px-3 py-3 text-sm text-slate-700">{row.patients}</td>
                    <td className="px-3 py-3">
                      <span className="inline-block rounded-full border border-blue-200 bg-blue-50 px-[10px] py-0.5 text-[11px] font-extrabold text-blue-700">
                        {row.newPatients}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-block rounded-full border border-green-200 bg-green-50 px-[10px] py-0.5 text-[11px] font-extrabold text-green-700">
                        {row.followUp}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-sm text-slate-500">{Math.round(row.patients / workDays)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
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

function FilterBox<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
      {options.map(opt => (
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

function BarChart({ data }: { data: DailyData[] }) {
  const max = Math.max(...data.map(d => d.patients), 1);
  return (
    <div className="flex h-[235px] items-end gap-3 border-b border-slate-100 px-1.5 pt-5">
      {data.map(d => {
        const totalH = Math.max(8, (d.patients / max) * 205);
        const newH = totalH * (d.patients > 0 ? d.newPatients / d.patients : 0);
        const followH = totalH - newH;
        return (
          <div key={d.label} className="flex flex-1 flex-col items-center justify-end gap-2" title={`${d.label}: ${d.patients}`}>
            <div className="flex w-full max-w-[54px] flex-col justify-end overflow-hidden rounded-t-lg bg-slate-200" style={{ height: totalH }}>
              <div className="bg-teal-700" style={{ height: followH }} />
              <div className="bg-blue-600" style={{ height: newH }} />
            </div>
            <span className="text-center text-[11px] text-slate-400">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function LineAreaChart({ data, filled }: { data: DailyData[]; filled: boolean }) {
  const max = Math.max(...data.map(d => d.patients), 1);
  const points = data.map((d, i) => {
    const x = data.length === 1 ? 40 : 40 + i * (520 / (data.length - 1));
    const y = 220 - (d.patients / max) * 180;
    return { x, y, d };
  });
  const line = points.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <svg viewBox="0 0 600 260" role="img" aria-label="Patient trend chart" className="h-[260px] w-full">
      <line x1="40" y1="40" x2="560" y2="40" stroke="#f1f5f9" strokeWidth="1" />
      <line x1="40" y1="100" x2="560" y2="100" stroke="#f1f5f9" strokeWidth="1" />
      <line x1="40" y1="160" x2="560" y2="160" stroke="#f1f5f9" strokeWidth="1" />
      <line x1="40" y1="220" x2="560" y2="220" stroke="#f1f5f9" strokeWidth="1" />
      {filled && <polygon points={`40,220 ${line} 560,220`} fill="rgba(15,118,110,0.12)" />}
      <polyline points={line} fill="none" stroke="#0f766e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="5" fill="#0f766e">
          <title>{p.d.label}: {p.d.patients} patients</title>
        </circle>
      ))}
      {points.map((p, i) => (
        <text key={`l${i}`} x={p.x} y="245" textAnchor="middle" fill="#94a3b8" fontSize="12">
          {p.d.label}
        </text>
      ))}
    </svg>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-600">
      <span className="inline-block h-[10px] w-[10px] rounded-[3px]" style={{ background: color }} />
      {label}
    </span>
  );
}

function AgeDistribution() {
  const max = Math.max(...AGE_GROUPS.map(([, count]) => count));
  return (
    <div className="flex h-[210px] items-end gap-2">
      {AGE_GROUPS.map(([label, count], idx) => (
        <div key={label} className="flex flex-1 flex-col items-center justify-end gap-1.5" style={{ height: '100%' }}>
          <div
            className={`w-full max-w-[34px] rounded-t-[5px] ${idx % 2 === 0 ? 'bg-amber-600' : 'bg-amber-400'}`}
            style={{ height: `${Math.max(8, (count / max) * 180)}px` }}
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
