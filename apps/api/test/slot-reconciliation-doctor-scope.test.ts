import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { AuthContext } from '@vaidya/shared';

import { AUTH_CONTEXT_KEY } from '../src/common/guards/auth.guard';
import { SlotReconciliationController } from '../src/modules/slots/slot-reconciliation.controller';

const clinicId = '00000000-0000-0000-0000-000000000001';
const otherClinicId = '00000000-0000-0000-0000-000000000002';
const doctorId = '00000000-0000-0000-0000-000000000101';
const otherDoctorId = '00000000-0000-0000-0000-000000000102';
const serviceId = '00000000-0000-0000-0000-000000000201';
const doctorAuth: AuthContext = {
  userId: '00000000-0000-0000-0000-000000000301',
  clinicId,
  clinicRole: 'doctor',
  doctorId,
};

function request(auth?: AuthContext) {
  return (auth ? { [AUTH_CONTEXT_KEY]: auth } : {}) as FastifyRequest & {
    [AUTH_CONTEXT_KEY]?: AuthContext;
  };
}

function setup() {
  const status = vi.fn().mockResolvedValue({ state: 'updating', remaining: 1, failed: 0 });
  const controller = new SlotReconciliationController({ status } as never);
  return { controller, status };
}

describe('doctor slot reconciliation status scope', () => {
  it('defaults an omitted doctor filter to the authenticated doctor and forwards the service filter', async () => {
    const { controller, status } = setup();
    await expect(
      controller.status(clinicId, request(doctorAuth), undefined, serviceId),
    ).resolves.toEqual({ state: 'updating', remaining: 1, failed: 0 });
    expect(status).toHaveBeenCalledWith(clinicId, doctorId, serviceId);
  });

  it('allows the explicit authenticated doctor ID', async () => {
    const { controller, status } = setup();
    await controller.status(clinicId, request(doctorAuth), doctorId);
    expect(status).toHaveBeenCalledWith(clinicId, doctorId, undefined);
  });

  it.each([otherDoctorId, ''])(
    'rejects a doctor filter that is not the authenticated doctor: %s',
    (filter) => {
      const { controller, status } = setup();
      expect(() => controller.status(clinicId, request(doctorAuth), filter)).toThrow(
        'Doctors may only view their own slot update status.',
      );
      expect(status).not.toHaveBeenCalled();
    },
  );

  it('fails closed when the account has no linked doctor', () => {
    const { controller, status } = setup();
    const { doctorId: _doctorId, ...unlinkedDoctor } = doctorAuth;
    expect(() => controller.status(clinicId, request(unlinkedDoctor))).toThrow(
      'A doctor profile for this clinic is required.',
    );
    expect(status).not.toHaveBeenCalled();
  });

  it('rejects another clinic even when the requested doctor ID matches the account', () => {
    const { controller, status } = setup();
    expect(() => controller.status(otherClinicId, request(doctorAuth), doctorId)).toThrow(
      'A doctor profile for this clinic is required.',
    );
    expect(status).not.toHaveBeenCalled();
  });

  it('requires authentication before loading job state', () => {
    const { controller, status } = setup();
    expect(() => controller.status(clinicId, request())).toThrow('Authentication is required.');
    expect(status).not.toHaveBeenCalled();
  });

  it('retains clinic admin access to clinic-wide or explicitly filtered state', async () => {
    const { controller, status } = setup();
    const admin = request({ userId: doctorAuth.userId, clinicId, clinicRole: 'clinic_admin' });
    await controller.status(clinicId, admin);
    await controller.status(clinicId, admin, otherDoctorId, serviceId);
    expect(status.mock.calls).toEqual([
      [clinicId, undefined, undefined],
      [clinicId, otherDoctorId, serviceId],
    ]);
  });

  it('retains doctor and service identifier validation', () => {
    const { controller, status } = setup();
    const admin = request({ userId: doctorAuth.userId, clinicId, clinicRole: 'clinic_admin' });
    expect(() => controller.status(clinicId, admin, 'invalid-doctor')).toThrow(
      'Select a valid doctor and service.',
    );
    expect(() =>
      controller.status(clinicId, request(doctorAuth), doctorId, 'invalid-service'),
    ).toThrow('Select a valid doctor and service.');
    expect(status).not.toHaveBeenCalled();
  });
});
