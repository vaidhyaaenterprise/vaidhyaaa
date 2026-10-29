import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { ApiEnv } from '@vaidya/config';
import type { DatabaseConnection, Repositories } from '@vaidya/db';
import type { ServiceRouterAdapter } from '@vaidya/shared';
import { SarvamToolsController } from '../src/modules/sarvam-tools/sarvam-tools.controller';
import type { SlotService } from '../src/modules/slots/slot.service';
import type { SlotHoldService } from '../src/modules/slots/slot-hold.service';
import type { BookingAppointmentService } from '../src/modules/booking/booking-appointment.service';
import type { KnowledgeSearchService } from '../src/modules/knowledge/knowledge-search.service';
import type { AppointmentLookupService } from '../src/modules/patient-action/appointment-lookup.service';
import type { StaffNotificationService } from '../src/modules/patient-action/staff-notification.service';

const date = '2026-11-02';
function slot(time: string, availableCount = 1, slotDate = date) {
  return {
    slot_id: `${slotDate}-${time}`,
    start_time: `${slotDate} ${time}:00`,
    end_time: `${slotDate} ${time}:00`,
    available_count: availableCount,
  };
}
// Deliberately unsorted; selection must not depend on database return order.
const slots = [
  slot('13:30'),
  slot('10:00'),
  slot('11:45'),
  slot('12:00'),
  slot('09:00'),
  slot('11:15'),
  slot('13:00'),
  slot('11:30'),
  slot('12:30'),
];

function setup(rows = slots) {
  const findAvailableSlots = vi.fn().mockResolvedValue(rows);
  const controller = new SarvamToolsController(
    { db: {} } as DatabaseConnection,
    { findAvailableSlots } as unknown as SlotService,
    {} as SlotHoldService,
    {} as BookingAppointmentService,
    {} as KnowledgeSearchService,
    {} as AppointmentLookupService,
    {} as StaffNotificationService,
    {} as ServiceRouterAdapter,
    {} as ApiEnv,
  );
  const repos = {
    clinics: { getClinicLocation: vi.fn().mockResolvedValue([{ timezone: 'Asia/Kolkata' }]) },
    clinical: {
      listServices: vi
        .fn()
        .mockResolvedValue([
          { id: 'service-1', active: true, serviceName: 'Consultation', serviceKey: 'general' },
        ]),
      listActiveDoctorServices: vi
        .fn()
        .mockResolvedValue([
          {
            doctorId: 'doctor-1',
            doctorName: 'Dr. Test',
            clinicServiceId: 'service-1',
            qualification: null,
          },
        ]),
    },
  } as unknown as Repositories;
  (controller as unknown as { repos: Repositories }).repos = repos;
  const check = (params: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    controller.checkSlots(
      {
        clinic_id: 'clinic-1',
        doctor_id: 'doctor-1',
        clinic_service_id: 'service-1',
        date,
        ...params,
      },
      { headers } as FastifyRequest,
    );
  return { controller, check, findAvailableSlots };
}

describe('Sarvam check-slots time bounds', () => {
  it.each(['12', '12:00', '12 PM', '12:00 pm'])(
    'returns the latest three slots strictly before noon (%s)',
    async (beforeTime) => {
      const { check, findAvailableSlots } = setup();
      expect(await check({ before_time: beforeTime })).toMatchObject({
        success: true,
        date,
        doctorId: 'doctor-1',
        clinicServiceId: 'service-1',
        availableSlotsText: '11:15, 11:30, or 11:45',
        error: '',
      });
      expect(findAvailableSlots).toHaveBeenCalledWith('clinic-1', 'doctor-1', 'service-1', date);
    },
  );

  it.each(['12', '12:00', '12:00 PM'])(
    'returns the earliest three slots at or after noon (%s)',
    async (afterTime) => {
      expect(await setup().check({ after_time: afterTime })).toMatchObject({
        success: true,
        availableSlotsText: '12:00, 12:30, or 1:00',
      });
    },
  );

  it('reads before_time from underscored and hyphenated headers', async () => {
    for (const header of ['before_time', 'before-time']) {
      expect(await setup().check({}, { [header]: '12:00' })).toMatchObject({
        availableSlotsText: '11:15, 11:30, or 11:45',
      });
    }
    expect(await setup().check({}, { 'after-time': '12:00' })).toMatchObject({
      availableSlotsText: '12:00, 12:30, or 1:00',
    });
  });

  it('intersects both bounds and returns the first three matches', async () => {
    expect(await setup().check({ after_time: '11:15', before_time: '12:30' })).toMatchObject({
      availableSlotsText: '11:15, 11:30, or 11:45',
    });
  });

  it('preserves date, time-preference and capacity filtering before taking the last three', async () => {
    const { check } = setup([
      ...slots,
      slot('16:00'),
      slot('16:15', 0),
      slot('16:30'),
      slot('16:45', 1, '2026-11-03'),
      slot('17:00'),
    ]);
    expect(await check({ before_time: '5 PM', time_preference: 'afternoon' })).toMatchObject({
      availableSlotsText: '1:30, 4:00, or 4:30 in the afternoon',
    });
  });

  it('returns fewer than three matches or no slots without falling back outside the bounds', async () => {
    const { check } = setup();
    expect(await check({ before_time: '10:30' })).toMatchObject({
      availableSlotsText: '9:00, or 10:00',
    });
    expect(await check({ before_time: '9 AM' })).toMatchObject({
      success: true,
      availableSlotsText: 'no slots',
    });
    expect(await check({ after_time: '2 PM' })).toMatchObject({
      success: true,
      availableSlotsText: 'no slots',
    });
  });

  it('handles midnight and noon without confusing AM and PM', async () => {
    const { check } = setup([slot('00:00'), slot('00:30'), slot('01:00'), slot('12:00')]);
    expect(await check({ before_time: '12 AM' })).toMatchObject({ availableSlotsText: 'no slots' });
    expect(await check({ after_time: '12 AM' })).toMatchObject({
      availableSlotsText: '12:00, 12:30, or 1:00',
    });
  });

  it.each(['25:00', '12:60', '13 PM', '00 AM', 'before twelve'])(
    'rejects invalid cutoffs (%s) instead of ignoring them',
    async (time) => {
      const { check, findAvailableSlots } = setup();
      expect(await check({ before_time: time })).toEqual({
        success: false,
        error: 'invalid_before_time',
      });
      expect(await check({ after_time: time })).toEqual({
        success: false,
        error: 'invalid_after_time',
      });
      expect(findAvailableSlots).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['12:00', '12:00'],
    ['13:00', '12:00'],
  ])('rejects an empty or reversed range (%s–%s)', async (after, before) => {
    expect(await setup().check({ after_time: after, before_time: before })).toEqual({
      success: false,
      error: 'invalid_time_range',
    });
  });

  it('accepts ISO-shaped slot starts and retains the existing four-slot default without time bounds', async () => {
    const { check } = setup(
      slots.map((row) => ({ ...row, start_time: row.start_time.replace(' ', 'T') })),
    );
    expect(await check({ before_time: '12:00' })).toMatchObject({
      availableSlotsText: '11:15, 11:30, or 11:45',
    });
    expect(await check()).toMatchObject({
      availableSlotsText: '9:00, 10:00, 11:15, or 11:30',
    });
  });
});
