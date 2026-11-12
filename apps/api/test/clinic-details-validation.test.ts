import { describe, expect, it, vi } from 'vitest';
import { ClinicSettingsService } from '../src/modules/clinic-setup/clinic-settings.service';
import { ClinicClinicalService } from '../src/modules/clinic-setup/clinic-clinical.service';
import { SlotRuleChangeImpactService } from '../src/modules/slots/slot-rule-change-impact.service';

const current = {
  name: 'Care Clinic',
  primaryPhone: '9876543210',
  addressLine1: '42 Clinic Road',
  addressLine2: 'Near the park',
  city: 'Chennai',
  state: 'Tamil Nadu',
  postalCode: '600097',
  country: 'India',
};
function harness(profile = current) {
  const service = Object.create(ClinicSettingsService.prototype) as ClinicSettingsService;
  const updateClinicProfile = vi.fn().mockResolvedValue([{ ...profile, name: 'New clinic' }]);
  Object.defineProperty(service, 'dbService', {
    value: {
      findClinicById: vi.fn().mockResolvedValue(profile),
      insertAuditLog: vi.fn().mockResolvedValue(undefined),
    },
  });
  Object.defineProperty(service, 'repos', { value: { clinics: { updateClinicProfile } } });
  return { service, updateClinicProfile };
}

describe('clinic profile save validation', () => {
  it('does not let a partial API update leave a legacy profile incomplete', async () => {
    const { service, updateClinicProfile } = harness({ ...current, addressLine2: '' });
    await expect(
      service.patchClinicProfile('clinic-1', { name: 'New clinic' }, 'admin-1'),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Address line 2 is required.',
    });
    expect(updateClinicProfile).not.toHaveBeenCalled();
  });
  it.each([{ primary_phone: '9876' }, { postal_code: '000097' }, { country: '   ' }])(
    'blocks invalid details without a database update: %j',
    async (patch) => {
      const { service, updateClinicProfile } = harness();
      await expect(service.patchClinicProfile('clinic-1', patch, 'admin-1')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(updateClinicProfile).not.toHaveBeenCalled();
    },
  );
  it('allows a valid partial update on a complete profile', async () => {
    const { service, updateClinicProfile } = harness();
    await service.patchClinicProfile('clinic-1', { name: 'New clinic' }, 'admin-1');
    expect(updateClinicProfile).toHaveBeenCalledWith('clinic-1', { name: 'New clinic' });
  });
});

describe('minimum slot duration service boundaries', () => {
  it.each([5, 10, 14])('rejects %s minutes before reading or changing data', async (duration) => {
    const clinical = Object.create(ClinicClinicalService.prototype) as ClinicClinicalService;
    const impact = Object.create(
      SlotRuleChangeImpactService.prototype,
    ) as SlotRuleChangeImpactService;
    await expect(
      clinical.patchBookingRule('clinic-1', 'rule-1', { slot_duration_minutes: duration }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(impact.applyDurationChange('clinic-1', 'rule-1', duration)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(
      impact.previewDurationChange('clinic-1', 'rule-1', duration),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
