import { and, eq, gt, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';

import type { Database } from '../client';
import {
  appointmentRequests,
  appointmentSlots,
  blockedDates,
  clinicHolidays,
  clinicHours,
  clinicServices,
  clinics,
  doctorBlockedSlots,
  doctorLeaves,
  doctorServiceBookingRules,
  doctorSchedules,
  doctorServices,
  doctorWorkingHours,
  doctors,
  generatedSlotBatches,
  hospitals,
  slotGenerationLogs,
  slotHolds,
} from '../schema';
import { ACTIVE_APPOINTMENT_STATUSES, ACTIVE_HOLD_STATUS } from '../services/slot-capacity';

function clinicLocalNow(clinicId: string) {
  return sql`(
    SELECT (now() AT TIME ZONE c.timezone)::timestamp
    FROM clinics c
    WHERE c.id = ${clinicId}
  )`;
}

export class SlotsRepository {
  constructor(private readonly db: Database) {}

  listActiveGenerationTargets(clinicId?: string) {
    const conditions = [
      eq(clinics.active, true),
      eq(doctorServices.active, true),
      eq(doctors.active, true),
      eq(clinicServices.active, true),
      eq(doctorServiceBookingRules.active, true),
    ];
    if (clinicId) {
      conditions.push(eq(clinics.id, clinicId));
    }

    return this.db
      .select({
        clinicId: clinics.id,
        clinicTimezone: clinics.timezone,
        doctorId: doctors.id,
        clinicServiceId: clinicServices.id,
        doctorServiceId: doctorServices.id,
        rule: doctorServiceBookingRules,
      })
      .from(doctorServiceBookingRules)
      .innerJoin(clinics, eq(clinics.id, doctorServiceBookingRules.clinicId))
      .innerJoin(doctors, and(eq(doctors.clinicId, doctorServiceBookingRules.clinicId), eq(doctors.id, doctorServiceBookingRules.doctorId)))
      .innerJoin(clinicServices, and(eq(clinicServices.clinicId, doctorServiceBookingRules.clinicId), eq(clinicServices.id, doctorServiceBookingRules.clinicServiceId)))
      .innerJoin(
        doctorServices,
        and(
          eq(doctorServices.clinicId, doctorServiceBookingRules.clinicId),
          eq(doctorServices.doctorId, doctorServiceBookingRules.doctorId),
          eq(doctorServices.clinicServiceId, doctorServiceBookingRules.clinicServiceId),
        ),
      )
      .where(and(...conditions));
  }

  findClinicTimezone(clinicId: string) {
    return this.db.select({ timezone: clinics.timezone }).from(clinics).where(eq(clinics.id, clinicId)).limit(1);
  }

  listDoctorSchedules(clinicId: string, doctorId: string, doctorServiceId: string) {
    return this.db
      .select()
      .from(doctorSchedules)
      .where(
        and(
          eq(doctorSchedules.clinicId, clinicId),
          eq(doctorSchedules.doctorId, doctorId),
          or(
            eq(doctorSchedules.doctorServiceId, doctorServiceId),
            isNull(doctorSchedules.doctorServiceId),
          ),
          eq(doctorSchedules.active, true),
        ),
      );
  }

  listClinicHours(clinicId: string) {
    return this.db
      .select()
      .from(clinicHours)
      .where(and(eq(clinicHours.clinicId, clinicId), eq(clinicHours.active, true)));
  }

  listClinicHolidays(clinicId: string, fromDate: string, toDate: string, doctorId?: string) {
    const baseFilters = and(
      eq(clinicHolidays.clinicId, clinicId),
      eq(clinicHolidays.active, true),
      gteDate(clinicHolidays.holidayDate, fromDate),
      lteDate(clinicHolidays.holidayDate, toDate),
    );

    if (!doctorId) {
      return this.db.select().from(clinicHolidays).where(baseFilters);
    }

    return this.db
      .select()
      .from(clinicHolidays)
      .where(
        and(
          baseFilters,
          doctorHolidayScopeMatchesClause(clinicHolidays.clinicId, clinicHolidays.id, doctorId),
        ),
      );
  }

  isDoctorHolidayForWindow(
    clinicId: string,
    doctorId: string,
    startTime: string,
    endTime: string,
    db: Database = this.db,
  ) {
    return db
      .select({ id: clinicHolidays.id })
      .from(clinicHolidays)
      .where(
        and(
          eq(clinicHolidays.clinicId, clinicId),
          sql`${clinicHolidays.holidayDate} = date(${startTime}::timestamp)`,
          eq(clinicHolidays.active, true),
          clinicHolidayOverlapsWindowClause(startTime, endTime, 'clinic_holidays'),
          doctorHolidayScopeMatchesClause(clinicHolidays.clinicId, clinicHolidays.id, doctorId),
        ),
      )
      .limit(1);
  }

  listDoctorBlockedSlots(clinicId: string, doctorId: string, from: Date, to: Date) {
    return this.db
      .select()
      .from(doctorBlockedSlots)
      .where(
        and(
          eq(doctorBlockedSlots.clinicId, clinicId),
          eq(doctorBlockedSlots.doctorId, doctorId),
          eq(doctorBlockedSlots.active, true),
          lte(doctorBlockedSlots.startTime, to),
          gt(doctorBlockedSlots.endTime, from),
        ),
      );
  }

  findOpenSlot(clinicId: string, slotId: string) {
    return this.db
      .select()
      .from(appointmentSlots)
      .where(and(eq(appointmentSlots.clinicId, clinicId), eq(appointmentSlots.id, slotId)))
      .limit(1);
  }

  findSlotWindow(
    clinicId: string,
    doctorId: string,
    clinicServiceId: string,
    startTime: string,
    endTime: string,
  ) {
    return this.db
      .select()
      .from(appointmentSlots)
      .where(
        and(
          eq(appointmentSlots.clinicId, clinicId),
          eq(appointmentSlots.doctorId, doctorId),
          eq(appointmentSlots.clinicServiceId, clinicServiceId),
          eq(appointmentSlots.startTime, startTime),
          eq(appointmentSlots.endTime, endTime),
          ne(appointmentSlots.status, 'superseded'),
          sql`NOT EXISTS (
            SELECT 1
            FROM clinic_holidays h
            WHERE h.clinic_id = ${clinicId}
              AND h.active = true
              AND h.holiday_date = date(${appointmentSlots.startTime})
              AND ${clinicHolidayOverlapsWindowClause(appointmentSlots.startTime, appointmentSlots.endTime, 'h')}
              AND (
                NOT EXISTS (
                  SELECT 1
                  FROM clinic_holiday_doctors chd
                  WHERE chd.clinic_id = h.clinic_id
                    AND chd.holiday_id = h.id
                )
                OR EXISTS (
                  SELECT 1
                  FROM clinic_holiday_doctors chd
                  WHERE chd.clinic_id = h.clinic_id
                    AND chd.holiday_id = h.id
                    AND chd.doctor_id = ${doctorId}
                )
              )
          )`,
        ),
      )
      .limit(1);
  }

  insertSlot(values: typeof appointmentSlots.$inferInsert) {
    return this.db.insert(appointmentSlots).values(values).returning();
  }

  insertBatch(values: typeof generatedSlotBatches.$inferInsert) {
    return this.db.insert(generatedSlotBatches).values(values).returning();
  }

  completeBatch(batchId: string, clinicId: string, summary: Record<string, unknown>) {
    return this.db
      .update(generatedSlotBatches)
      .set({
        status: 'completed',
        completedAt: new Date(),
        summaryJson: summary,
      })
      .where(and(eq(generatedSlotBatches.id, batchId), eq(generatedSlotBatches.clinicId, clinicId)))
      .returning();
  }

  countActiveAppointments(clinicId: string, slotId: string, db: Database = this.db) {
    return db
      .select({ count: sql<number>`count(*)::int` })
      .from(appointmentRequests)
      .where(
        and(
          eq(appointmentRequests.clinicId, clinicId),
          eq(appointmentRequests.slotId, slotId),
          inArray(appointmentRequests.status, [...ACTIVE_APPOINTMENT_STATUSES]),
        ),
      )
      .then((rows) => rows[0]?.count ?? 0);
  }

  countActiveHolds(clinicId: string, slotId: string, db: Database = this.db) {
    return db
      .select({ count: sql<number>`count(*)::int` })
      .from(slotHolds)
      .where(
        and(
          eq(slotHolds.clinicId, clinicId),
          eq(slotHolds.slotId, slotId),
          eq(slotHolds.status, ACTIVE_HOLD_STATUS),
          gt(slotHolds.holdExpiresAt, sql`now()`),
        ),
      )
      .then((rows) => rows[0]?.count ?? 0);
  }

  countActiveHoldsExcluding(
    clinicId: string,
    slotId: string,
    excludeHoldId: string,
    db: Database = this.db,
  ) {
    return db
      .select({ count: sql<number>`count(*)::int` })
      .from(slotHolds)
      .where(
        and(
          eq(slotHolds.clinicId, clinicId),
          eq(slotHolds.slotId, slotId),
          eq(slotHolds.status, ACTIVE_HOLD_STATUS),
          gt(slotHolds.holdExpiresAt, sql`now()`),
          ne(slotHolds.id, excludeHoldId),
        ),
      )
      .then((rows) => rows[0]?.count ?? 0);
  }

  async countSlotLoad(
    clinicId: string,
    slotId: string,
    options: { excludeHoldId?: string } = {},
    db: Database = this.db,
  ): Promise<{ activeAppointments: number; activeHolds: number }> {
    const statusIn = sql.join(
      ACTIVE_APPOINTMENT_STATUSES.map((status) => sql`${status}`),
      sql`, `,
    );
    const holdFilter = options.excludeHoldId
      ? sql` AND id <> ${options.excludeHoldId}`
      : sql``;

    const [row] = await db.execute<{
      active_appointments: number;
      active_holds: number;
    }>(
      sql`
        SELECT
          (SELECT count(*)::int FROM appointment_requests
            WHERE clinic_id = ${clinicId}
              AND slot_id = ${slotId}
              AND status IN (${statusIn})) AS active_appointments,
          (SELECT count(*)::int FROM slot_holds
            WHERE clinic_id = ${clinicId}
              AND slot_id = ${slotId}
              AND status = ${ACTIVE_HOLD_STATUS}
              AND hold_expires_at > now()
              ${holdFilter}) AS active_holds
      `,
    );

    return {
      activeAppointments: Number(row?.active_appointments ?? 0),
      activeHolds: Number(row?.active_holds ?? 0),
    };
  }

  countActiveAppointmentsBySlots(clinicId: string, slotIds: string[], db: Database = this.db) {
    if (slotIds.length === 0) {
      return Promise.resolve(new Map<string, number>());
    }

    return db
      .select({
        slotId: appointmentRequests.slotId,
        count: sql<number>`count(*)::int`,
      })
      .from(appointmentRequests)
      .where(
        and(
          eq(appointmentRequests.clinicId, clinicId),
          inArray(appointmentRequests.slotId, slotIds),
          inArray(appointmentRequests.status, [...ACTIVE_APPOINTMENT_STATUSES]),
        ),
      )
      .groupBy(appointmentRequests.slotId)
      .then((rows) => {
        const counts = new Map<string, number>();
        for (const row of rows) {
          if (row.slotId) {
            counts.set(row.slotId, row.count);
          }
        }
        return counts;
      });
  }

  countActiveHoldsBySlots(clinicId: string, slotIds: string[], db: Database = this.db) {
    if (slotIds.length === 0) {
      return Promise.resolve(new Map<string, number>());
    }

    return db
      .select({
        slotId: slotHolds.slotId,
        count: sql<number>`count(*)::int`,
      })
      .from(slotHolds)
      .where(
        and(
          eq(slotHolds.clinicId, clinicId),
          inArray(slotHolds.slotId, slotIds),
          eq(slotHolds.status, ACTIVE_HOLD_STATUS),
          gt(slotHolds.holdExpiresAt, sql`now()`),
        ),
      )
      .groupBy(slotHolds.slotId)
      .then((rows) => {
        const counts = new Map<string, number>();
        for (const row of rows) {
          counts.set(row.slotId, row.count);
        }
        return counts;
      });
  }

  findHoldById(clinicId: string, holdId: string, db: Database = this.db) {
    return db
      .select()
      .from(slotHolds)
      .where(and(eq(slotHolds.clinicId, clinicId), eq(slotHolds.id, holdId)))
      .limit(1);
  }

  insertHold(values: typeof slotHolds.$inferInsert, db: Database = this.db) {
    return db.insert(slotHolds).values(values).returning();
  }

  listAvailableOpenSlots(
    clinicId: string,
    doctorId: string,
    clinicServiceId: string,
    date?: string,
  ) {
    const conditions = [
      eq(appointmentSlots.clinicId, clinicId),
      eq(appointmentSlots.doctorId, doctorId),
      eq(appointmentSlots.clinicServiceId, clinicServiceId),
      eq(appointmentSlots.status, 'open'),
      gt(appointmentSlots.startTime, clinicLocalNow(clinicId)),
    ];
    if (date) {
      conditions.push(sql`CAST(${appointmentSlots.startTime} AS date) = ${date}::date`);
    }

    return this.db
      .select()
      .from(appointmentSlots)
      .where(
        and(
          ...conditions,
          sql`NOT EXISTS (
            SELECT 1
            FROM clinic_holidays h
            WHERE h.clinic_id = ${clinicId}
              AND h.active = true
              AND h.holiday_date = date(${appointmentSlots.startTime})
              AND ${clinicHolidayOverlapsWindowClause(appointmentSlots.startTime, appointmentSlots.endTime, 'h')}
              AND (
                NOT EXISTS (
                  SELECT 1
                  FROM clinic_holiday_doctors chd
                  WHERE chd.clinic_id = h.clinic_id
                    AND chd.holiday_id = h.id
                )
                OR EXISTS (
                  SELECT 1
                  FROM clinic_holiday_doctors chd
                  WHERE chd.clinic_id = h.clinic_id
                    AND chd.holiday_id = h.id
                    AND chd.doctor_id = ${doctorId}
                )
              )
          )`,
        ),
      )
      .orderBy(appointmentSlots.startTime);
  }

  findSlotByExactTime(
    clinicId: string,
    doctorId: string,
    clinicServiceId: string,
    date: string,
    time: string,
  ) {
    const startTime = sql`${date}::date + ${time}::time`;

    return this.db
      .select()
      .from(appointmentSlots)
      .where(
        and(
          eq(appointmentSlots.clinicId, clinicId),
          eq(appointmentSlots.doctorId, doctorId),
          eq(appointmentSlots.clinicServiceId, clinicServiceId),
          eq(appointmentSlots.status, 'open'),
          sql`${appointmentSlots.startTime} = ${startTime}`,
          sql`NOT EXISTS (
            SELECT 1
            FROM clinic_holidays h
            WHERE h.clinic_id = ${clinicId}
              AND h.active = true
              AND h.holiday_date = date(${appointmentSlots.startTime})
              AND ${clinicHolidayOverlapsWindowClause(appointmentSlots.startTime, appointmentSlots.endTime, 'h')}
              AND (
                NOT EXISTS (
                  SELECT 1
                  FROM clinic_holiday_doctors chd
                  WHERE chd.clinic_id = h.clinic_id
                    AND chd.holiday_id = h.id
                )
                OR EXISTS (
                  SELECT 1
                  FROM clinic_holiday_doctors chd
                  WHERE chd.clinic_id = h.clinic_id
                    AND chd.holiday_id = h.id
                    AND chd.doctor_id = ${doctorId}
                )
              )
          )`,
        ),
      )
      .limit(1);
  }

  expireDueHolds(clinicId?: string, batchLimit = 100) {
    const conditions = [
      eq(slotHolds.status, ACTIVE_HOLD_STATUS),
      lte(slotHolds.holdExpiresAt, sql`now()`),
    ];
    if (clinicId) {
      conditions.push(eq(slotHolds.clinicId, clinicId));
    }

    return this.db
      .update(slotHolds)
      .set({ status: 'expired' })
      .where(
        and(
          ...conditions,
          sql`${slotHolds.id} IN (
            SELECT id FROM slot_holds
            WHERE ${and(...conditions)}
            LIMIT ${batchLimit}
          )`,
        ),
      )
      .returning();
  }

  releaseSessionHolds(clinicId?: string) {
    const conditions = [eq(slotHolds.status, ACTIVE_HOLD_STATUS)];
    if (clinicId) {
      conditions.push(eq(slotHolds.clinicId, clinicId));
    }

    return this.db
      .update(slotHolds)
      .set({ status: 'released' })
      .where(
        and(
          ...conditions,
          sql`session_id IN (
            SELECT id FROM conversation_sessions
            WHERE status IN ('completed', 'abandoned', 'expired')
          )`,
        ),
      )
      .returning();
  }

  updateFutureOpenSlotCapacity(
    clinicId: string,
    ruleId: string,
    capacityTotal: number,
    configVersion: number,
    startFrom?: string,
  ) {
    const conditions = [
      eq(appointmentSlots.clinicId, clinicId),
      eq(appointmentSlots.generatedFromRuleId, ruleId),
      eq(appointmentSlots.status, 'open'),
      gt(appointmentSlots.startTime, clinicLocalNow(clinicId)),
    ];
    if (startFrom) {
      conditions.push(gte(appointmentSlots.startTime, startFrom));
    }

    return this.db
      .update(appointmentSlots)
      .set({ capacityTotal, configVersion })
      .where(and(...conditions))
      .returning();
  }

  supersedeFutureOpenSlots(clinicId: string, ruleId: string, startFrom?: string) {
    const conditions = [
      eq(appointmentSlots.clinicId, clinicId),
      eq(appointmentSlots.generatedFromRuleId, ruleId),
      eq(appointmentSlots.status, 'open'),
      gt(appointmentSlots.startTime, clinicLocalNow(clinicId)),
    ];
    if (startFrom) {
      conditions.push(gte(appointmentSlots.startTime, startFrom));
    }

    return this.db
      .update(appointmentSlots)
      .set({ status: 'superseded' })
      .where(and(...conditions))
      .returning();
  }

  listFutureOpenSlotsForRule(clinicId: string, ruleId: string, startFrom?: string) {
    const conditions = [
      eq(appointmentSlots.clinicId, clinicId),
      eq(appointmentSlots.generatedFromRuleId, ruleId),
      eq(appointmentSlots.status, 'open'),
      gt(appointmentSlots.startTime, clinicLocalNow(clinicId)),
    ];
    if (startFrom) {
      conditions.push(gte(appointmentSlots.startTime, startFrom));
    }

    return this.db
      .select()
      .from(appointmentSlots)
      .where(and(...conditions));
  }

  findBookingRule(clinicId: string, ruleId: string) {
    return this.db
      .select()
      .from(doctorServiceBookingRules)
      .where(and(eq(doctorServiceBookingRules.clinicId, clinicId), eq(doctorServiceBookingRules.id, ruleId)))
      .limit(1);
  }

  updateBookingRule(
    clinicId: string,
    ruleId: string,
    values: Partial<typeof doctorServiceBookingRules.$inferInsert>,
  ) {
    return this.db
      .update(doctorServiceBookingRules)
      .set(values)
      .where(and(eq(doctorServiceBookingRules.clinicId, clinicId), eq(doctorServiceBookingRules.id, ruleId)))
      .returning();
  }

  insertAppointment(values: typeof appointmentRequests.$inferInsert, db: Database = this.db) {
    return db.insert(appointmentRequests).values(values).returning();
  }

  updateAppointmentStatus(
    clinicId: string,
    appointmentId: string,
    status: string,
    db: Database = this.db,
  ) {
    return db
      .update(appointmentRequests)
      .set({ status })
      .where(and(eq(appointmentRequests.clinicId, clinicId), eq(appointmentRequests.id, appointmentId)))
      .returning();
  }

  updateAppointmentSlotAndTime(
    clinicId: string,
    appointmentId: string,
    values: {
      slotId: string;
      appointmentStart: string;
      appointmentEnd: string;
    },
    db: Database = this.db,
  ) {
    return db
      .update(appointmentRequests)
      .set({
        slotId: values.slotId,
        appointmentStart: values.appointmentStart,
        appointmentEnd: values.appointmentEnd,
      })
      .where(and(eq(appointmentRequests.clinicId, clinicId), eq(appointmentRequests.id, appointmentId)))
      .returning();
  }

  updateHoldStatus(clinicId: string, holdId: string, status: string, db: Database = this.db) {
    return db
      .update(slotHolds)
      .set({ status })
      .where(and(eq(slotHolds.clinicId, clinicId), eq(slotHolds.id, holdId)))
      .returning();
  }

  releaseActiveHoldsForSession(clinicId: string, sessionId: string, db: Database = this.db) {
    return db
      .update(slotHolds)
      .set({ status: 'released' })
      .where(
        and(
          eq(slotHolds.clinicId, clinicId),
          eq(slotHolds.sessionId, sessionId),
          eq(slotHolds.status, ACTIVE_HOLD_STATUS),
        ),
      )
      .returning();
  }

  findActiveHoldForSession(clinicId: string, sessionId: string) {
    return this.db
      .select()
      .from(slotHolds)
      .where(
        and(
          eq(slotHolds.clinicId, clinicId),
          eq(slotHolds.sessionId, sessionId),
          eq(slotHolds.status, ACTIVE_HOLD_STATUS),
          gt(slotHolds.holdExpiresAt, sql`now()`),
        ),
      )
      .limit(1);
  }

  findLatestHoldForSession(clinicId: string, sessionId: string, db: Database = this.db) {
    return db
      .select()
      .from(slotHolds)
      .where(
        and(
          eq(slotHolds.clinicId, clinicId),
          eq(slotHolds.sessionId, sessionId),
          sql`${slotHolds.status} <> 'converted'`,
        ),
      )
      .orderBy(sql`${slotHolds.updatedAt} DESC`)
      .limit(1);
  }

  updateHold(
    clinicId: string,
    holdId: string,
    values: Partial<typeof slotHolds.$inferInsert>,
    db: Database = this.db,
  ) {
    return db
      .update(slotHolds)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(slotHolds.clinicId, clinicId), eq(slotHolds.id, holdId)))
      .returning();
  }

  // --- Daily rolling slot management extensions ---
  listDoctorWorkingHours(doctorId: string) {
    return this.db.select().from(doctorWorkingHours).where(eq(doctorWorkingHours.doctorId, doctorId));
  }

  listDoctorLeaves(doctorId: string, fromDate: string, toDate: string) {
    return this.db
      .select()
      .from(doctorLeaves)
      .where(
        and(
          eq(doctorLeaves.doctorId, doctorId),
          eq(doctorLeaves.status, 'active'),
          lte(doctorLeaves.startDate, toDate as unknown as typeof doctorLeaves.startDate),
          gte(doctorLeaves.endDate, fromDate as unknown as typeof doctorLeaves.endDate),
        ),
      );
  }

  listBlockedDates(hospitalId: string, fromDate: string, toDate: string) {
    return this.db
      .select()
      .from(blockedDates)
      .where(
        and(
          eq(blockedDates.hospitalId, hospitalId),
          eq(blockedDates.status, 'active'),
          gte(blockedDates.date, fromDate as unknown as typeof blockedDates.date),
          lte(blockedDates.date, toDate as unknown as typeof blockedDates.date),
        ),
      );
  }

  async expirePastSlots(clinicId: string): Promise<number> {
    const rows = await this.db
      .update(appointmentSlots)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(
        and(
          eq(appointmentSlots.clinicId, clinicId),
          eq(appointmentSlots.status, 'open'),
          sql`${appointmentSlots.endTime} <= ${clinicLocalNow(clinicId)}`,
        ),
      )
      .returning({ id: appointmentSlots.id });
    return rows.length;
  }

  async blockFutureSlotsForLeave(clinicId: string, doctorId: string, startDate: string, endDate: string): Promise<number> {
    const rows = await this.db
      .update(appointmentSlots)
      .set({ status: 'blocked', updatedAt: new Date() })
      .where(
        and(
          eq(appointmentSlots.clinicId, clinicId),
          eq(appointmentSlots.doctorId, doctorId),
          eq(appointmentSlots.status, 'open'),
          sql`date(${appointmentSlots.startTime}) >= ${startDate}::date`,
          sql`date(${appointmentSlots.startTime}) <= ${endDate}::date`,
          sql`${appointmentSlots.startTime} > ${clinicLocalNow(clinicId)}`,
        ),
      )
      .returning({ id: appointmentSlots.id });
    return rows.length;
  }

  insertSlotGenerationLog(values: typeof slotGenerationLogs.$inferInsert) {
    return this.db.insert(slotGenerationLogs).values(values).returning();
  }

  updateSlotGenerationLog(id: string, values: Partial<typeof slotGenerationLogs.$inferInsert>) {
    return this.db.update(slotGenerationLogs).set(values).where(eq(slotGenerationLogs.id, id)).returning();
  }

  listSlotGenerationLogs(limit = 20) {
    return this.db.select().from(slotGenerationLogs).orderBy(sql`${slotGenerationLogs.executionStartedAt} DESC`).limit(limit);
  }
}

function gteDate(column: typeof clinicHolidays.holidayDate, value: string) {
  return sql`${column} >= ${value}::date`;
}

function lteDate(column: typeof clinicHolidays.holidayDate, value: string) {
  return sql`${column} <= ${value}::date`;
}

function doctorHolidayScopeMatchesClause(
  clinicIdColumn: typeof clinicHolidays.clinicId,
  holidayIdColumn: typeof clinicHolidays.id,
  doctorId: string,
) {
  return sql`(
    NOT EXISTS (
      SELECT 1
      FROM clinic_holiday_doctors chd
      WHERE chd.clinic_id = ${clinicIdColumn}
        AND chd.holiday_id = ${holidayIdColumn}
    )
    OR EXISTS (
      SELECT 1
      FROM clinic_holiday_doctors chd
      WHERE chd.clinic_id = ${clinicIdColumn}
        AND chd.holiday_id = ${holidayIdColumn}
        AND chd.doctor_id = ${doctorId}
    )
  )`;
}

function clinicHolidayOverlapsWindowClause(startTime: string | typeof appointmentSlots.startTime, endTime: string | typeof appointmentSlots.endTime, holidayAlias: 'h' | 'clinic_holidays') {
  if (holidayAlias === 'h') {
    return sql`(
      h.is_full_day = true
      OR (
        h.start_time IS NOT NULL
        AND h.end_time IS NOT NULL
        AND CAST(${startTime}::timestamp AS time) < h.end_time
        AND CAST(${endTime}::timestamp AS time) > h.start_time
      )
    )`;
  }

  return sql`(
    clinic_holidays.is_full_day = true
    OR (
      clinic_holidays.start_time IS NOT NULL
      AND clinic_holidays.end_time IS NOT NULL
      AND CAST(${startTime}::timestamp AS time) < clinic_holidays.end_time
      AND CAST(${endTime}::timestamp AS time) > clinic_holidays.start_time
    )
  )`;
}
