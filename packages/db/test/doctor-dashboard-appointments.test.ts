import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabaseConnection, createDatabaseConnection } from '../src/client';
import { AppointmentLifecycleRepository } from '../src/repositories/appointment-lifecycle.repository';

const connection = createDatabaseConnection('postgresql://postgres:postgres@localhost:5432/test');
afterAll(() => closeDatabaseConnection(connection));
const repository = new AppointmentLifecycleRepository(connection.db);

describe('doctor dashboard appointment query', () => {
  it('filters the full clinic-local appointment day with doctor/status scope and an exclusive next midnight', () => {
    const query = repository
      .listAppointmentsForClinic({
        clinicId: 'clinic-1',
        doctorId: 'doctor-1',
        statuses: ['confirmed', 'visited'],
        date: '2026-11-16',
      })
      .toSQL();
    expect(query.sql).toMatch(/"appointment_requests"\."appointment_start" >= \$\d+::date/);
    expect(query.sql).toMatch(
      /"appointment_requests"\."appointment_start" < \$\d+::date \+ interval '1 day'/,
    );
    expect(query.sql).toContain('"appointment_requests"."doctor_id" =');
    expect(query.sql).toContain('"appointment_requests"."clinic_id" =');
    expect(query.params).toEqual([
      'clinic-1',
      'doctor-1',
      'confirmed',
      'visited',
      '2026-11-16',
      '2026-11-16',
    ]);
    expect(query.params.some((value) => value instanceof Date)).toBe(false);
  });

  it('joins demographics by the same clinic and canonical patient ID without matching names or shared phones', () => {
    const query = repository.listAppointmentsForClinic({ clinicId: 'clinic-1' }).toSQL();
    expect(query.sql).toContain(
      'left join "patients" on ("patients"."clinic_id" = "appointment_requests"."clinic_id" and "patients"."id" = "appointment_requests"."patient_id")',
    );
    expect(query.sql).toContain('"patients"."age_years"');
    expect(query.sql).toContain('"patients"."date_of_birth"');
    expect(query.sql).toContain('"patients"."gender"');
    expect(query.sql).not.toMatch(/"patients"\."(?:phone|name|normalized_phone|normalized_name)"/);
    expect(query.params).toEqual(['clinic-1']);
  });

  it('derives clinical-history availability through the linked patient and excludes this appointment own visit', () => {
    const query = repository.listAppointmentsForClinic({ clinicId: 'clinic-1' }).toSQL();
    expect(query.sql).toContain('select 1 from "patient_visits"');
    expect(query.sql).toContain(
      '"patient_visits"."clinic_id" = "appointment_requests"."clinic_id"',
    );
    expect(query.sql).toContain(
      '"patient_visits"."patient_id" = "appointment_requests"."patient_id"',
    );
    expect(query.sql).toContain(
      '"patient_visits"."appointment_request_id" is distinct from "appointment_requests"."id"',
    );
  });

  it('keeps legacy list queries unrestricted by date or status when neither filter is supplied', () => {
    const query = repository.listAppointmentsForClinic({ clinicId: 'clinic-1' }).toSQL();
    expect(query.sql).not.toMatch(/appointment_start" [<>]/);
    expect(query.sql).not.toContain('"appointment_requests"."status" in');
    expect(query.sql).toContain('order by "appointment_requests"."appointment_start" desc');
  });
});
