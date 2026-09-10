import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import {
  addDays,
  combineDateAndTime,
  formatClinicLocalTimestamp,
  formatDateInTimezone,
} from '@vaidya/db';
import { apiErrorBodySchema, apiSuccessBodySchema } from '@vaidya/shared';

import { prepareTestDatabase } from './db-setup';
import { devAuthHeaders, SEED } from './test-constants';
import { createTestApp } from './test-app';

const TIMEZONE = 'Asia/Kolkata';

describe('C07 production gap APIs', () => {
  let app: NestFastifyApplication;
  let sql: postgres.Sql;
  let muruganRuleId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5433/vaidya_test';
    await prepareTestDatabase();
    app = await createTestApp();
    sql = postgres(process.env.DATABASE_URL, { max: 1 });

    const [rule] = await sql<{ id: string }[]>`
      SELECT id FROM doctor_service_booking_rules
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND doctor_id = ${SEED.DOCTOR_MURUGAN_ID}
        AND clinic_service_id = ${SEED.GENERAL_SERVICE_ID}
        AND active = true
      LIMIT 1
    `;
    muruganRuleId = rule!.id;
  });

  afterAll(async () => {
    await app.close();
    await sql.end({ timeout: 5 });
  });

  const adminHeaders = devAuthHeaders({
    userId: SEED.CLINIC_ADMIN_ID,
    clinicId: SEED.CLINIC_ID,
    role: 'clinic_admin',
  });

  const platformHeaders = devAuthHeaders({
    userId: SEED.PLATFORM_ADMIN_ID,
    role: 'platform_admin',
    clinicId: SEED.CLINIC_ID,
  });

  it('1. clinic admin can read subscription, usage, and languages', async () => {
    const subscription = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/subscription`,
      headers: adminHeaders,
    });
    expect(subscription.statusCode).toBe(200);
    const subBody = apiSuccessBodySchema.parse(subscription.json()).data as {
      subscription: { plan_key: string; status: string };
    };
    expect(subBody.subscription.plan_key).toBeTruthy();

    const usage = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/usage/current-month`,
      headers: adminHeaders,
    });
    expect(usage.statusCode).toBe(200);

    const languages = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/languages`,
      headers: adminHeaders,
    });
    expect(languages.statusCode).toBe(200);
    const langBody = apiSuccessBodySchema.parse(languages.json()).data as {
      languages: { default_language_code: string; languages: Array<{ language_code: string }> };
    };
    expect(langBody.languages.default_language_code).toBe('ta_tanglish');

    const supported = await app.inject({
      method: 'GET',
      url: '/v1/languages',
      headers: adminHeaders,
    });
    expect(supported.statusCode).toBe(200);
  });

  it('2. clinic admin can replace languages and rejects unsupported codes', async () => {
    const ok = await app.inject({
      method: 'PUT',
      url: `/v1/clinics/${SEED.CLINIC_ID}/languages`,
      headers: adminHeaders,
      payload: {
        default_language_code: 'ta_tanglish',
        languages: [
          { language_code: 'ta_tanglish', enabled: true, is_default: true },
          { language_code: 'english', enabled: true, is_default: false },
        ],
      },
    });
    expect(ok.statusCode).toBe(200);

    const bad = await app.inject({
      method: 'PUT',
      url: `/v1/clinics/${SEED.CLINIC_ID}/languages`,
      headers: adminHeaders,
      payload: {
        default_language_code: 'klingon',
        languages: [{ language_code: 'klingon', enabled: true, is_default: true }],
      },
    });
    expect(bad.statusCode).toBe(400);
    const err = apiErrorBodySchema.parse(bad.json());
    expect(err.error.code).toBe('VALIDATION_ERROR');
  });

  it('3. booking rule preview reports capacity conflicts', async () => {
    const preview = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/booking-rules/${muruganRuleId}/preview`,
      headers: adminHeaders,
      payload: { capacity_per_slot: 1 },
    });
    expect(preview.statusCode).toBe(201);
    const body = apiSuccessBodySchema.parse(preview.json()).data as {
      preview: {
        blocked: boolean;
        conflicts: unknown[];
        next_safe_implement_from?: string;
      };
    };
    expect(body.preview).toBeDefined();
    expect(Array.isArray(body.preview.conflicts)).toBe(true);
    if (body.preview.blocked) {
      expect(typeof body.preview.next_safe_implement_from).toBe('string');
    }
  });

  it('3b. booking rule patch applies capacity and duration together', async () => {
    const [ruleBefore] = await sql<
      {
        slot_duration_minutes: number;
        capacity_per_slot: number;
      }[]
    >`
      SELECT slot_duration_minutes, capacity_per_slot
      FROM doctor_service_booking_rules
      WHERE id = ${muruganRuleId}
      LIMIT 1
    `;

    expect(ruleBefore).toBeTruthy();

    const originalDuration = ruleBefore?.slot_duration_minutes ?? 15;
    const originalCapacity = ruleBefore?.capacity_per_slot ?? 3;

    await sql`
      UPDATE slot_holds
      SET status = 'released'
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND status = 'active'
    `;

    await sql`
      UPDATE appointment_requests
      SET status = 'cancelled'
      WHERE clinic_id = ${SEED.CLINIC_ID}
        AND doctor_id = ${SEED.DOCTOR_MURUGAN_ID}
        AND clinic_service_id = ${SEED.GENERAL_SERVICE_ID}
        AND status IN ('pending_confirmation', 'confirmed')
        AND appointment_start > (now() AT TIME ZONE ${TIMEZONE})::timestamp
    `;

    const nextDuration = originalDuration + 5;
    const nextCapacity = originalCapacity + 1;

    try {
      const patch = await app.inject({
        method: 'PATCH',
        url: `/v1/clinics/${SEED.CLINIC_ID}/booking-rules/${muruganRuleId}`,
        headers: adminHeaders,
        payload: {
          capacity_per_slot: nextCapacity,
          slot_duration_minutes: nextDuration,
        },
      });

      expect(patch.statusCode).toBe(200);

      const patchBody = apiSuccessBodySchema.parse(patch.json()).data as {
        booking_rule: {
          slot_duration_minutes: number;
          capacity_per_slot: number;
        };
      };

      expect(patchBody.booking_rule.slot_duration_minutes).toBe(nextDuration);
      expect(patchBody.booking_rule.capacity_per_slot).toBe(nextCapacity);

      const [futureOpenSlot] = await sql<
        {
          duration_minutes: number;
          capacity_total: number;
        }[]
      >`
        SELECT
          (EXTRACT(EPOCH FROM (end_time - start_time)) / 60)::int AS duration_minutes,
          capacity_total
        FROM appointment_slots
        WHERE clinic_id = ${SEED.CLINIC_ID}
          AND generated_from_rule_id = ${muruganRuleId}
          AND status = 'open'
          AND start_time > (now() AT TIME ZONE ${TIMEZONE})::timestamp
        ORDER BY start_time
        LIMIT 1
      `;

      expect(futureOpenSlot).toBeTruthy();
      expect(futureOpenSlot?.duration_minutes).toBe(nextDuration);
      expect(futureOpenSlot?.capacity_total).toBe(nextCapacity);
    } finally {
      await app.inject({
        method: 'PATCH',
        url: `/v1/clinics/${SEED.CLINIC_ID}/booking-rules/${muruganRuleId}`,
        headers: adminHeaders,
        payload: {
          capacity_per_slot: originalCapacity,
          slot_duration_minutes: originalDuration,
        },
      });
    }
  });

  it('3c. creating doctor-service mapping auto-creates booking rule', async () => {
    const createDoctor = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/doctors`,
      headers: adminHeaders,
      payload: {
        name: 'Dr. Booking Rules Auto',
        qualification: 'MBBS',
      },
    });

    expect(createDoctor.statusCode).toBe(201);

    const createdDoctor = apiSuccessBodySchema.parse(createDoctor.json()).data as {
      doctor: { id: string };
    };

    const createMapping = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/doctor-services`,
      headers: adminHeaders,
      payload: {
        doctor_id: createdDoctor.doctor.id,
        clinic_service_id: SEED.GENERAL_SERVICE_ID,
        consultation_fee_amount: 650,
        active: true,
      },
    });

    expect(createMapping.statusCode).toBe(201);

    const rulesResponse = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/booking-rules`,
      headers: adminHeaders,
    });

    expect(rulesResponse.statusCode).toBe(200);

    const rulesBody = apiSuccessBodySchema.parse(rulesResponse.json()).data as {
      booking_rules: Array<{
        doctor_id: string;
        clinic_service_id: string;
        slot_duration_minutes: number;
        capacity_per_slot: number;
        active: boolean;
      }>;
    };

    const newDoctorRule = rulesBody.booking_rules.find(
      (rule) =>
        rule.doctor_id === createdDoctor.doctor.id &&
        rule.clinic_service_id === SEED.GENERAL_SERVICE_ID &&
        rule.active,
    );

    expect(newDoctorRule).toBeTruthy();
    expect((newDoctorRule?.slot_duration_minutes ?? 0) > 0).toBe(true);
    expect((newDoctorRule?.capacity_per_slot ?? 0) > 0).toBe(true);
  });

  it('3d. booking rules list excludes rules for inactive doctor-service mappings', async () => {
    const createMapping = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/doctor-services`,
      headers: adminHeaders,
      payload: {
        doctor_id: SEED.DOCTOR_MURUGAN_ID,
        clinic_service_id: SEED.ORTHO_SERVICE_ID,
        consultation_fee_amount: 800,
        active: true,
      },
    });

    expect(createMapping.statusCode).toBe(201);
    const createdMappingBody = apiSuccessBodySchema.parse(createMapping.json()).data as {
      doctor_service: { id: string };
    };
    const mappingId = createdMappingBody.doctor_service.id;

    const listAfterCreate = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/booking-rules`,
      headers: adminHeaders,
    });

    expect(listAfterCreate.statusCode).toBe(200);
    const listAfterCreateBody = apiSuccessBodySchema.parse(listAfterCreate.json()).data as {
      booking_rules: Array<{
        id: string;
        doctor_id: string;
        clinic_service_id: string;
      }>;
    };

    const createdRule = listAfterCreateBody.booking_rules.find(
      (rule) =>
        rule.doctor_id === SEED.DOCTOR_MURUGAN_ID &&
        rule.clinic_service_id === SEED.ORTHO_SERVICE_ID,
    );

    expect(createdRule).toBeTruthy();

    const deactivateMapping = await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${SEED.CLINIC_ID}/doctor-services/${mappingId}`,
      headers: adminHeaders,
      payload: { active: false },
    });
    expect(deactivateMapping.statusCode).toBe(200);

    const listAfterDeactivate = await app.inject({
      method: 'GET',
      url: `/v1/clinics/${SEED.CLINIC_ID}/booking-rules`,
      headers: adminHeaders,
    });

    expect(listAfterDeactivate.statusCode).toBe(200);
    const listAfterDeactivateBody = apiSuccessBodySchema.parse(listAfterDeactivate.json()).data as {
      booking_rules: Array<{ id: string }>;
    };

    expect(
      listAfterDeactivateBody.booking_rules.some((rule) => rule.id === createdRule?.id),
    ).toBe(false);
  });

  it('3e. doctor-specific holiday blocks only selected doctor slots', async () => {
    const holidayDate = addDays(formatDateInTimezone(new Date(), TIMEZONE), 40, TIMEZONE);

    const muruganStart = formatClinicLocalTimestamp(
      combineDateAndTime(holidayDate, '02:00:00', TIMEZONE),
      TIMEZONE,
    );
    const muruganEnd = formatClinicLocalTimestamp(
      combineDateAndTime(holidayDate, '02:15:00', TIMEZONE),
      TIMEZONE,
    );
    const priyaStart = formatClinicLocalTimestamp(
      combineDateAndTime(holidayDate, '02:30:00', TIMEZONE),
      TIMEZONE,
    );
    const priyaEnd = formatClinicLocalTimestamp(
      combineDateAndTime(holidayDate, '02:45:00', TIMEZONE),
      TIMEZONE,
    );

    const [muruganSlot] = await sql<{ id: string }[]>`
      INSERT INTO appointment_slots (
        clinic_id,
        doctor_id,
        clinic_service_id,
        start_time,
        end_time,
        capacity_total,
        status,
        config_version
      )
      VALUES (
        ${SEED.CLINIC_ID},
        ${SEED.DOCTOR_MURUGAN_ID},
        ${SEED.GENERAL_SERVICE_ID},
        ${muruganStart}::timestamp,
        ${muruganEnd}::timestamp,
        3,
        'open',
        1
      )
      RETURNING id
    `;

    const [priyaSlot] = await sql<{ id: string }[]>`
      INSERT INTO appointment_slots (
        clinic_id,
        doctor_id,
        clinic_service_id,
        start_time,
        end_time,
        capacity_total,
        status,
        config_version
      )
      VALUES (
        ${SEED.CLINIC_ID},
        ${SEED.DOCTOR_PRIYA_ID},
        ${SEED.GENERAL_SERVICE_ID},
        ${priyaStart}::timestamp,
        ${priyaEnd}::timestamp,
        3,
        'open',
        1
      )
      RETURNING id
    `;

    let holidayId: string | null = null;

    try {
      const beforeMurugan = await app.inject({
        method: 'GET',
        url: `/v1/clinics/${SEED.CLINIC_ID}/appointments/available-slots?doctor_id=${SEED.DOCTOR_MURUGAN_ID}&clinic_service_id=${SEED.GENERAL_SERVICE_ID}&date=${holidayDate}`,
        headers: adminHeaders,
      });
      expect(beforeMurugan.statusCode).toBe(200);
      const beforeMuruganSlots = apiSuccessBodySchema.parse(beforeMurugan.json()).data as {
        slots: Array<{ slot_id: string }>;
      };
      expect(beforeMuruganSlots.slots.some((slot) => slot.slot_id === muruganSlot?.id)).toBe(true);

      const beforePriya = await app.inject({
        method: 'GET',
        url: `/v1/clinics/${SEED.CLINIC_ID}/appointments/available-slots?doctor_id=${SEED.DOCTOR_PRIYA_ID}&clinic_service_id=${SEED.GENERAL_SERVICE_ID}&date=${holidayDate}`,
        headers: adminHeaders,
      });
      expect(beforePriya.statusCode).toBe(200);
      const beforePriyaSlots = apiSuccessBodySchema.parse(beforePriya.json()).data as {
        slots: Array<{ slot_id: string }>;
      };
      expect(beforePriyaSlots.slots.some((slot) => slot.slot_id === priyaSlot?.id)).toBe(true);

      const createHoliday = await app.inject({
        method: 'POST',
        url: `/v1/clinics/${SEED.CLINIC_ID}/holidays`,
        headers: adminHeaders,
        payload: {
          holiday_date: holidayDate,
          is_full_day: true,
          reason: 'Doctor leave (C07)',
          doctor_ids: [SEED.DOCTOR_MURUGAN_ID],
        },
      });
      expect(createHoliday.statusCode).toBe(201);
      const holidayBody = apiSuccessBodySchema.parse(createHoliday.json()).data as {
        holiday: {
          id: string;
          applies_to_clinic: boolean;
          doctor_ids: string[];
        };
      };

      holidayId = holidayBody.holiday.id;
      expect(holidayBody.holiday.applies_to_clinic).toBe(false);
      expect(holidayBody.holiday.doctor_ids).toContain(SEED.DOCTOR_MURUGAN_ID);

      const listHolidays = await app.inject({
        method: 'GET',
        url: `/v1/clinics/${SEED.CLINIC_ID}/holidays`,
        headers: adminHeaders,
      });
      expect(listHolidays.statusCode).toBe(200);
      const listBody = apiSuccessBodySchema.parse(listHolidays.json()).data as {
        holidays: Array<{ id: string; applies_to_clinic: boolean; doctor_ids: string[] }>;
      };
      const listed = listBody.holidays.find((holiday) => holiday.id === holidayId);
      expect(listed).toBeTruthy();
      expect(listed?.applies_to_clinic).toBe(false);
      expect(listed?.doctor_ids ?? []).toContain(SEED.DOCTOR_MURUGAN_ID);

      const afterMurugan = await app.inject({
        method: 'GET',
        url: `/v1/clinics/${SEED.CLINIC_ID}/appointments/available-slots?doctor_id=${SEED.DOCTOR_MURUGAN_ID}&clinic_service_id=${SEED.GENERAL_SERVICE_ID}&date=${holidayDate}`,
        headers: adminHeaders,
      });
      expect(afterMurugan.statusCode).toBe(200);
      const afterMuruganSlots = apiSuccessBodySchema.parse(afterMurugan.json()).data as {
        slots: Array<{ slot_id: string }>;
      };
      expect(afterMuruganSlots.slots.some((slot) => slot.slot_id === muruganSlot?.id)).toBe(false);

      const afterPriya = await app.inject({
        method: 'GET',
        url: `/v1/clinics/${SEED.CLINIC_ID}/appointments/available-slots?doctor_id=${SEED.DOCTOR_PRIYA_ID}&clinic_service_id=${SEED.GENERAL_SERVICE_ID}&date=${holidayDate}`,
        headers: adminHeaders,
      });
      expect(afterPriya.statusCode).toBe(200);
      const afterPriyaSlots = apiSuccessBodySchema.parse(afterPriya.json()).data as {
        slots: Array<{ slot_id: string }>;
      };
      expect(afterPriyaSlots.slots.some((slot) => slot.slot_id === priyaSlot?.id)).toBe(true);
    } finally {
      if (holidayId) {
        await sql`
          DELETE FROM clinic_holidays
          WHERE clinic_id = ${SEED.CLINIC_ID}
            AND id = ${holidayId}::uuid
        `;
      }

      await sql`
        DELETE FROM appointment_requests
        WHERE clinic_id = ${SEED.CLINIC_ID}
          AND slot_id IN (${muruganSlot?.id ?? '00000000-0000-0000-0000-000000000000'}::uuid, ${priyaSlot?.id ?? '00000000-0000-0000-0000-000000000000'}::uuid)
      `;

      await sql`
        DELETE FROM appointment_slots
        WHERE clinic_id = ${SEED.CLINIC_ID}
          AND id IN (${muruganSlot?.id ?? '00000000-0000-0000-0000-000000000000'}::uuid, ${priyaSlot?.id ?? '00000000-0000-0000-0000-000000000000'}::uuid)
      `;
    }
  });

  it('4. clinic admin can create manual appointment and mark visited', async () => {
    const bookDate = addDays(formatDateInTimezone(new Date(), TIMEZONE), 3, TIMEZONE);
    const start = combineDateAndTime(bookDate, '18:00:00', TIMEZONE);
    const end = combineDateAndTime(bookDate, '18:15:00', TIMEZONE);

    const create = await app.inject({
      method: 'POST',
      url: `/v1/clinics/${SEED.CLINIC_ID}/appointments`,
      headers: adminHeaders,
      payload: {
        patient_name: 'Manual Patient',
        patient_phone: '+919876543210',
        patient_age: 33,
        doctor_id: SEED.DOCTOR_MURUGAN_ID,
        clinic_service_id: SEED.GENERAL_SERVICE_ID,
        reason_for_visit: 'Routine checkup',
        appointment_start: start.toISOString(),
        appointment_end: end.toISOString(),
        override_reason: 'Admin walk-in outside slot capacity',
        status: 'confirmed',
      },
    });
    expect(create.statusCode).toBe(201);
    const created = apiSuccessBodySchema.parse(create.json()).data as {
      appointment: { id: string; status: string };
    };
    expect(created.appointment.status).toBe('confirmed');

    const visited = await app.inject({
      method: 'PATCH',
      url: `/v1/clinics/${SEED.CLINIC_ID}/appointments/${created.appointment.id}/mark-visited`,
      headers: adminHeaders,
      payload: { visit_reason: 'Completed routine checkup' },
    });
    expect(visited.statusCode).toBe(200);
    const visitBody = apiSuccessBodySchema.parse(visited.json()).data as {
      appointment: { status: string };
      patient_visit: { id: string };
    };
    expect(visitBody.appointment.status).toBe('visited');
    expect(visitBody.patient_visit.id).toBeTruthy();
  });

  it('5. platform admin can retry and cancel notifications', async () => {
    const [event] = await sql<{ id: string }[]>`
      INSERT INTO notification_events (
        clinic_id, event_type, channel, status, recipient_type, recipient_phone, attempt_count, max_attempts
      )
      VALUES (
        ${SEED.CLINIC_ID},
        'appointment.confirmed',
        'whatsapp',
        'failed',
        'patient',
        '+919999999999',
        2,
        5
      )
      RETURNING id
    `;

    const retry = await app.inject({
      method: 'POST',
      url: `/internal/platform/notifications/${event!.id}/retry`,
      headers: platformHeaders,
    });
    expect(retry.statusCode).toBe(201);

    const [pending] = await sql<{ id: string }[]>`
      INSERT INTO notification_events (
        clinic_id, event_type, channel, status, recipient_type, recipient_phone, attempt_count, max_attempts
      )
      VALUES (
        ${SEED.CLINIC_ID},
        'appointment.pending_confirmation',
        'whatsapp',
        'pending',
        'patient',
        '+919999999998',
        0,
        5
      )
      RETURNING id
    `;

    const cancel = await app.inject({
      method: 'POST',
      url: `/internal/platform/notifications/${pending!.id}/cancel`,
      headers: platformHeaders,
    });
    expect(cancel.statusCode).toBe(201);
    const cancelBody = apiSuccessBodySchema.parse(cancel.json()).data as {
      notification: { status: string };
    };
    expect(cancelBody.notification.status).toBe('cancelled');
  });

  it('6. platform admin can list plans and change clinic subscription', async () => {
    const plans = await app.inject({
      method: 'GET',
      url: '/internal/platform/subscription-plans',
      headers: platformHeaders,
    });
    expect(plans.statusCode).toBe(200);
    const planBody = apiSuccessBodySchema.parse(plans.json()).data as {
      plans: Array<{ plan_key: string }>;
    };
    expect(planBody.plans.length).toBeGreaterThan(0);

    const change = await app.inject({
      method: 'POST',
      url: `/internal/platform/clinics/${SEED.CLINIC_ID}/subscription/change`,
      headers: platformHeaders,
      payload: {
        plan_key: planBody.plans[0]!.plan_key,
        status: 'manual_free',
        notes: 'C07 test override',
      },
    });
    expect(change.statusCode).toBe(201);
  });
});
