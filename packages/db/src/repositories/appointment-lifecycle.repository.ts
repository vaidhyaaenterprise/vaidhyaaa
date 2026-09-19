import { and, desc, eq, getTableColumns, gt, inArray, sql } from 'drizzle-orm';

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
} from '../schema';
import { ACTIVE_APPOINTMENT_STATUSES } from '../services/slot-capacity';

function clinicLocalNow(clinicId: string) {
  return sql`(
    SELECT (now() AT TIME ZONE c.timezone)::timestamp
    FROM clinics c
    WHERE c.id = ${clinicId}
  )`;
}

const appointmentWithConflictDetails = {
  ...getTableColumns(appointmentRequests),
  doctorName: doctors.name,
  serviceName: clinicServices.serviceName,
};

export class AppointmentLifecycleRepository {
  constructor(private readonly db: Database) {}

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

  rejectPendingActionRequestsForAppointment(clinicId: string, appointmentId: string) {
    return this.db
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

  listAppointmentsForClinic(input: { clinicId: string; doctorId?: string; statuses?: string[] }) {
    const filters = [eq(appointmentRequests.clinicId, input.clinicId)];
    if (input.doctorId) {
      filters.push(eq(appointmentRequests.doctorId, input.doctorId));
    }
    if (input.statuses?.length) {
      filters.push(inArray(appointmentRequests.status, input.statuses));
    }
    return this.db
      .select()
      .from(appointmentRequests)
      .where(and(...filters))
      .orderBy(desc(appointmentRequests.appointmentStart));
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

  insertAppointmentEvent(values: typeof appointmentEvents.$inferInsert) {
    return this.db.insert(appointmentEvents).values(values).returning();
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
