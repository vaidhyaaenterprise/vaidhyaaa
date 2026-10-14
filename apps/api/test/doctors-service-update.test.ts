import { describe, expect, it, vi } from 'vitest';

import { DoctorsService } from '../src/modules/doctors/doctors.service';

function installPrivateDependency(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value });
}

function createHarness() {
  const tx = { transaction: true };
  const updatedDoctor = {
    id: 'doctor-1',
    clinicId: 'clinic-1',
    userId: 'user-1',
    name: 'Dr Updated',
    qualification: 'DM',
    active: true,
  };
  const doctors = {
    updateDoctor: vi.fn().mockResolvedValue([updatedDoctor]),
    updateLinkedUserName: vi.fn().mockResolvedValue([{ id: 'user-1', name: 'Dr Updated' }]),
  };
  const dbService = {
    assertDoctorBelongsToClinic: vi.fn().mockResolvedValue(undefined),
    withTransaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
    insertAuditLog: vi.fn().mockResolvedValue(undefined),
  };
  const service = Object.create(DoctorsService.prototype) as DoctorsService;
  installPrivateDependency(service, 'repos', { doctors });
  installPrivateDependency(service, 'dbService', dbService);
  return { service, doctors, dbService, tx, updatedDoctor };
}

describe('DoctorsService.updateDoctor', () => {
  it('persists qualification and synchronizes a linked login name', async () => {
    const harness = createHarness();

    await expect(
      harness.service.updateDoctor(
        'clinic-1',
        'doctor-1',
        { name: ' Dr Updated ', qualification: ' DM ' },
        'admin-1',
      ),
    ).resolves.toEqual(harness.updatedDoctor);

    expect(harness.doctors.updateDoctor).toHaveBeenCalledWith(
      'clinic-1',
      'doctor-1',
      { name: 'Dr Updated', qualification: 'DM' },
      harness.tx,
    );
    expect(harness.doctors.updateLinkedUserName).toHaveBeenCalledWith(
      'user-1',
      'Dr Updated',
      harness.tx,
    );
    expect(harness.dbService.insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'clinic.doctor.updated',
        newValues: { name: 'Dr Updated', qualification: 'DM' },
      }),
    );
  });

  it('rejects an empty patch', async () => {
    const harness = createHarness();

    await expect(
      harness.service.updateDoctor('clinic-1', 'doctor-1', {}, 'admin-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(harness.doctors.updateDoctor).not.toHaveBeenCalled();
  });
});
