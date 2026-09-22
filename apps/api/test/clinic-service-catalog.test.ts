import { describe, expect, it, vi } from 'vitest';

import { ClinicClinicalService } from '../src/modules/clinic-setup/clinic-clinical.service';

function installPrivateDependency(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value });
}

function clinicServiceRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'service-1',
    clinicId: 'clinic-1',
    serviceKey: 'general_consultation',
    serviceName: 'General Consultation',
    description: null,
    handlesJson: [],
    doesNotHandleJson: [],
    redFlagsJson: [],
    routingExamplesJson: [],
    requiresStaffConfirmation: false,
    active: true,
    createdAt: new Date('2026-09-22T00:00:00.000Z'),
    updatedAt: new Date('2026-09-22T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ClinicClinicalService predefined services', () => {
  it('upserts a predefined service using its exact key and canonical stored name', async () => {
    const upsertClinicService = vi.fn().mockResolvedValue([clinicServiceRow()]);
    const clinicalSetup = {
      upsertClinicService,
      listServices: vi.fn(),
      createClinicService: vi.fn(),
    };
    const service = Object.create(ClinicClinicalService.prototype) as ClinicClinicalService;
    installPrivateDependency(service, 'repos', { clinicalSetup });

    const result = await service.createClinicService('clinic-1', {
      service_key: 'general_consultation',
      service_name: 'General_Consultation',
      active: true,
    });

    expect(upsertClinicService).toHaveBeenCalledWith({
      clinicId: 'clinic-1',
      serviceKey: 'general_consultation',
      serviceName: 'General Consultation',
      description: null,
      handlesJson: [],
      doesNotHandleJson: [],
      redFlagsJson: [],
      routingExamplesJson: [],
      active: true,
    });
    expect(clinicalSetup.listServices).not.toHaveBeenCalled();
    expect(clinicalSetup.createClinicService).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: 'service-1',
        service_key: 'general_consultation',
        service_name: 'General Consultation',
      }),
    );
  });

  it('preserves the existing custom-service suffix behavior outside the catalog', async () => {
    const createClinicService = vi
      .fn()
      .mockResolvedValue([
        clinicServiceRow({
          id: 'custom-service-2',
          serviceKey: 'custom_service_2',
          serviceName: 'Custom Service',
        }),
      ]);
    const clinicalSetup = {
      upsertClinicService: vi.fn(),
      listServices: vi.fn().mockResolvedValue([
        clinicServiceRow({
          id: 'custom-service-1',
          serviceKey: 'custom_service',
          serviceName: 'Custom Service',
        }),
      ]),
      createClinicService,
    };
    const service = Object.create(ClinicClinicalService.prototype) as ClinicClinicalService;
    installPrivateDependency(service, 'repos', { clinicalSetup });

    await service.createClinicService('clinic-1', {
      service_key: 'custom_service',
      service_name: 'Custom Service',
    });

    expect(clinicalSetup.upsertClinicService).not.toHaveBeenCalled();
    expect(createClinicService).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: 'clinic-1',
        serviceKey: 'custom_service_2',
        serviceName: 'Custom Service',
      }),
    );
  });
});
