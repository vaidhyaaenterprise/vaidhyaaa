import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import {
  addDays,
  combineDateAndTime,
  dayOfWeekMon1,
  DEFAULT_HOLD_TTL_MS,
  formatClinicLocalTimestamp,
  formatDateInTimezone,
} from '@vaidya/db';
import { AppError, JOB_QUEUE_MAP, JOB_TYPES } from '@vaidya/shared';

import { JobExecutorService } from '../src/common/jobs/job-executor.service';
import { SlotGenerationService } from '../src/modules/slots/slot-generation.service';
import { SlotHoldExpiryService } from '../src/modules/slots/slot-hold-expiry.service';
import { SlotHoldService } from '../src/modules/slots/slot-hold.service';
import { SlotRuleChangeImpactService } from '../src/modules/slots/slot-rule-change-impact.service';
import { SlotService } from '../src/modules/slots/slot.service';

import { prepareTestDatabase } from './db-setup';
import { createTestApp } from './test-app';
import { SEED } from './test-constants';

const TIMEZONE = 'Asia/Kolkata';

type SlotRow = {
  id: string;
  start_time: Date;
  end_time: Date;
  capacity_total: number;
  generated_from_rule_id: string | null;
  generation_batch_id: string | null;
  config_version: number | null;
  status: string;
};

async function nextWeekday(dateStr: string, timezone: string): Promise<string> {
  let cursor = dateStr;
  for (let i = 0; i < 14; i += 1) {
    const dow = dayOfWeekMon1(cursor, timezone);
    if (dow >= 1 && dow <= 6) {
      return cursor;
    }
    cursor = addDays(cursor, 1, timezone);
  }
  return dateStr;
}

describe('A03 expanded slot generation and hold jobs', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;
  let slotGeneration: SlotGenerationService;
  let slotHold: SlotHoldService;
  let slotService: SlotService;
  let slotHoldExpiry: SlotHoldExpiryService;
  let ruleChange: SlotRuleChangeImpactService;
  let jobExecutor: JobExecutorService;
  let muruganRuleId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5433/vaidya_test';
    process.env.QUEUE_MODE = 'inline';
    delete process.env.REDIS_URL;

    await prepareTestDatabase();
    app = await createTestApp();
    sql = postgres(process.env.DATABASE_URL, { max: 5 });

    slotGeneration = app.get(SlotGenerationService);
    slotHold = app.get(SlotHoldService);
    slotService = app.get(SlotService);
    slotHoldExpiry = app.get(SlotHoldExpiryService);
    ruleChange = app.get(SlotRuleChangeImpactService);
    jobExecutor = app.get(JobExecutorService);

    const [rule] = await sql<{ id: string }[]>`
      SELECT id FROM doctor_service_booking_rules
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND doctor_id = ${SEED.DOCTOR_MURUGAN_ID}
        AND clinic_service_id = ${SEED.GENERAL_SERVICE_ID}
        AND active = true
      LIMIT 1
    `;
    if (!rule) {
      throw new Error('Murugan booking rule not found in seed data');
    }
    muruganRuleId = rule.id;
  });

  afterAll(async () => {
    await app.close();
    await sql.end({ timeout: 5 });
  });

  async function generateMuruganSlots() {
    return slotGeneration.generateSlots({
      clinicId: SEED.CLINIC_ID,
      doctorId: SEED.DOCTOR_MURUGAN_ID,
      clinicServiceId: SEED.GENERAL_SERVICE_ID,
    });
  }

  async function countMuruganOpenSlots(): Promise<number> {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM appointment_slots
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND doctor_id = ${SEED.DOCTOR_MURUGAN_ID}
        AND clinic_service_id = ${SEED.GENERAL_SERVICE_ID}
        AND status = 'open'
    `;
    return row!.count;
  }

  async function firstFutureMuruganSlot(): Promise<SlotRow> {
    const [slot] = await sql<SlotRow[]>`
      SELECT id, start_time, end_time, capacity_total, generated_from_rule_id,
             generation_batch_id, config_version, status
      FROM appointment_slots
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND doctor_id = ${SEED.DOCTOR_MURUGAN_ID}
        AND clinic_service_id = ${SEED.GENERAL_SERVICE_ID}
        AND status = 'open'
        AND start_time > (now() AT TIME ZONE ${TIMEZONE})::timestamp
      ORDER BY start_time
      LIMIT 1
    `;
    if (!slot) {
      throw new Error('No future Murugan slot found');
    }
    return slot;
  }

  function assertRow<T>(row: T | undefined, label: string): T {
    if (!row) {
      throw new Error(`${label} not found`);
    }
    return row;
  }

  it('1. slot generation creates 45-day future slots for active doctor-service mapping', async () => {
    await sql`
      DELETE FROM appointment_slots
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND doctor_id = ${SEED.DOCTOR_MURUGAN_ID}
        AND clinic_service_id = ${SEED.GENERAL_SERVICE_ID}
    `;

    const summaries = await generateMuruganSlots();
    expect(summaries.length).toBe(1);
    expect(summaries[0]?.inserted).toBeGreaterThan(0);
    expect(summaries[0]?.horizon_days).toBe(45);

    const slot = await firstFutureMuruganSlot();
    expect(slot.generated_from_rule_id).toBe(muruganRuleId);
    expect(slot.generation_batch_id).toBeTruthy();
    expect(slot.config_version).toBe(1);
    expect(slot.capacity_total).toBe(3);

    const today = formatDateInTimezone(new Date(), TIMEZONE);
    const horizonEnd = addDays(today, 45, TIMEZONE);
    const expectedMinDate = await nextWeekday(today, TIMEZONE);
    const range = assertRow(
      (
        await sql<{ min_date: string; max_date: string }[]>`
      SELECT
        min((start_time AT TIME ZONE 'Asia/Kolkata')::date)::text AS min_date,
        max((start_time AT TIME ZONE 'Asia/Kolkata')::date)::text AS max_date
      FROM appointment_slots
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND doctor_id = ${SEED.DOCTOR_MURUGAN_ID}
        AND clinic_service_id = ${SEED.GENERAL_SERVICE_ID}
        AND status = 'open'
    `
      )[0],
      'slot date range',
    );
    expect(range.min_date).toBe(expectedMinDate);
    expect(range.max_date).toBe(horizonEnd);
  });

  it('2. slot generation skips clinic holiday', async () => {
    const today = formatDateInTimezone(new Date(), TIMEZONE);
    const holidayDate = await nextWeekday(addDays(today, 3, TIMEZONE), TIMEZONE);

    await sql`
      INSERT INTO clinic_holidays (clinic_id, holiday_date, is_full_day, reason, active)
      VALUES (${SEED.CLINIC_ID}, ${holidayDate}::date, true, 'A03 test holiday', true)
    `;

    await sql`
      DELETE FROM appointment_slots
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND doctor_id = ${SEED.DOCTOR_MURUGAN_ID}
        AND clinic_service_id = ${SEED.GENERAL_SERVICE_ID}
    `;

    await generateMuruganSlots();

    const count = assertRow(
      (
        await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM appointment_slots
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND doctor_id = ${SEED.DOCTOR_MURUGAN_ID}
        AND clinic_service_id = ${SEED.GENERAL_SERVICE_ID}
        AND status = 'open'
        AND (start_time AT TIME ZONE 'Asia/Kolkata')::date = ${holidayDate}::date
    `
      )[0],
      'holiday slot count',
    );
    expect(count.count).toBe(0);

    await sql`
      DELETE FROM clinic_holidays
      WHERE clinic_id = ${SEED.CLINIC_ID} AND holiday_date = ${holidayDate}::date
    `;
  });

  it('3. slot generation skips doctor blocked slots', async () => {
    const today = formatDateInTimezone(new Date(), TIMEZONE);
    const blockDate = await nextWeekday(addDays(today, 5, TIMEZONE), TIMEZONE);
    const blockStart = combineDateAndTime(blockDate, '18:00:00', TIMEZONE);
    const blockEnd = combineDateAndTime(blockDate, '18:30:00', TIMEZONE);

    await sql`
      INSERT INTO doctor_blocked_slots (clinic_id, doctor_id, start_time, end_time, reason, active)
      VALUES (
        ${SEED.CLINIC_ID},
        ${SEED.DOCTOR_MURUGAN_ID},
        ${blockStart.toISOString()}::timestamptz,
        ${blockEnd.toISOString()}::timestamptz,
        'A03 block',
        true
      )
    `;

    await sql`
      DELETE FROM appointment_slots
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND doctor_id = ${SEED.DOCTOR_MURUGAN_ID}
        AND clinic_service_id = ${SEED.GENERAL_SERVICE_ID}
    `;

    await generateMuruganSlots();

    const blockedSlot = assertRow(
      (
        await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM appointment_slots
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND doctor_id = ${SEED.DOCTOR_MURUGAN_ID}
        AND clinic_service_id = ${SEED.GENERAL_SERVICE_ID}
        AND status = 'open'
        AND start_time = ${blockStart.toISOString()}::timestamptz
    `
      )[0],
      'blocked slot count',
    );
    expect(blockedSlot.count).toBe(0);

    await sql`
      DELETE FROM doctor_blocked_slots
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND doctor_id = ${SEED.DOCTOR_MURUGAN_ID}
        AND start_time = ${blockStart.toISOString()}::timestamptz
    `;
  });

  async function releaseMuruganHolds() {
    await sql`
      UPDATE slot_holds
      SET status = 'released'
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND slot_id IN (
          SELECT id FROM appointment_slots
          WHERE clinic_id = ${SEED.CLINIC_ID}
            AND doctor_id = ${SEED.DOCTOR_MURUGAN_ID}
            AND clinic_service_id = ${SEED.GENERAL_SERVICE_ID}
        )
        AND status = 'active'
    `;
  }

  async function futureMuruganSlotAt(offset: number): Promise<SlotRow> {
    const [slot] = await sql<SlotRow[]>`
      SELECT id, start_time, end_time, capacity_total, generated_from_rule_id,
             generation_batch_id, config_version, status
      FROM appointment_slots
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND doctor_id = ${SEED.DOCTOR_MURUGAN_ID}
        AND clinic_service_id = ${SEED.GENERAL_SERVICE_ID}
        AND status = 'open'
        AND start_time > (now() AT TIME ZONE ${TIMEZONE})::timestamp
      ORDER BY start_time
      OFFSET ${offset}
      LIMIT 1
    `;
    if (!slot) {
      throw new Error(`No future Murugan slot found at offset ${offset}`);
    }
    return slot;
  }

  it('4. repeated generation does not duplicate slots', async () => {
    await generateMuruganSlots();
    const before = await countMuruganOpenSlots();
    await generateMuruganSlots();
    const after = await countMuruganOpenSlots();

    expect(after).toBe(before);
  });

  it('5. slot proposal returns only slots with capacity available', async () => {
    await releaseMuruganHolds();
    const slot = await futureMuruganSlotAt(0);
    await sql`UPDATE appointment_slots SET capacity_total = 1 WHERE id = ${slot.id}`;

    await slotHold.holdSlot({
      clinicId: SEED.CLINIC_ID,
      slotId: slot.id,
      patientPhone: '+919999999901',
    });

    const proposed = await slotService.listProposableSlots(
      SEED.CLINIC_ID,
      SEED.DOCTOR_MURUGAN_ID,
      SEED.GENERAL_SERVICE_ID,
    );
    expect(proposed.some((entry) => entry.slot_id === slot.id)).toBe(false);

    await sql`UPDATE appointment_slots SET capacity_total = 3 WHERE id = ${slot.id}`;
    await sql`
      UPDATE slot_holds SET status = 'released'
      WHERE clinic_id = ${SEED.CLINIC_ID} AND slot_id = ${slot.id}
    `;
  });

  it('6. holding slot creates active slot_holds row without appointment', async () => {
    await releaseMuruganHolds();
    const slot = await futureMuruganSlotAt(1);
    const before = Date.now();
    const hold = await slotHold.holdSlot({
      clinicId: SEED.CLINIC_ID,
      slotId: slot.id,
      patientPhone: '+919999999901',
    });

    expect(hold.status).toBe('active');
    expect(hold.holdExpiresAt.getTime()).toBeGreaterThanOrEqual(before + DEFAULT_HOLD_TTL_MS - 1000);
    expect(hold.holdExpiresAt.getTime()).toBeLessThanOrEqual(before + DEFAULT_HOLD_TTL_MS + 5000);

    const appointmentCount = assertRow(
      (
        await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM appointment_requests
      WHERE clinic_id = ${SEED.CLINIC_ID} AND slot_hold_id = ${hold.id}
    `
      )[0],
      'appointment count for hold',
    );
    expect(appointmentCount.count).toBe(0);
  });

  it('7. two concurrent hold attempts on capacity=1 allow only one', async () => {
    await releaseMuruganHolds();
    const slot = await futureMuruganSlotAt(2);
    await sql`UPDATE appointment_slots SET capacity_total = 1 WHERE id = ${slot.id}`;
    await sql`
      UPDATE slot_holds SET status = 'released'
      WHERE clinic_id = ${SEED.CLINIC_ID} AND slot_id = ${slot.id} AND status = 'active'
    `;

    const results = await Promise.allSettled([
      slotHold.holdSlot({ clinicId: SEED.CLINIC_ID, slotId: slot.id }),
      slotHold.holdSlot({ clinicId: SEED.CLINIC_ID, slotId: slot.id }),
    ]);

    const successes = results.filter((result) => result.status === 'fulfilled');
    const failures = results.filter((result) => result.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect((failures[0] as PromiseRejectedResult).reason).toBeInstanceOf(AppError);
    expect((failures[0] as PromiseRejectedResult).reason.code).toBe('SLOT_FULL');

    const activeHolds = assertRow(
      (
        await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM slot_holds
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND slot_id = ${slot.id}
        AND status = 'active'
        AND hold_expires_at > now()
    `
      )[0],
      'active hold count',
    );
    expect(activeHolds.count).toBe(1);

    await sql`UPDATE appointment_slots SET capacity_total = 3 WHERE id = ${slot.id}`;
  });

  it('8. capacity=3 allows three concurrent holds but rejects fourth', async () => {
    await releaseMuruganHolds();
    const slot = await futureMuruganSlotAt(3);
    await sql`UPDATE appointment_slots SET capacity_total = 3 WHERE id = ${slot.id}`;
    await sql`
      UPDATE slot_holds SET status = 'released'
      WHERE clinic_id = ${SEED.CLINIC_ID} AND slot_id = ${slot.id} AND status = 'active'
    `;

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => slotHold.holdSlot({ clinicId: SEED.CLINIC_ID, slotId: slot.id })),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const activeHolds = assertRow(
      (
        await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM slot_holds
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND slot_id = ${slot.id}
        AND status = 'active'
        AND hold_expires_at > now()
    `
      )[0],
      'active hold count',
    );
    expect(activeHolds.count).toBe(3);
  });

  it('9. expired hold no longer consumes capacity', async () => {
    const slot = await firstFutureMuruganSlot();
    await sql`UPDATE appointment_slots SET capacity_total = 1 WHERE id = ${slot.id}`;
    await sql`
      UPDATE slot_holds SET status = 'released'
      WHERE clinic_id = ${SEED.CLINIC_ID} AND slot_id = ${slot.id}
    `;

    const hold = assertRow(
      (
        await sql<{ id: string }[]>`
      INSERT INTO slot_holds (clinic_id, slot_id, status, hold_expires_at)
      VALUES (
        ${SEED.CLINIC_ID},
        ${slot.id},
        'active',
        now() - interval '1 minute'
      )
      RETURNING id
    `
      )[0],
      'expired hold',
    );

    const availability = await slotService.getSlotAvailability(SEED.CLINIC_ID, slot.id);
    expect(availability?.available_count).toBe(1);

    await sql`UPDATE slot_holds SET status = 'expired' WHERE id = ${hold.id}`;
    await sql`UPDATE appointment_slots SET capacity_total = 3 WHERE id = ${slot.id}`;
  });

  it('10. SlotHoldExpiryJob marks expired holds', async () => {
    const slot = await firstFutureMuruganSlot();
    const hold = assertRow(
      (
        await sql<{ id: string }[]>`
      INSERT INTO slot_holds (clinic_id, slot_id, status, hold_expires_at)
      VALUES (
        ${SEED.CLINIC_ID},
        ${slot.id},
        'active',
        now() - interval '2 minutes'
      )
      RETURNING id
    `
      )[0],
      'expired hold for job',
    );

    const futureHold = assertRow(
      (
        await sql<{ id: string }[]>`
      INSERT INTO slot_holds (clinic_id, slot_id, status, hold_expires_at)
      VALUES (
        ${SEED.CLINIC_ID},
        ${slot.id},
        'active',
        now() + interval '5 minutes'
      )
      RETURNING id
    `
      )[0],
      'future hold for job',
    );

    const firstRun = await slotHoldExpiry.expireSlotHolds({ clinicId: SEED.CLINIC_ID });
    expect(firstRun.expired_count).toBeGreaterThanOrEqual(1);

    const expiredRow = assertRow(
      (
        await sql<{ status: string }[]>`
      SELECT status FROM slot_holds WHERE id = ${hold.id}
    `
      )[0],
      'expired hold row',
    );
    expect(expiredRow.status).toBe('expired');

    const activeRow = assertRow(
      (
        await sql<{ status: string }[]>`
      SELECT status FROM slot_holds WHERE id = ${futureHold.id}
    `
      )[0],
      'active hold row',
    );
    expect(activeRow.status).toBe('active');

    const secondRun = await slotHoldExpiry.expireSlotHolds({ clinicId: SEED.CLINIC_ID });
    expect(secondRun.expired_count).toBe(0);

    await jobExecutor.runValidatedJob(
      JOB_TYPES.EXPIRE_SLOT_HOLDS,
      JOB_QUEUE_MAP[JOB_TYPES.EXPIRE_SLOT_HOLDS],
      { clinic_id: SEED.CLINIC_ID },
    );
  });

  it('11. confirm after expired hold rechecks capacity', async () => {
    await releaseMuruganHolds();
    const slot = await futureMuruganSlotAt(4);
    await sql`UPDATE appointment_slots SET capacity_total = 1 WHERE id = ${slot.id}`;
    await sql`
      UPDATE slot_holds SET status = 'released'
      WHERE clinic_id = ${SEED.CLINIC_ID} AND slot_id = ${slot.id}
    `;

    const hold = await slotHold.holdSlot({
      clinicId: SEED.CLINIC_ID,
      slotId: slot.id,
      patientPhone: '+919999999902',
    });
    await sql`
      UPDATE slot_holds
      SET status = 'expired', hold_expires_at = now() - interval '1 minute'
      WHERE id = ${hold.id}
    `;

    const appointment = await slotHold.confirmAfterExpiredHold({
      clinicId: SEED.CLINIC_ID,
      slotId: slot.id,
      holdId: hold.id,
      patientName: 'A03 Patient',
      patientPhone: '+919999999902',
      reasonForVisit: 'Fever',
    });
    expect(appointment.status).toBe('pending_confirmation');

    await slotHold.cancelAppointment(SEED.CLINIC_ID, appointment.id);

    const hold2 = await slotHold.holdSlot({
      clinicId: SEED.CLINIC_ID,
      slotId: slot.id,
    });
    await sql`
      UPDATE slot_holds
      SET status = 'expired', hold_expires_at = now() - interval '1 minute'
      WHERE id = ${hold2.id}
    `;
    await slotHold.holdSlot({
      clinicId: SEED.CLINIC_ID,
      slotId: slot.id,
    });

    await expect(
      slotHold.confirmAfterExpiredHold({
        clinicId: SEED.CLINIC_ID,
        slotId: slot.id,
        holdId: hold2.id,
        patientName: 'A03 Patient Two',
        reasonForVisit: 'Cough',
      }),
    ).rejects.toMatchObject({ code: 'SLOT_NOT_AVAILABLE' });

    await sql`UPDATE appointment_slots SET capacity_total = 3 WHERE id = ${slot.id}`;
  });

  it('12. cancelled appointment releases capacity', async () => {
    await releaseMuruganHolds();
    const slot = await futureMuruganSlotAt(5);
    await sql`UPDATE appointment_slots SET capacity_total = 1 WHERE id = ${slot.id}`;
    await sql`
      UPDATE slot_holds SET status = 'released'
      WHERE clinic_id = ${SEED.CLINIC_ID} AND slot_id = ${slot.id}
    `;

    const hold = await slotHold.holdSlot({
      clinicId: SEED.CLINIC_ID,
      slotId: slot.id,
    });
    const appointment = await slotHold.createAppointmentFromHold({
      clinicId: SEED.CLINIC_ID,
      slotId: slot.id,
      holdId: hold.id,
      patientName: 'Cancel Me',
      reasonForVisit: 'Headache',
    });
    await sql`
      UPDATE appointment_requests SET status = 'confirmed'
      WHERE id = ${appointment.id}
    `;

    await slotHold.cancelAppointment(SEED.CLINIC_ID, appointment.id);

    const availability = await slotService.getSlotAvailability(SEED.CLINIC_ID, slot.id);
    expect(availability?.available_count).toBe(1);

    const staleHoldCount = assertRow(
      (
        await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM slot_holds
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND slot_id = ${slot.id}
        AND status = 'active'
        AND hold_expires_at > now()
    `
      )[0],
      'stale hold count',
    );
    expect(staleHoldCount.count).toBe(0);

    await sql`UPDATE appointment_slots SET capacity_total = 3 WHERE id = ${slot.id}`;
  });

  it('13. capacity increase updates future open slots', async () => {
    const slot = await firstFutureMuruganSlot();
    const originalCapacity = slot.capacity_total;

    const result = await ruleChange.applyCapacityChange(SEED.CLINIC_ID, muruganRuleId, originalCapacity + 1);
    expect(result.conflicts).toHaveLength(0);
    expect(result.updated_slots).toBeGreaterThan(0);

    const updatedSlot = assertRow(
      (
        await sql<{ capacity_total: number }[]>`
      SELECT capacity_total FROM appointment_slots WHERE id = ${slot.id}
    `
      )[0],
      'updated slot capacity',
    );
    expect(updatedSlot.capacity_total).toBe(originalCapacity + 1);

    await ruleChange.applyCapacityChange(SEED.CLINIC_ID, muruganRuleId, originalCapacity);
  });

  it('14. capacity decrease with no conflict succeeds', async () => {
    const slot = await firstFutureMuruganSlot();
    await sql`UPDATE appointment_slots SET capacity_total = 3 WHERE id = ${slot.id}`;

    const result = await ruleChange.applyCapacityChange(SEED.CLINIC_ID, muruganRuleId, 2);
    expect(result.conflicts).toHaveLength(0);

    const updatedSlot = assertRow(
      (
        await sql<{ capacity_total: number }[]>`
      SELECT capacity_total FROM appointment_slots WHERE id = ${slot.id}
    `
      )[0],
      'updated slot capacity',
    );
    expect(updatedSlot.capacity_total).toBe(2);

    await ruleChange.applyCapacityChange(SEED.CLINIC_ID, muruganRuleId, 3);
  });

  it('15. capacity decrease with conflict blocks change', async () => {
    await releaseMuruganHolds();
    const slot = await futureMuruganSlotAt(6);
    await sql`UPDATE appointment_slots SET capacity_total = 3 WHERE id = ${slot.id}`;
    await sql`
      UPDATE slot_holds SET status = 'released'
      WHERE clinic_id = ${SEED.CLINIC_ID} AND slot_id = ${slot.id}
    `;

    const holdOne = await slotHold.holdSlot({
      clinicId: SEED.CLINIC_ID,
      slotId: slot.id,
    });
    const holdTwo = await slotHold.holdSlot({
      clinicId: SEED.CLINIC_ID,
      slotId: slot.id,
    });
    await slotHold.createAppointmentFromHold({
      clinicId: SEED.CLINIC_ID,
      slotId: slot.id,
      holdId: holdOne.id,
      patientName: 'Occupant One',
      reasonForVisit: 'Fever',
    });
    await slotHold.createAppointmentFromHold({
      clinicId: SEED.CLINIC_ID,
      slotId: slot.id,
      holdId: holdTwo.id,
      patientName: 'Occupant Two',
      reasonForVisit: 'Cold',
    });

    const preview = await ruleChange.previewCapacityChange(SEED.CLINIC_ID, muruganRuleId, 1);
    expect(preview.blocked).toBe(true);
    expect(preview.conflicts.length).toBeGreaterThan(0);
    expect(typeof preview.next_safe_implement_from).toBe('string');

    await expect(ruleChange.applyCapacityChange(SEED.CLINIC_ID, muruganRuleId, 1)).rejects.toMatchObject({
      code: 'CONFLICTING_APPOINTMENTS',
    });

    const rule = assertRow(
      (
        await sql<{ capacity_per_slot: number }[]>`
      SELECT capacity_per_slot FROM doctor_service_booking_rules WHERE id = ${muruganRuleId}
    `
      )[0],
      'booking rule',
    );
    expect(rule.capacity_per_slot).toBe(3);

    const unchangedSlot = assertRow(
      (
        await sql<{ capacity_total: number }[]>`
      SELECT capacity_total FROM appointment_slots WHERE id = ${slot.id}
    `
      )[0],
      'unchanged slot',
    );
    expect(unchangedSlot.capacity_total).toBe(3);
  });

  it('16. duration increase with no conflict supersedes old slots and generates new slots', async () => {
    await releaseMuruganHolds();
    await sql`
      UPDATE appointment_requests
      SET status = 'cancelled'
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND slot_id IN (
          SELECT id FROM appointment_slots
          WHERE clinic_id = ${SEED.CLINIC_ID}
            AND doctor_id = ${SEED.DOCTOR_MURUGAN_ID}
            AND clinic_service_id = ${SEED.GENERAL_SERVICE_ID}
            AND start_time > (now() AT TIME ZONE ${TIMEZONE})::timestamp
        )
        AND status IN ('pending_confirmation', 'confirmed')
    `;

    const isolatedDate = await nextWeekday(
      addDays(formatDateInTimezone(new Date(), TIMEZONE), 20, TIMEZONE),
      TIMEZONE,
    );
    const slotStart = combineDateAndTime(isolatedDate, '20:00:00', TIMEZONE);
    const slotEnd = combineDateAndTime(isolatedDate, '20:15:00', TIMEZONE);

    const slotStartLocal = formatClinicLocalTimestamp(slotStart, TIMEZONE);
    const slotEndLocal = formatClinicLocalTimestamp(slotEnd, TIMEZONE);

    await sql`
      DELETE FROM appointment_slots
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND doctor_id = ${SEED.DOCTOR_MURUGAN_ID}
        AND clinic_service_id = ${SEED.GENERAL_SERVICE_ID}
        AND start_time = ${slotStartLocal}
    `;

    const isolatedSlot = assertRow(
      (
        await sql<{ id: string }[]>`
      INSERT INTO appointment_slots (
        clinic_id, doctor_id, clinic_service_id, start_time, end_time,
        capacity_total, status, generated_from_rule_id, config_version
      )
      VALUES (
        ${SEED.CLINIC_ID},
        ${SEED.DOCTOR_MURUGAN_ID},
        ${SEED.GENERAL_SERVICE_ID},
        ${slotStartLocal},
        ${slotEndLocal},
        3,
        'open',
        ${muruganRuleId},
        1
      )
      RETURNING id
    `
      )[0],
      'isolated slot',
    );

    const ruleBefore = assertRow(
      (
        await sql<{ slot_duration_minutes: number }[]>`
      SELECT slot_duration_minutes FROM doctor_service_booking_rules WHERE id = ${muruganRuleId}
    `
      )[0],
      'rule before duration change',
    );

    const result = await ruleChange.applyDurationChange(SEED.CLINIC_ID, muruganRuleId, 30);
    expect(result.conflicts).toHaveLength(0);
    expect(result.superseded_slots).toBeGreaterThan(0);

    const regenerated = await sql<{ minutes: number }[]>`
      SELECT EXTRACT(EPOCH FROM (end_time - start_time)) / 60 AS minutes
      FROM appointment_slots
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND doctor_id = ${SEED.DOCTOR_MURUGAN_ID}
        AND clinic_service_id = ${SEED.GENERAL_SERVICE_ID}
        AND status = 'open'
        AND generated_from_rule_id = ${muruganRuleId}
        AND start_time > (now() AT TIME ZONE ${TIMEZONE})::timestamp
      ORDER BY start_time
      LIMIT 1
    `;
    expect(regenerated.length).toBeGreaterThan(0);
    expect(Number(regenerated[0]?.minutes)).toBe(30);

    const oldSlot = assertRow(
      (
        await sql<{ status: string }[]>`
      SELECT status FROM appointment_slots WHERE id = ${isolatedSlot.id}
    `
      )[0],
      'old slot status',
    );
    expect(oldSlot.status).toBe('superseded');

    const [updatedRule] = await sql<{ slot_duration_minutes: number }[]>`
      SELECT slot_duration_minutes FROM doctor_service_booking_rules WHERE id = ${muruganRuleId}
    `;
    expect(updatedRule?.slot_duration_minutes).toBe(30);

    await ruleChange.applyDurationChange(SEED.CLINIC_ID, muruganRuleId, ruleBefore.slot_duration_minutes);
  });

  it('17. duration change with conflict blocks change', async () => {
    await releaseMuruganHolds();
    const slot = await futureMuruganSlotAt(7);
    await sql`
      UPDATE slot_holds SET status = 'released'
      WHERE clinic_id = ${SEED.CLINIC_ID} AND slot_id = ${slot.id}
    `;

    const hold = await slotHold.holdSlot({
      clinicId: SEED.CLINIC_ID,
      slotId: slot.id,
    });
    await slotHold.createAppointmentFromHold({
      clinicId: SEED.CLINIC_ID,
      slotId: slot.id,
      holdId: hold.id,
      patientName: 'Duration Conflict',
      reasonForVisit: 'Back pain',
    });

    const ruleBefore = assertRow(
      (
        await sql<{ slot_duration_minutes: number }[]>`
      SELECT slot_duration_minutes FROM doctor_service_booking_rules WHERE id = ${muruganRuleId}
    `
      )[0],
      'rule before blocked duration change',
    );

    await expect(ruleChange.applyDurationChange(SEED.CLINIC_ID, muruganRuleId, 30)).rejects.toMatchObject({
      code: 'CONFLICTING_APPOINTMENTS',
    });

    const unchangedSlot = assertRow(
      (
        await sql<{ status: string }[]>`
      SELECT status FROM appointment_slots WHERE id = ${slot.id}
    `
      )[0],
      'unchanged slot status',
    );
    expect(unchangedSlot.status).toBe('open');

    const appointment = assertRow(
      (
        await sql<{ status: string }[]>`
      SELECT status FROM appointment_requests
      WHERE clinic_id = ${SEED.CLINIC_ID} AND slot_id = ${slot.id}
      ORDER BY created_at DESC
      LIMIT 1
    `
      )[0],
      'appointment status',
    );
    expect(appointment.status).toBe('pending_confirmation');

    await sql`
      UPDATE doctor_service_booking_rules
      SET slot_duration_minutes = ${ruleBefore.slot_duration_minutes}
      WHERE id = ${muruganRuleId}
    `;
  });

  it('17b. duration change deferred with implement_from supersedes only later slots', async () => {
    await releaseMuruganHolds();

    const nearSlot = await futureMuruganSlotAt(9);
    const farSlot = await futureMuruganSlotAt(14);

    await sql`
      UPDATE appointment_slots
      SET capacity_total = 3
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND id IN (${nearSlot.id}, ${farSlot.id})
    `;

    await sql`
      UPDATE slot_holds
      SET status = 'released'
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND slot_id IN (${nearSlot.id}, ${farSlot.id})
    `;

    const nearHold = await slotHold.holdSlot({
      clinicId: SEED.CLINIC_ID,
      slotId: nearSlot.id,
    });
    await slotHold.createAppointmentFromHold({
      clinicId: SEED.CLINIC_ID,
      slotId: nearSlot.id,
      holdId: nearHold.id,
      patientName: 'Deferred Duration Patient',
      reasonForVisit: 'Deferred duration check',
    });

    const preview = await ruleChange.previewDurationChange(SEED.CLINIC_ID, muruganRuleId, 30);
    expect(preview.blocked).toBe(true);
    expect(typeof preview.next_safe_implement_from).toBe('string');

    const implementFrom = preview.next_safe_implement_from as string;

    const applied = await ruleChange.applyDurationChangeFrom(
      SEED.CLINIC_ID,
      muruganRuleId,
      30,
      implementFrom,
    );
    expect(applied.conflicts).toHaveLength(0);

    const [nearStatus] = await sql<{ status: string }[]>`
      SELECT status
      FROM appointment_slots
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND id = ${nearSlot.id}
    `;
    expect(nearStatus?.status).toBe('open');

    const [farStatus] = await sql<{ status: string }[]>`
      SELECT status
      FROM appointment_slots
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND id = ${farSlot.id}
    `;
    expect(farStatus?.status).toBe('superseded');
  });

  it('18. no auto-cancel occurs on schedule or rule changes', async () => {
    await releaseMuruganHolds();
    const slot = await futureMuruganSlotAt(8);
    await sql`UPDATE appointment_slots SET capacity_total = 3 WHERE id = ${slot.id}`;

    const holdOne = await slotHold.holdSlot({
      clinicId: SEED.CLINIC_ID,
      slotId: slot.id,
    });
    const holdTwo = await slotHold.holdSlot({
      clinicId: SEED.CLINIC_ID,
      slotId: slot.id,
    });
    const appointment = await slotHold.createAppointmentFromHold({
      clinicId: SEED.CLINIC_ID,
      slotId: slot.id,
      holdId: holdOne.id,
      patientName: 'Protected Appointment',
      reasonForVisit: 'Checkup',
    });
    await slotHold.createAppointmentFromHold({
      clinicId: SEED.CLINIC_ID,
      slotId: slot.id,
      holdId: holdTwo.id,
      patientName: 'Protected Appointment Two',
      reasonForVisit: 'Follow up',
    });

    await expect(ruleChange.applyCapacityChange(SEED.CLINIC_ID, muruganRuleId, 1)).rejects.toMatchObject({
      code: 'CONFLICTING_APPOINTMENTS',
    });

    const stillActive = assertRow(
      (
        await sql<{ status: string }[]>`
      SELECT status FROM appointment_requests WHERE id = ${appointment.id}
    `
      )[0],
      'protected appointment',
    );
    expect(stillActive.status).toBe('pending_confirmation');
  });

  it('19. inactive doctor-service mapping skips new slot generation', async () => {
    await sql`
      UPDATE doctor_services
      SET active = false
      WHERE id = ${SEED.MURUGAN_DOCTOR_SERVICE_ID}
    `;

    const summaries = await generateMuruganSlots();
    expect(summaries).toHaveLength(0);

    await sql`
      UPDATE doctor_services
      SET active = true
      WHERE id = ${SEED.MURUGAN_DOCTOR_SERVICE_ID}
    `;
  });

  it('20. jobs:run handlers are registered for slot generation and hold expiry', async () => {
    await jobExecutor.runValidatedJob(
      JOB_TYPES.GENERATE_SLOTS,
      JOB_QUEUE_MAP[JOB_TYPES.GENERATE_SLOTS],
      {
        clinic_id: SEED.CLINIC_ID,
        doctor_id: SEED.DOCTOR_MURUGAN_ID,
        clinic_service_id: SEED.GENERAL_SERVICE_ID,
      },
    );

    await jobExecutor.runValidatedJob(
      JOB_TYPES.EXPIRE_SLOT_HOLDS,
      JOB_QUEUE_MAP[JOB_TYPES.EXPIRE_SLOT_HOLDS],
      { clinic_id: SEED.CLINIC_ID },
    );
  });
});
