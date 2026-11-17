import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/client';
import { AppointmentLifecycleRepository } from '../src/repositories/appointment-lifecycle.repository';

const clinicId = '00000000-0000-4000-8000-000000000301';
const doctorId = '00000000-0000-4000-8000-000000000401';

describe('doctor analytics aggregation query', () => {
  it('uses clinic-local, doctor-scoped aggregate queries and returns only bounded series', async () => {
    const monthlyRows = Array.from({ length: 6 }, (_, index) => ({
      period_start: `2026-${String(index + 6).padStart(2, '0')}-01`,
      label: `Month ${index + 1}`,
      total: String(index + 10),
      new_patients: String(index + 4),
      follow_ups: '6',
      average_per_day: '2',
    }));
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        {
          confirmed_this_month: '9',
          new_confirmed_this_month: '4',
          follow_up_confirmed_this_month: '5',
          average_confirmed_per_day: '3',
        },
      ])
      .mockResolvedValueOnce([
        {
          period_start: '2026-11-17',
          label: '17 Nov',
          total: '3',
          new_patients: '2',
          follow_ups: '1',
        },
      ])
      .mockResolvedValueOnce([
        {
          period_start: '2026-11-16',
          label: '16 Nov',
          total: '8',
          new_patients: '5',
          follow_ups: '3',
        },
      ])
      .mockResolvedValueOnce(monthlyRows)
      .mockResolvedValueOnce([
        { condition: 'Back Pain', count: '7' },
        { condition: 'Knee Pain', count: '6' },
        { condition: 'Migraine', count: '5' },
        { condition: 'Fever', count: '4' },
        { condition: 'Diabetes', count: '3' },
        { condition: 'Must Be Capped', count: '2' },
      ])
      .mockResolvedValueOnce([
        { label: '0–18', count: '1', sort_order: 1 },
        { label: '19–30', count: '2', sort_order: 2 },
      ]);
    const repository = new AppointmentLifecycleRepository({ execute } as unknown as Database);

    const result = await repository.getDoctorAnalytics(clinicId, doctorId);

    expect(execute).toHaveBeenCalledTimes(6);
    expect(result.stats).toEqual({
      confirmedThisMonth: 9,
      newConfirmedThisMonth: 4,
      followUpConfirmedThisMonth: 5,
      averageConfirmedPerDay: 3,
    });
    expect(result.trends.daily).toEqual([
      {
        periodStart: '2026-11-17',
        label: '17 Nov',
        total: 3,
        newPatients: 2,
        followUps: 1,
      },
    ]);
    expect(result.trends.monthly).toHaveLength(6);
    expect(result.monthlySummary).toHaveLength(6);
    expect(result.monthlySummary[0]).toMatchObject({ averagePerDay: 2, total: 10 });
    expect(result.topConditions).toHaveLength(5);
    expect(result.topConditions).not.toContainEqual(
      expect.objectContaining({ condition: 'Must Be Capped' }),
    );
    expect(result.ageGroups).toEqual([
      { label: '0–18', count: 1 },
      { label: '19–30', count: 2 },
    ]);

    const queries = execute.mock.calls.map(([statement]) => new PgDialect().sqlToQuery(statement));
    for (const query of queries) {
      expect(query.params).toContain(clinicId);
      expect(query.params).toContain(doctorId);
      expect(query.sql).not.toMatch(/patient_name|patient_phone|examination_notes|advice/);
    }

    expect(queries[0]!.sql).toContain("a.status = 'confirmed'");
    expect(queries[0]!.sql).toContain('now() AT TIME ZONE c.timezone');
    expect(queries[0]!.sql).toContain('count(DISTINCT appointment_date)');

    for (const query of queries.slice(1, 4)) {
      expect(query.sql).toContain("a.status IN ('confirmed', 'visited')");
      expect(query.sql).toContain('a.clinic_id =');
      expect(query.sql).toContain('a.doctor_id =');
    }
    expect(queries[1]!.sql).toContain("interval '6 days'");
    expect(queries[2]!.sql).toContain("interval '5 weeks'");
    expect(queries[3]!.sql).toContain("interval '5 months'");
    expect(queries[3]!.sql).toContain("interval '1 month'");

    expect(queries[4]!.sql).toContain('FROM patient_visits AS v');
    expect(queries[4]!.sql).toContain("regexp_replace(btrim(v.diagnosis), '\\s+', ' ', 'g')");
    expect(queries[4]!.sql).not.toContain('v.visited_at');
    expect(queries[4]!.sql).toContain('LIMIT 5');
    expect(queries[4]!.sql).toContain('ORDER BY count DESC, normalized_condition ASC');

    expect(queries[5]!.sql).toContain("a.status IN ('confirmed', 'visited')");
    expect(queries[5]!.sql).toContain('SELECT DISTINCT');
    expect(queries[5]!.sql).toContain('p.id');
    expect(queries[5]!.sql).toContain('p.age_years');
    expect(queries[5]!.sql).toContain('p.date_of_birth');
  });
});
