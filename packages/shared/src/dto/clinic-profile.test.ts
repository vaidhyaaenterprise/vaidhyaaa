import { describe, expect, it } from 'vitest';
import {
  clinicProfileDetailsSchema,
  clinicProfilePatchSchema,
  clinicProfileResponseSchema,
} from './clinic-profile';

const valid = {
  name: 'Care Clinic',
  primary_phone: '9876543210',
  address_line1: '42 Clinic Road',
  address_line2: 'Near the park',
  city: 'Chennai',
  state: 'Tamil Nadu',
  postal_code: '600097',
  country: 'India',
};

describe('clinic details validation', () => {
  it.each(Object.keys(valid))('requires %s, including address line 2', (field) => {
    for (const value of ['', '   ', null, undefined]) {
      expect(clinicProfileDetailsSchema.safeParse({ ...valid, [field]: value }).success).toBe(
        false,
      );
      if (value !== undefined)
        expect(clinicProfilePatchSchema.safeParse({ [field]: value }).success).toBe(false);
    }
  });
  it.each(['123456789', '12345678901', '+919876543210', '98765abc10', '98765 43210', '1e98765432'])(
    'rejects invalid phone %s',
    (phone) => {
      expect(clinicProfileDetailsSchema.safeParse({ ...valid, primary_phone: phone }).success).toBe(
        false,
      );
    },
  );
  it.each(['60009', '6000971', '000097', '60A097', '600 97'])('rejects invalid PIN %s', (pin) => {
    expect(clinicProfileDetailsSchema.safeParse({ ...valid, postal_code: pin }).success).toBe(
      false,
    );
  });
  it('trims text and supports valid partial patches without allowing empty values', () => {
    expect(clinicProfileDetailsSchema.parse({ ...valid, name: '  Care Clinic  ' }).name).toBe(
      'Care Clinic',
    );
    expect(clinicProfilePatchSchema.parse({ name: 'New name' })).toEqual({ name: 'New name' });
    expect(clinicProfilePatchSchema.safeParse({}).success).toBe(false);
  });
  it('still reads legacy incomplete profiles so they can be corrected', () => {
    expect(
      clinicProfileResponseSchema.safeParse({
        ...valid,
        primary_phone: null,
        address_line2: null,
        clinic_unique_number: 1003,
        timezone: 'Asia/Kolkata',
      }).success,
    ).toBe(true);
  });
});
