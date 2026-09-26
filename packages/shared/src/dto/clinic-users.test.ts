import { describe, expect, it } from 'vitest';

import { createClinicUserLoginSchema, updateClinicUserLoginSchema } from './clinic-users';

describe('clinic user credential schemas', () => {
  it('normalizes only the editable username prefix', () => {
    const result = createClinicUserLoginSchema.parse({
      role: 'doctor',
      doctor_id: '00000000-0000-0000-0000-000000000202',
      login_name: '  Dr. Priya Kumar  ',
      password: 'secret12',
    });

    expect(result.login_name).toBe('dr.priya.kumar');
  });

  it('normalizes repeated and mixed separators consistently with the web form', () => {
    const result = createClinicUserLoginSchema.parse({
      role: 'clinic_admin',
      login_name: '  Priya__.-Admin  ',
      password: 'secret12',
    });

    expect(result.login_name).toBe('priya.admin');
  });

  it('rejects a prefix that sanitizes to an empty value', () => {
    const result = createClinicUserLoginSchema.safeParse({
      role: 'clinic_admin',
      login_name: '---...',
      password: 'secret12',
    });

    expect(result.success).toBe(false);
  });

  it('requires at least one credential change', () => {
    expect(updateClinicUserLoginSchema.safeParse({}).success).toBe(false);
    expect(updateClinicUserLoginSchema.safeParse({ password: 'newSecret12' }).success).toBe(true);
    expect(updateClinicUserLoginSchema.safeParse({ login_name: 'New Admin' }).success).toBe(true);
  });
});
