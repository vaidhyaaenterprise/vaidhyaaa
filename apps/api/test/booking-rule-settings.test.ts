import { describe, expect, it, vi } from 'vitest';
import { ClinicClinicalService } from '../src/modules/clinic-setup/clinic-clinical.service';

function dependency(target: object, name: string, value: unknown) {
  Object.defineProperty(target, name, { value });
}

const rule = {
  id: 'rule-1',
  clinicId: 'clinic-1',
  doctorId: 'doctor-1',
  clinicServiceId: 'service-1',
  slotDurationMinutes: 30,
  capacityPerSlot: 3,
  bookingHorizonDays: 180,
  manualEditCutoffBeforeStartMinutes: 60,
  manualEditMaxShiftMinutes: 120,
  minBookingNoticeMinutes: 0,
  maxAdvanceBookingDays: null,
  effectiveFrom: '2026-10-01',
  effectiveTo: null,
  active: true,
  version: 1,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};

function harness() {
  const service = Object.create(ClinicClinicalService.prototype) as ClinicClinicalService;
  const patchBookingRule = vi.fn().mockResolvedValue([{ ...rule, bookingHorizonDays: 45 }]);
  const repos = {
    slots: { findBookingRule: vi.fn().mockResolvedValue([rule]) },
    clinicalSetup: { patchBookingRule },
  };
  const save = vi.fn(
    async (_clinic: string, _scope: unknown, mutate: (value: typeof repos) => unknown) =>
      mutate(repos),
  );
  dependency(service, 'repos', repos);
  dependency(service, 'slotReconciliation', { save });
  dependency(
    service,
    'ensureBookingRulesForActiveMappings',
    vi.fn().mockResolvedValue({
      rules: [rule],
      mappings: [{ doctorId: rule.doctorId, clinicServiceId: rule.clinicServiceId, active: true }],
    }),
  );
  return { service, patchBookingRule, save };
}

describe('booking rule settings', () => {
  it('returns the fixed horizon and no retired edit settings for legacy rules', async () => {
    const { service } = harness();
    const [response] = await service.listBookingRules('clinic-1');
    expect(response?.booking_horizon_days).toBe(45);
    expect(response).not.toHaveProperty('manual_edit_cutoff_before_start_minutes');
    expect(response).not.toHaveProperty('manual_edit_max_shift_minutes');
  });

  it('ignores retired inputs and persists the fixed horizon with the background job', async () => {
    const { service, patchBookingRule, save } = harness();
    const legacyInput = {
      manual_edit_cutoff_before_start_minutes: 90,
      manual_edit_max_shift_minutes: 180,
      active: true,
    };
    const response = await service.patchBookingRule('clinic-1', 'rule-1', legacyInput);
    expect(patchBookingRule).toHaveBeenCalledWith('clinic-1', 'rule-1', {
      bookingHorizonDays: 45,
      active: true,
    });
    expect(save).toHaveBeenCalledOnce();
    expect(response.booking_horizon_days).toBe(45);
    expect(response).not.toHaveProperty('manual_edit_cutoff_before_start_minutes');
    expect(response).not.toHaveProperty('manual_edit_max_shift_minutes');
  });

  it('rejects a different horizon before saving or enqueueing work', async () => {
    const { service, patchBookingRule, save } = harness();
    // Exercise validation of an untyped API payload rather than the DTO type.
    const input = { booking_horizon_days: 180 } as unknown as Parameters<
      ClinicClinicalService['patchBookingRule']
    >[2];
    await expect(service.patchBookingRule('clinic-1', 'rule-1', input)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(patchBookingRule).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('delegates combined duration and capacity changes once without a second save', async () => {
    const { service, save } = harness();
    const applyBookingRuleUpdate = vi.fn().mockResolvedValue({
      ...rule,
      slotDurationMinutes: 30,
      capacityPerSlot: 2,
      effectiveFrom: '2026-10-25',
    });
    dependency(service, 'scheduleChangeImpact', {
      previewBookingRuleChange: vi.fn().mockResolvedValue({ blocked: true, conflicts: [] }),
      applyBookingRuleUpdate,
    });
    const patch = {
      slot_duration_minutes: 30,
      capacity_per_slot: 2,
      implement_from: '2026-10-25 00:00',
    };
    expect(await service.patchBookingRule('clinic-1', 'rule-1', patch)).toMatchObject({
      effective_from: '2026-10-25',
    });
    expect(applyBookingRuleUpdate).toHaveBeenCalledOnce();
    expect(applyBookingRuleUpdate).toHaveBeenCalledWith('clinic-1', 'rule-1', patch);
    expect(save).not.toHaveBeenCalled();
  });
});
