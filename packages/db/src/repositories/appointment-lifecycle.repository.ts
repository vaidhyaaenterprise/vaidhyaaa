import { and, desc, eq, getTableColumns, gt, inArray, or, sql } from 'drizzle-orm';

import type { Database } from '../client';
import {
  appointmentActionRequests,
  appointmentEvents,
  appointmentRequests,
  callbackRequests,
  clinicServices,
  doctors,
  emergencyIncidents,
  notificationEvents,
  patients,
  patientVisits,
} from '../schema';
import { ACTIVE_APPOINTMENT_STATUSES } from '../services/slot-capacity';

function clinicLocalNow(clinicId: string) {
  return sql`(
    SELECT (now() AT TIME ZONE c.timezone)::timestamp
    FROM clinics c
    WHERE c.id = ${clinicId}
  )`;
}

function clinicActivityRetentionStartDate(clinicId: string) {
  return sql`((${clinicLocalNow(clinicId)})::date - 3)`;
}

function clinicDateOfInstant(value: typeof appointmentEvents.createdAt, clinicId: string) {
  return sql`(${value} AT TIME ZONE (
    SELECT c.timezone
    FROM clinics c
    WHERE c.id = ${clinicId}
  ))::date`;
}

const appointmentWithConflictDetails = {
  ...getTableColumns(appointmentRequests),
  doctorName: doctors.name,
  serviceName: clinicServices.serviceName,
};

export type DoctorAnalyticsPoint = {
  periodStart: string;
  label: string;
  total: number;
  newPatients: number;
  followUps: number;
};

export type DoctorMonthlyAnalyticsPoint = DoctorAnalyticsPoint & {
  averagePerDay: number;
};

export type DoctorAnalyticsResult = {
  stats: {
    confirmedThisMonth: number;
    newConfirmedThisMonth: number;
    followUpConfirmedThisMonth: number;
    averageConfirmedPerDay: number;
  };
  trends: {
    daily: DoctorAnalyticsPoint[];
    weekly: DoctorAnalyticsPoint[];
    monthly: DoctorAnalyticsPoint[];
  };
  topConditions: Array<{ condition: string; count: number }>;
  ageGroups: Array<{ label: string; count: number }>;
  monthlySummary: DoctorMonthlyAnalyticsPoint[];
};

type AnalyticsPeriodRow = {
  period_start: string;
  label: string;
  total: number;
  new_patients: number;
  follow_ups: number;
};

type MonthlyAnalyticsPeriodRow = AnalyticsPeriodRow & {
  average_per_day: number;
};

function mapAnalyticsPoint(row: AnalyticsPeriodRow): DoctorAnalyticsPoint {
  return {
    periodStart: row.period_start,
    label: row.label,
    total: Number(row.total),
    newPatients: Number(row.new_patients),
    followUps: Number(row.follow_ups),
  };
}

export class AppointmentLifecycleRepository {
  constructor(private readonly db: Database) {}

  async markPastConfirmedNoShows(clinicId?: string): Promise<number> {
    // Appointment timestamps are clinic-local wall clocks, not UTC instants.
    // Only dates before clinic-today qualify; an elapsed slot today stays confirmed.
    // One statement makes the status change, audit event and stale request closure
    // atomic. The status predicate is rechecked after concurrent row updates.
    const rows = await this.db.execute<{ updated_count: number }>(sql`
      WITH transitioned AS (
        UPDATE appointment_requests AS a
        SET status = 'no_show', updated_at = now()
        FROM clinics AS c
        WHERE a.clinic_id = c.id
          AND a.status = 'confirmed'
          AND a.appointment_start < (now() AT TIME ZONE c.timezone)::date
          AND NOT EXISTS (
            SELECT 1 FROM appointment_events AS e
            WHERE e.clinic_id = a.clinic_id AND e.appointment_request_id = a.id
              AND e.event_type = 'appointment.status_corrected'
              AND e.new_values_json->>'status' = 'confirmed'
              AND (e.new_values_json->>'appointment_start')::timestamp = a.appointment_start
              AND (e.created_at AT TIME ZONE c.timezone)::date > a.appointment_start::date
              AND NOT EXISTS (
                SELECT 1 FROM appointment_events AS later
                WHERE later.clinic_id = a.clinic_id AND later.appointment_request_id = a.id
                  AND later.event_type = 'appointment.rescheduled'
                  AND later.created_at >= e.created_at
              )
          )
          ${clinicId ? sql`AND a.clinic_id = ${clinicId}` : sql``}
        RETURNING a.id, a.clinic_id
      ), recorded AS (
        INSERT INTO appointment_events (
          clinic_id, appointment_request_id, event_type, actor_type,
          old_values_json, new_values_json
        )
        SELECT clinic_id, id, 'appointment.no_show', 'system',
          '{"status":"confirmed"}'::jsonb, '{"status":"no_show"}'::jsonb
        FROM transitioned
        RETURNING id
      ), closed_requests AS (
        UPDATE appointment_action_requests AS r
        SET status = 'rejected', updated_at = now()
        FROM transitioned AS t
        WHERE r.clinic_id = t.clinic_id AND r.appointment_id = t.id
          AND r.status = 'pending'
        RETURNING r.id
      )
      SELECT count(*)::int AS updated_count FROM transitioned
    `);
    return rows[0]?.updated_count ?? 0;
  }

  listUpcomingAppointmentsByPhone(clinicId: string, patientPhone: string) {
    return this.db
      .select()
      .from(appointmentRequests)
      .where(
        and(
          eq(appointmentRequests.clinicId, clinicId),
          eq(appointmentRequests.patientPhone, patientPhone),
          inArray(appointmentRequests.status, [...ACTIVE_APPOINTMENT_STATUSES]),
          gt(appointmentRequests.appointmentStart, clinicLocalNow(clinicId)),
        ),
      )
      .orderBy(appointmentRequests.appointmentStart);
  }

  findAppointmentById(clinicId: string, appointmentId: string) {
    return this.db
      .select()
      .from(appointmentRequests)
      .where(
        and(eq(appointmentRequests.clinicId, clinicId), eq(appointmentRequests.id, appointmentId)),
      )
      .limit(1);
  }

  findAppointmentByIdForUpdate(clinicId: string, appointmentId: string, db: Database = this.db) {
    return db
      .select()
      .from(appointmentRequests)
      .where(
        and(eq(appointmentRequests.clinicId, clinicId), eq(appointmentRequests.id, appointmentId)),
      )
      .for('update')
      .limit(1);
  }

  setCorrectedStatus(
    clinicId: string,
    appointmentId: string,
    status: string,
    db: Database = this.db,
  ) {
    return db
      .update(appointmentRequests)
      .set({ status, updatedAt: new Date() })
      .where(
        and(eq(appointmentRequests.clinicId, clinicId), eq(appointmentRequests.id, appointmentId)),
      )
      .returning();
  }

  findAppointmentsByIds(clinicId: string, appointmentIds: string[]) {
    if (appointmentIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .select()
      .from(appointmentRequests)
      .where(
        and(
          eq(appointmentRequests.clinicId, clinicId),
          inArray(appointmentRequests.id, appointmentIds),
        ),
      );
  }

  updatePatientNameForAppointments(
    clinicId: string,
    appointmentId: string,
    patientId: string | null,
    patientName: string,
    db: Database = this.db,
  ) {
    return db
      .update(appointmentRequests)
      .set({ patientName, updatedAt: new Date() })
      .where(
        patientId
          ? and(
              eq(appointmentRequests.clinicId, clinicId),
              eq(appointmentRequests.patientId, patientId),
            )
          : and(
              eq(appointmentRequests.clinicId, clinicId),
              eq(appointmentRequests.id, appointmentId),
            ),
      )
      .returning();
  }

  findPendingActionRequest(input: {
    clinicId: string;
    sessionId: string;
    appointmentId: string;
    requestType: 'cancel' | 'reschedule';
  }) {
    return this.db
      .select()
      .from(appointmentActionRequests)
      .where(
        and(
          eq(appointmentActionRequests.clinicId, input.clinicId),
          eq(appointmentActionRequests.appointmentId, input.appointmentId),
          eq(appointmentActionRequests.requestType, input.requestType),
          eq(appointmentActionRequests.status, 'pending'),
          eq(appointmentActionRequests.sourceSessionId, input.sessionId),
        ),
      )
      .limit(1);
  }

  insertActionRequest(values: typeof appointmentActionRequests.$inferInsert) {
    return this.db.insert(appointmentActionRequests).values(values).returning();
  }

  rejectPendingActionRequestsForAppointment(
    clinicId: string,
    appointmentId: string,
    db: Database = this.db,
  ) {
    return db
      .update(appointmentActionRequests)
      .set({
        status: 'rejected',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(appointmentActionRequests.clinicId, clinicId),
          eq(appointmentActionRequests.appointmentId, appointmentId),
          eq(appointmentActionRequests.status, 'pending'),
        ),
      )
      .returning();
  }

  insertCallbackRequest(values: typeof callbackRequests.$inferInsert) {
    return this.db.insert(callbackRequests).values(values).returning();
  }

  insertEmergencyIncident(values: typeof emergencyIncidents.$inferInsert) {
    return this.db.insert(emergencyIncidents).values(values).returning();
  }

  linkLatestEmergencyToCall(clinicId: string, sessionId: string, callId: string) {
    return this.db
      .update(emergencyIncidents)
      .set({ sourceCallId: callId, updatedAt: new Date() })
      .where(
        and(
          eq(emergencyIncidents.clinicId, clinicId),
          eq(emergencyIncidents.sourceSessionId, sessionId),
        ),
      )
      .returning();
  }

  findLatestEmergencyForSession(clinicId: string, sessionId: string) {
    return this.db
      .select()
      .from(emergencyIncidents)
      .where(
        and(
          eq(emergencyIncidents.clinicId, clinicId),
          eq(emergencyIncidents.sourceSessionId, sessionId),
        ),
      )
      .orderBy(desc(emergencyIncidents.createdAt))
      .limit(1);
  }

  listAppointmentsForClinic(input: {
    clinicId: string;
    doctorId?: string;
    statuses?: string[];
    date?: string;
  }) {
    const filters = [eq(appointmentRequests.clinicId, input.clinicId)];
    if (input.doctorId) {
      filters.push(eq(appointmentRequests.doctorId, input.doctorId));
    }
    if (input.statuses?.length) {
      filters.push(inArray(appointmentRequests.status, input.statuses));
    }
    if (input.date) {
      // Appointment timestamps store clinic-local wall clocks. Preserve the
      // selected calendar date rather than converting it to a UTC instant.
      filters.push(sql`${appointmentRequests.appointmentStart} >= ${input.date}::date`);
      filters.push(
        sql`${appointmentRequests.appointmentStart} < ${input.date}::date + interval '1 day'`,
      );
    }
    return this.db
      .select({
        ...getTableColumns(appointmentRequests),
        patientAge: sql<number | null>`coalesce(
          ${patients.ageYears},
          extract(year from age(current_date, ${patients.dateOfBirth}))::int
        )`,
        patientGender: patients.gender,
        hasHistory: sql<boolean>`exists (
          select 1 from ${patientVisits}
          where ${patientVisits.clinicId} = ${appointmentRequests.clinicId}
            and ${patientVisits.patientId} = ${appointmentRequests.patientId}
            and ${patientVisits.appointmentRequestId} is distinct from ${appointmentRequests.id}
        )`,
      })
      .from(appointmentRequests)
      .leftJoin(
        patients,
        and(
          eq(patients.clinicId, appointmentRequests.clinicId),
          eq(patients.id, appointmentRequests.patientId),
        ),
      )
      .where(and(...filters))
      .orderBy(desc(appointmentRequests.appointmentStart));
  }

  async getDoctorAnalytics(clinicId: string, doctorId: string): Promise<DoctorAnalyticsResult> {
    const [statsRows, dailyRows, weeklyRows, monthlyRows, topConditionRows, ageGroupRows] =
      await Promise.all([
        this.db.execute<{
          confirmed_this_month: number;
          new_confirmed_this_month: number;
          follow_up_confirmed_this_month: number;
          average_confirmed_per_day: number;
        }>(sql`
          WITH bounds AS (
            SELECT
              date_trunc('month', now() AT TIME ZONE c.timezone) AS month_start,
              date_trunc('month', now() AT TIME ZONE c.timezone) + interval '1 month' AS next_month
            FROM clinics AS c
            WHERE c.id = ${clinicId}::uuid
          ), confirmed AS (
            SELECT a.is_followup, a.appointment_start::date AS appointment_date
            FROM appointment_requests AS a
            CROSS JOIN bounds AS b
            WHERE a.clinic_id = ${clinicId}::uuid
              AND a.doctor_id = ${doctorId}::uuid
              AND a.status = 'confirmed'
              AND a.appointment_start >= b.month_start
              AND a.appointment_start < b.next_month
          )
          SELECT
            count(*)::int AS confirmed_this_month,
            count(*) FILTER (WHERE NOT is_followup)::int AS new_confirmed_this_month,
            count(*) FILTER (WHERE is_followup)::int AS follow_up_confirmed_this_month,
            coalesce(
              round(count(*)::numeric / nullif(count(DISTINCT appointment_date), 0)),
              0
            )::int AS average_confirmed_per_day
          FROM confirmed
        `),
        this.db.execute<AnalyticsPeriodRow>(sql`
          WITH bounds AS (
            SELECT (now() AT TIME ZONE c.timezone)::date AS today
            FROM clinics AS c
            WHERE c.id = ${clinicId}::uuid
          ), periods AS (
            SELECT generate_series(
              b.today - interval '6 days',
              b.today,
              interval '1 day'
            )::date AS period_start
            FROM bounds AS b
          ), counts AS (
            SELECT
              a.appointment_start::date AS period_start,
              count(*)::int AS total,
              count(*) FILTER (WHERE NOT a.is_followup)::int AS new_patients,
              count(*) FILTER (WHERE a.is_followup)::int AS follow_ups
            FROM appointment_requests AS a
            CROSS JOIN bounds AS b
            WHERE a.clinic_id = ${clinicId}::uuid
              AND a.doctor_id = ${doctorId}::uuid
              AND a.status IN ('confirmed', 'visited')
              AND a.appointment_start >= b.today - interval '6 days'
              AND a.appointment_start < b.today + interval '1 day'
            GROUP BY a.appointment_start::date
          )
          SELECT
            p.period_start::text AS period_start,
            to_char(p.period_start, 'DD Mon') AS label,
            coalesce(c.total, 0)::int AS total,
            coalesce(c.new_patients, 0)::int AS new_patients,
            coalesce(c.follow_ups, 0)::int AS follow_ups
          FROM periods AS p
          LEFT JOIN counts AS c USING (period_start)
          ORDER BY p.period_start
        `),
        this.db.execute<AnalyticsPeriodRow>(sql`
          WITH bounds AS (
            SELECT date_trunc('week', now() AT TIME ZONE c.timezone)::date AS current_week
            FROM clinics AS c
            WHERE c.id = ${clinicId}::uuid
          ), periods AS (
            SELECT generate_series(
              b.current_week - interval '5 weeks',
              b.current_week,
              interval '1 week'
            )::date AS period_start
            FROM bounds AS b
          ), counts AS (
            SELECT
              date_trunc('week', a.appointment_start)::date AS period_start,
              count(*)::int AS total,
              count(*) FILTER (WHERE NOT a.is_followup)::int AS new_patients,
              count(*) FILTER (WHERE a.is_followup)::int AS follow_ups
            FROM appointment_requests AS a
            CROSS JOIN bounds AS b
            WHERE a.clinic_id = ${clinicId}::uuid
              AND a.doctor_id = ${doctorId}::uuid
              AND a.status IN ('confirmed', 'visited')
              AND a.appointment_start >= b.current_week - interval '5 weeks'
              AND a.appointment_start < b.current_week + interval '1 week'
            GROUP BY date_trunc('week', a.appointment_start)::date
          )
          SELECT
            p.period_start::text AS period_start,
            to_char(p.period_start, 'DD Mon') AS label,
            coalesce(c.total, 0)::int AS total,
            coalesce(c.new_patients, 0)::int AS new_patients,
            coalesce(c.follow_ups, 0)::int AS follow_ups
          FROM periods AS p
          LEFT JOIN counts AS c USING (period_start)
          ORDER BY p.period_start
        `),
        this.db.execute<MonthlyAnalyticsPeriodRow>(sql`
          WITH bounds AS (
            SELECT date_trunc('month', now() AT TIME ZONE c.timezone)::date AS current_month
            FROM clinics AS c
            WHERE c.id = ${clinicId}::uuid
          ), periods AS (
            SELECT generate_series(
              b.current_month - interval '5 months',
              b.current_month,
              interval '1 month'
            )::date AS period_start
            FROM bounds AS b
          ), counts AS (
            SELECT
              date_trunc('month', a.appointment_start)::date AS period_start,
              count(*)::int AS total,
              count(*) FILTER (WHERE NOT a.is_followup)::int AS new_patients,
              count(*) FILTER (WHERE a.is_followup)::int AS follow_ups,
              coalesce(
                round(
                  count(*)::numeric /
                    nullif(count(DISTINCT a.appointment_start::date), 0)
                ),
                0
              )::int AS average_per_day
            FROM appointment_requests AS a
            CROSS JOIN bounds AS b
            WHERE a.clinic_id = ${clinicId}::uuid
              AND a.doctor_id = ${doctorId}::uuid
              AND a.status IN ('confirmed', 'visited')
              AND a.appointment_start >= b.current_month - interval '5 months'
              AND a.appointment_start < b.current_month + interval '1 month'
            GROUP BY date_trunc('month', a.appointment_start)::date
          )
          SELECT
            p.period_start::text AS period_start,
            to_char(p.period_start, 'Mon YYYY') AS label,
            coalesce(c.total, 0)::int AS total,
            coalesce(c.new_patients, 0)::int AS new_patients,
            coalesce(c.follow_ups, 0)::int AS follow_ups,
            coalesce(c.average_per_day, 0)::int AS average_per_day
          FROM periods AS p
          LEFT JOIN counts AS c USING (period_start)
          ORDER BY p.period_start
        `),
        this.db.execute<{ condition: string; count: number }>(sql`
          WITH grouped AS (
            SELECT
              lower(regexp_replace(btrim(v.diagnosis), '\\s+', ' ', 'g'))
                AS normalized_condition,
              min(regexp_replace(btrim(v.diagnosis), '\\s+', ' ', 'g')) AS condition,
              count(*)::int AS count
            FROM patient_visits AS v
            WHERE v.clinic_id = ${clinicId}::uuid
              AND v.doctor_id = ${doctorId}::uuid
              AND v.diagnosis IS NOT NULL
              AND btrim(v.diagnosis) <> ''
            GROUP BY lower(regexp_replace(btrim(v.diagnosis), '\\s+', ' ', 'g'))
          )
          SELECT condition, count
          FROM grouped
          ORDER BY count DESC, normalized_condition ASC
          LIMIT 5
        `),
        this.db.execute<{ label: string; count: number; sort_order: number }>(sql`
          WITH bounds AS (
            SELECT
              (now() AT TIME ZONE c.timezone)::date AS today,
              date_trunc('month', now() AT TIME ZONE c.timezone) - interval '5 months'
                AS first_month,
              date_trunc('month', now() AT TIME ZONE c.timezone) + interval '1 month'
                AS next_month
            FROM clinics AS c
            WHERE c.id = ${clinicId}::uuid
          ), age_ranges(label, min_age, max_age, sort_order) AS (
            VALUES
              ('0–18', 0, 18, 1),
              ('19–30', 19, 30, 2),
              ('31–45', 31, 45, 3),
              ('46–60', 46, 60, 4),
              ('61–75', 61, 75, 5),
              ('76+', 76, NULL, 6)
          ), encounter_ages AS (
            SELECT DISTINCT
              p.id,
              coalesce(
                p.age_years,
                extract(year FROM age(b.today, p.date_of_birth))::int
              ) AS age
            FROM appointment_requests AS a
            INNER JOIN patients AS p
              ON p.clinic_id = a.clinic_id AND p.id = a.patient_id
            CROSS JOIN bounds AS b
            WHERE a.clinic_id = ${clinicId}::uuid
              AND a.doctor_id = ${doctorId}::uuid
              AND a.status IN ('confirmed', 'visited')
              AND a.appointment_start >= b.first_month
              AND a.appointment_start < b.next_month
          ), counts AS (
            SELECT r.sort_order, count(e.age)::int AS count
            FROM age_ranges AS r
            LEFT JOIN encounter_ages AS e
              ON e.age >= r.min_age AND (r.max_age IS NULL OR e.age <= r.max_age)
            GROUP BY r.sort_order
          )
          SELECT r.label, coalesce(c.count, 0)::int AS count, r.sort_order
          FROM age_ranges AS r
          LEFT JOIN counts AS c USING (sort_order)
          ORDER BY r.sort_order
        `),
      ]);

    const stats = statsRows[0];
    const monthlySummary = monthlyRows.map((row) => ({
      ...mapAnalyticsPoint(row),
      averagePerDay: Number(row.average_per_day),
    }));

    return {
      stats: {
        confirmedThisMonth: Number(stats?.confirmed_this_month ?? 0),
        newConfirmedThisMonth: Number(stats?.new_confirmed_this_month ?? 0),
        followUpConfirmedThisMonth: Number(stats?.follow_up_confirmed_this_month ?? 0),
        averageConfirmedPerDay: Number(stats?.average_confirmed_per_day ?? 0),
      },
      trends: {
        daily: dailyRows.map(mapAnalyticsPoint),
        weekly: weeklyRows.map(mapAnalyticsPoint),
        monthly: monthlySummary.map(({ averagePerDay: _averagePerDay, ...row }) => row),
      },
      topConditions: topConditionRows.slice(0, 5).map((row) => ({
        condition: row.condition,
        count: Number(row.count),
      })),
      ageGroups: ageGroupRows.map((row) => ({ label: row.label, count: Number(row.count) })),
      monthlySummary,
    };
  }

  listClinicAdminAppointmentActivities(clinicId: string) {
    const retentionStartDate = clinicActivityRetentionStartDate(clinicId);
    // Select the final change before retention and pagination. Otherwise an old
    // reschedule can resurface when the appointment's newer cancellation expires,
    // and repeated edits can crowd other appointments out of the feed.
    const latestChanges = this.db
      .selectDistinctOn([appointmentEvents.appointmentRequestId], { id: appointmentEvents.id })
      .from(appointmentEvents)
      .where(
        and(
          eq(appointmentEvents.clinicId, clinicId),
          eq(appointmentEvents.actorType, 'clinic_admin'),
          inArray(appointmentEvents.eventType, [
            'appointment.rescheduled',
            'appointment.cancelled',
          ]),
        ),
      )
      .orderBy(
        appointmentEvents.appointmentRequestId,
        desc(appointmentEvents.createdAt),
        desc(appointmentEvents.id),
      )
      .as('latest_appointment_changes');

    return this.db
      .select({
        id: appointmentEvents.id,
        appointmentId: appointmentRequests.id,
        patientName: appointmentRequests.patientName,
        patientPhone: appointmentRequests.patientPhone,
        doctorId: appointmentRequests.doctorId,
        doctorName: doctors.name,
        clinicServiceId: appointmentRequests.clinicServiceId,
        serviceName: clinicServices.serviceName,
        reasonForVisit: appointmentRequests.reasonForVisit,
        eventType: appointmentEvents.eventType,
        occurredAt: appointmentEvents.createdAt,
        oldValuesJson: appointmentEvents.oldValuesJson,
        newValuesJson: appointmentEvents.newValuesJson,
        appointmentStart: appointmentRequests.appointmentStart,
        appointmentEnd: appointmentRequests.appointmentEnd,
      })
      .from(appointmentEvents)
      .innerJoin(latestChanges, eq(appointmentEvents.id, latestChanges.id))
      .innerJoin(
        appointmentRequests,
        and(
          eq(appointmentRequests.clinicId, appointmentEvents.clinicId),
          eq(appointmentRequests.id, appointmentEvents.appointmentRequestId),
        ),
      )
      .innerJoin(
        doctors,
        and(
          eq(doctors.clinicId, appointmentEvents.clinicId),
          eq(doctors.id, appointmentRequests.doctorId),
        ),
      )
      .innerJoin(
        clinicServices,
        and(
          eq(clinicServices.clinicId, appointmentEvents.clinicId),
          eq(clinicServices.id, appointmentRequests.clinicServiceId),
        ),
      )
      .where(
        and(
          eq(appointmentEvents.clinicId, clinicId),
          eq(appointmentEvents.actorType, 'clinic_admin'),
          inArray(appointmentEvents.eventType, [
            'appointment.rescheduled',
            'appointment.cancelled',
          ]),
          or(
            and(
              eq(appointmentEvents.eventType, 'appointment.cancelled'),
              sql`${clinicDateOfInstant(appointmentEvents.createdAt, clinicId)} >= ${retentionStartDate}`,
            ),
            and(
              eq(appointmentEvents.eventType, 'appointment.rescheduled'),
              sql`${appointmentRequests.appointmentStart}::date >= ${retentionStartDate}`,
            ),
          ),
        ),
      )
      .orderBy(desc(appointmentEvents.createdAt), desc(appointmentEvents.id))
      .limit(100);
  }

  listPendingActionRequests(clinicId: string) {
    return this.db
      .select()
      .from(appointmentActionRequests)
      .where(
        and(
          eq(appointmentActionRequests.clinicId, clinicId),
          eq(appointmentActionRequests.status, 'pending'),
        ),
      )
      .orderBy(desc(appointmentActionRequests.createdAt));
  }

  findActionRequestById(clinicId: string, actionRequestId: string) {
    return this.db
      .select()
      .from(appointmentActionRequests)
      .where(
        and(
          eq(appointmentActionRequests.clinicId, clinicId),
          eq(appointmentActionRequests.id, actionRequestId),
        ),
      )
      .limit(1);
  }

  updateActionRequest(
    clinicId: string,
    actionRequestId: string,
    values: Partial<typeof appointmentActionRequests.$inferInsert>,
  ) {
    return this.db
      .update(appointmentActionRequests)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          eq(appointmentActionRequests.clinicId, clinicId),
          eq(appointmentActionRequests.id, actionRequestId),
        ),
      )
      .returning();
  }

  listFutureActiveAppointments(clinicId: string, doctorId?: string) {
    const filters = [
      eq(appointmentRequests.clinicId, clinicId),
      inArray(appointmentRequests.status, [...ACTIVE_APPOINTMENT_STATUSES]),
      gt(appointmentRequests.appointmentStart, clinicLocalNow(clinicId)),
    ];

    if (doctorId) {
      filters.push(eq(appointmentRequests.doctorId, doctorId));
    }

    return this.db
      .select(appointmentWithConflictDetails)
      .from(appointmentRequests)
      .leftJoin(
        doctors,
        and(
          eq(doctors.id, appointmentRequests.doctorId),
          eq(doctors.clinicId, appointmentRequests.clinicId),
        ),
      )
      .leftJoin(
        clinicServices,
        and(
          eq(clinicServices.id, appointmentRequests.clinicServiceId),
          eq(clinicServices.clinicId, appointmentRequests.clinicId),
        ),
      )
      .where(and(...filters));
  }

  listActiveAppointmentsOnDate(clinicId: string, holidayDate: string, doctorIds?: string[]) {
    const filters = [
      eq(appointmentRequests.clinicId, clinicId),
      inArray(appointmentRequests.status, [...ACTIVE_APPOINTMENT_STATUSES]),
      sql`date(${appointmentRequests.appointmentStart}) = ${holidayDate}::date`,
    ];

    if (doctorIds && doctorIds.length > 0) {
      filters.push(inArray(appointmentRequests.doctorId, doctorIds));
    }

    return this.db
      .select(appointmentWithConflictDetails)
      .from(appointmentRequests)
      .leftJoin(
        doctors,
        and(
          eq(doctors.id, appointmentRequests.doctorId),
          eq(doctors.clinicId, appointmentRequests.clinicId),
        ),
      )
      .leftJoin(
        clinicServices,
        and(
          eq(clinicServices.id, appointmentRequests.clinicServiceId),
          eq(clinicServices.clinicId, appointmentRequests.clinicId),
        ),
      )
      .where(and(...filters));
  }

  insertAppointmentEvent(values: typeof appointmentEvents.$inferInsert, db: Database = this.db) {
    return db.insert(appointmentEvents).values(values).returning();
  }

  async insertNotificationEvent(values: typeof notificationEvents.$inferInsert) {
    if (values.deduplicationKey) {
      const existing = await this.db
        .select()
        .from(notificationEvents)
        .where(
          and(
            eq(notificationEvents.clinicId, values.clinicId),
            eq(notificationEvents.deduplicationKey, values.deduplicationKey),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        return existing;
      }
    }

    return this.db.insert(notificationEvents).values(values).returning();
  }
}
