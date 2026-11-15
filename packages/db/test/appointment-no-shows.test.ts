import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/client';
import { AppointmentLifecycleRepository } from '../src/repositories/appointment-lifecycle.repository';

describe('end-of-day no-show update', () => {
  it('uses clinic-local midnight, only changes confirmed appointments, and records each transition atomically', async () => {
    const execute = vi.fn().mockResolvedValue([{ updated_count: 3 }]);
    const repo = new AppointmentLifecycleRepository({ execute } as unknown as Database);
    await expect(repo.markPastConfirmedNoShows('clinic-1')).resolves.toBe(3);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
    expect(query.sql).toContain("a.status = 'confirmed'");
    expect(query.sql).toContain('a.appointment_start < (now() AT TIME ZONE c.timezone)::date');
    expect(query.sql).not.toContain('appointment_end');
    expect(query.sql).not.toContain('<=');
    expect(query.sql).toContain('a.clinic_id = c.id');
    expect(query.sql).toContain('AND a.clinic_id = $1');
    expect(query.params).toEqual(['clinic-1']);
    expect(query.sql).toContain("SET status = 'no_show'");
    expect(query.sql).toContain('INSERT INTO appointment_events');
    expect(query.sql).toContain("'appointment.no_show', 'system'");
    expect(query.sql).toContain('FROM transitioned');
    expect(query.sql).toContain('r.clinic_id = t.clinic_id AND r.appointment_id = t.id');
    expect(query.sql).toContain("r.status = 'pending'");
  });

  it('supports the scheduled all-clinic run and reports no changes on a repeated run', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ updated_count: 1 }])
      .mockResolvedValueOnce([{ updated_count: 0 }]);
    const repo = new AppointmentLifecycleRepository({ execute } as unknown as Database);
    await expect(repo.markPastConfirmedNoShows()).resolves.toBe(1);
    await expect(repo.markPastConfirmedNoShows()).resolves.toBe(0);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
    expect(query.params).toEqual([]);
  });

  it('preserves only explicit historical confirmations for the same appointment time, invalidated by rescheduling', async () => {
    const execute = vi.fn().mockResolvedValue([{ updated_count: 0 }]);
    await new AppointmentLifecycleRepository({
      execute,
    } as unknown as Database).markPastConfirmedNoShows();
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
    expect(query.sql).toContain("e.event_type = 'appointment.status_corrected'");
    expect(query.sql).toContain("e.new_values_json->>'status' = 'confirmed'");
    expect(query.sql).toContain(
      "(e.new_values_json->>'appointment_start')::timestamp = a.appointment_start",
    );
    expect(query.sql).toContain(
      '(e.created_at AT TIME ZONE c.timezone)::date > a.appointment_start::date',
    );
    expect(query.sql).toContain("later.event_type = 'appointment.rescheduled'");
    expect(query.sql).toContain('later.created_at >= e.created_at');
  });
});
