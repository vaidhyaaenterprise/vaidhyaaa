import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import type { Database } from '../client';
import {
  appointmentRequests,
  backgroundJobs,
  clinicHolidayDoctors,
  clinicHolidays,
  clinicHours,
  clinicServices,
  doctorSchedules,
  doctorServiceBookingRules,
  doctorServices,
  doctors,
  notificationEvents,
  patientVisits,
  patients,
} from '../schema';
import { calls } from '../schema/tables/appointments';
import { callbackRequests } from '../schema/tables/extended';

export class ClinicalSetupRepository {
  constructor(private readonly db: Database) {}

  searchPatientsForHistory(
    clinicId: string,
    input: {
      phone?: string;
      name?: string;
      age?: number;
      limit: number;
    },
  ) {
    const filters = [eq(patients.clinicId, clinicId)];

    if (input.phone) {
      filters.push(
        sql`(
          regexp_replace(coalesce(${patients.phone}, ''), '[^0-9]', '', 'g') = ${input.phone}
          OR regexp_replace(coalesce(${patients.phone}, ''), '[^0-9]', '', 'g') LIKE ${`%${input.phone}`}
        )`,
      );
    }

    if (input.name) {
      filters.push(sql`lower(coalesce(${patients.name}, '')) like ${`%${input.name}%`}`);
    }

    if (input.age !== undefined) {
      filters.push(sql`(
        ${patients.ageYears} = ${input.age}
        OR (
          ${patients.ageYears} IS NULL
          AND ${patients.dateOfBirth} IS NOT NULL
          AND extract(year from age(current_date, ${patients.dateOfBirth}))::int = ${input.age}
        )
      )`);
    }

    return this.db
      .select({
        id: patients.id,
        name: patients.name,
        phone: patients.phone,
        gender: patients.gender,
        dateOfBirth: patients.dateOfBirth,
        ageYears: sql<number | null>`
          case
            when ${patients.ageYears} is not null then ${patients.ageYears}
            when ${patients.dateOfBirth} is null then null
            else extract(year from age(current_date, ${patients.dateOfBirth}))::int
          end
        `,
      })
      .from(patients)
      .where(and(...filters))
      .orderBy(desc(patients.updatedAt))
      .limit(input.limit);
  }

  listVisitsForPatientHistory(clinicId: string, patientIds: string[]) {
    if (patientIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .select({
        id: patientVisits.id,
        patientId: patientVisits.patientId,
        appointmentRequestId: patientVisits.appointmentRequestId,
        doctorId: patientVisits.doctorId,
        doctorName: doctors.name,
        clinicServiceId: patientVisits.clinicServiceId,
        clinicServiceName: clinicServices.serviceName,
        reasonForVisit: patientVisits.reasonForVisit,
        examinationNotes: patientVisits.examinationNotes,
        diagnosis: patientVisits.diagnosis,
        advice: patientVisits.advice,
        visitedAt: patientVisits.visitedAt,
      })
      .from(patientVisits)
      .innerJoin(
        doctors,
        and(
          eq(doctors.clinicId, patientVisits.clinicId),
          eq(doctors.id, patientVisits.doctorId),
        ),
      )
      .innerJoin(
        clinicServices,
        and(
          eq(clinicServices.clinicId, patientVisits.clinicId),
          eq(clinicServices.id, patientVisits.clinicServiceId),
        ),
      )
      .where(
        and(
          eq(patientVisits.clinicId, clinicId),
          inArray(patientVisits.patientId, patientIds),
        ),
      )
      .orderBy(desc(patientVisits.visitedAt));
  }

  listAppointmentsForPatientHistory(clinicId: string, patientIds: string[]) {
    if (patientIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .select({
        id: appointmentRequests.id,
        patientId: appointmentRequests.patientId,
        doctorId: appointmentRequests.doctorId,
        doctorName: doctors.name,
        clinicServiceId: appointmentRequests.clinicServiceId,
        clinicServiceName: clinicServices.serviceName,
        appointmentStart: appointmentRequests.appointmentStart,
        appointmentEnd: appointmentRequests.appointmentEnd,
        reasonForVisit: appointmentRequests.reasonForVisit,
        status: appointmentRequests.status,
      })
      .from(appointmentRequests)
      .innerJoin(
        doctors,
        and(
          eq(doctors.clinicId, appointmentRequests.clinicId),
          eq(doctors.id, appointmentRequests.doctorId),
        ),
      )
      .innerJoin(
        clinicServices,
        and(
          eq(clinicServices.clinicId, appointmentRequests.clinicId),
          eq(clinicServices.id, appointmentRequests.clinicServiceId),
        ),
      )
      .where(
        and(
          eq(appointmentRequests.clinicId, clinicId),
          inArray(appointmentRequests.patientId, patientIds),
        ),
      )
      .orderBy(desc(appointmentRequests.appointmentStart));
  }

  listClinicHours(clinicId: string) {
    return this.db
      .select()
      .from(clinicHours)
      .where(eq(clinicHours.clinicId, clinicId))
      .orderBy(clinicHours.dayOfWeek, clinicHours.startTime);
  }

  async replaceClinicHours(
    clinicId: string,
    windows: Array<{
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      active: boolean;
    }>,
  ) {
    await this.db
      .update(clinicHours)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(clinicHours.clinicId, clinicId));

    if (windows.length === 0) {
      return [];
    }

    return this.db
      .insert(clinicHours)
      .values(
        windows.map((window) => ({
          clinicId,
          dayOfWeek: window.dayOfWeek,
          startTime: window.startTime,
          endTime: window.endTime,
          active: window.active,
        })),
      )
      .returning();
  }

  listHolidays(clinicId: string) {
    return this.db
      .select()
      .from(clinicHolidays)
      .where(eq(clinicHolidays.clinicId, clinicId))
      .orderBy(desc(clinicHolidays.holidayDate));
  }

  findHoliday(clinicId: string, holidayId: string) {
    return this.db
      .select()
      .from(clinicHolidays)
      .where(and(eq(clinicHolidays.clinicId, clinicId), eq(clinicHolidays.id, holidayId)))
      .limit(1);
  }

  listHolidayDoctorMappings(clinicId: string) {
    return this.db
      .select({ holidayId: clinicHolidayDoctors.holidayId, doctorId: clinicHolidayDoctors.doctorId })
      .from(clinicHolidayDoctors)
      .where(eq(clinicHolidayDoctors.clinicId, clinicId));
  }

  listHolidayDoctors(clinicId: string, holidayId: string) {
    return this.db
      .select({ doctorId: clinicHolidayDoctors.doctorId })
      .from(clinicHolidayDoctors)
      .where(
        and(
          eq(clinicHolidayDoctors.clinicId, clinicId),
          eq(clinicHolidayDoctors.holidayId, holidayId),
        ),
      );
  }

  insertHoliday(values: typeof clinicHolidays.$inferInsert) {
    return this.db.insert(clinicHolidays).values(values).returning();
  }

  patchHoliday(
    clinicId: string,
    holidayId: string,
    values: Partial<typeof clinicHolidays.$inferInsert>,
  ) {
    return this.db
      .update(clinicHolidays)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(clinicHolidays.clinicId, clinicId), eq(clinicHolidays.id, holidayId)))
      .returning();
  }

  async replaceHolidayDoctors(clinicId: string, holidayId: string, doctorIds: string[]) {
    await this.db
      .delete(clinicHolidayDoctors)
      .where(
        and(
          eq(clinicHolidayDoctors.clinicId, clinicId),
          eq(clinicHolidayDoctors.holidayId, holidayId),
        ),
      );

    if (doctorIds.length === 0) {
      return [];
    }

    return this.db
      .insert(clinicHolidayDoctors)
      .values(
        doctorIds.map((doctorId) => ({
          clinicId,
          holidayId,
          doctorId,
        })),
      )
      .returning();
  }

  listDoctorSchedules(clinicId: string, doctorId?: string) {
    const filters = [eq(doctorSchedules.clinicId, clinicId)];
    if (doctorId) {
      filters.push(eq(doctorSchedules.doctorId, doctorId));
    }
    return this.db
      .select()
      .from(doctorSchedules)
      .where(and(...filters))
      .orderBy(doctorSchedules.doctorId, doctorSchedules.dayOfWeek, doctorSchedules.startTime);
  }

  async replaceDoctorSchedules(
    clinicId: string,
    doctorId: string,
    windows: Array<{
      doctorServiceId?: string | null;
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      effectiveFrom?: string | null;
      effectiveTo?: string | null;
      active: boolean;
    }>,
  ) {
    await this.db
      .update(doctorSchedules)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(doctorSchedules.clinicId, clinicId), eq(doctorSchedules.doctorId, doctorId)));

    if (windows.length === 0) {
      return [];
    }

    return this.db
      .insert(doctorSchedules)
      .values(
        windows.map((window) => ({
          clinicId,
          doctorId,
          doctorServiceId: window.doctorServiceId ?? null,
          dayOfWeek: window.dayOfWeek,
          startTime: window.startTime,
          endTime: window.endTime,
          effectiveFrom: window.effectiveFrom ?? null,
          effectiveTo: window.effectiveTo ?? null,
          active: window.active,
        })),
      )
      .returning();
  }

  listDoctorServiceMappings(clinicId: string) {
    return this.db
      .select()
      .from(doctorServices)
      .where(eq(doctorServices.clinicId, clinicId));
  }

  findDoctorServiceMappingByDoctorAndService(
    clinicId: string,
    doctorId: string,
    clinicServiceId: string,
  ) {
    return this.db
      .select()
      .from(doctorServices)
      .where(
        and(
          eq(doctorServices.clinicId, clinicId),
          eq(doctorServices.doctorId, doctorId),
          eq(doctorServices.clinicServiceId, clinicServiceId),
        ),
      )
      .limit(1);
  }

  createDoctorServiceMapping(values: typeof doctorServices.$inferInsert) {
    return this.db.insert(doctorServices).values(values).returning();
  }

  patchDoctorServiceMapping(
    clinicId: string,
    mappingId: string,
    values: Partial<typeof doctorServices.$inferInsert>,
  ) {
    return this.db
      .update(doctorServices)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(doctorServices.clinicId, clinicId), eq(doctorServices.id, mappingId)))
      .returning();
  }

  patchClinicService(
    clinicId: string,
    serviceId: string,
    values: Partial<typeof clinicServices.$inferInsert>,
  ) {
    return this.db
      .update(clinicServices)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(clinicServices.clinicId, clinicId), eq(clinicServices.id, serviceId)))
      .returning();
  }

  createClinicService(values: typeof clinicServices.$inferInsert) {
    return this.db.insert(clinicServices).values(values).returning();
  }

  listBookingRules(clinicId: string) {
    return this.db
      .select()
      .from(doctorServiceBookingRules)
      .where(eq(doctorServiceBookingRules.clinicId, clinicId));
  }

  listBookingRulesForDoctorService(clinicId: string, doctorId: string, clinicServiceId: string) {
    return this.db
      .select()
      .from(doctorServiceBookingRules)
      .where(
        and(
          eq(doctorServiceBookingRules.clinicId, clinicId),
          eq(doctorServiceBookingRules.doctorId, doctorId),
          eq(doctorServiceBookingRules.clinicServiceId, clinicServiceId),
        ),
      )
      .orderBy(desc(doctorServiceBookingRules.version));
  }

  createBookingRule(values: typeof doctorServiceBookingRules.$inferInsert) {
    return this.db.insert(doctorServiceBookingRules).values(values).returning();
  }

  patchBookingRule(
    clinicId: string,
    ruleId: string,
    values: Partial<typeof doctorServiceBookingRules.$inferInsert>,
  ) {
    return this.db
      .update(doctorServiceBookingRules)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          eq(doctorServiceBookingRules.clinicId, clinicId),
          eq(doctorServiceBookingRules.id, ruleId),
        ),
      )
      .returning();
  }

  listCalls(clinicId: string, from?: string, to?: string) {
    const filters = [eq(calls.clinicId, clinicId)];
    if (from) {
      filters.push(gte(calls.startedAt, new Date(from)));
    }
    if (to) {
      filters.push(lte(calls.startedAt, new Date(to)));
    }
    return this.db
      .select()
      .from(calls)
      .where(and(...filters))
      .orderBy(desc(calls.startedAt));
  }

  findCall(clinicId: string, callId: string) {
    return this.db
      .select()
      .from(calls)
      .where(and(eq(calls.clinicId, clinicId), eq(calls.id, callId)))
      .limit(1);
  }

  listCallbackRequests(clinicId: string, status?: string) {
    const filters = [eq(callbackRequests.clinicId, clinicId)];
    if (status) {
      filters.push(eq(callbackRequests.status, status));
    }
    return this.db
      .select()
      .from(callbackRequests)
      .where(and(...filters))
      .orderBy(desc(callbackRequests.createdAt));
  }

  listNotificationEvents(clinicId?: string, limit = 100) {
    if (clinicId) {
      return this.db
        .select()
        .from(notificationEvents)
        .where(eq(notificationEvents.clinicId, clinicId))
        .orderBy(desc(notificationEvents.createdAt))
        .limit(limit);
    }
    return this.db
      .select()
      .from(notificationEvents)
      .orderBy(desc(notificationEvents.createdAt))
      .limit(limit);
  }

  listBackgroundJobHealth() {
    return this.db
      .select({
        status: backgroundJobs.status,
        count: sql<number>`count(*)::int`,
      })
      .from(backgroundJobs)
      .groupBy(backgroundJobs.status);
  }

  listRecentBackgroundJobs(limit = 50) {
    return this.db
      .select()
      .from(backgroundJobs)
      .orderBy(desc(backgroundJobs.createdAt))
      .limit(limit);
  }

  listDoctors(clinicId: string) {
    return this.db.select().from(doctors).where(eq(doctors.clinicId, clinicId));
  }

  listServices(clinicId: string) {
    return this.db.select().from(clinicServices).where(eq(clinicServices.clinicId, clinicId));
  }

  findDoctorServiceMapping(clinicId: string, mappingId: string) {
    return this.db
      .select()
      .from(doctorServices)
      .where(and(eq(doctorServices.clinicId, clinicId), eq(doctorServices.id, mappingId)))
      .limit(1);
  }

  deleteDoctor(clinicId: string, doctorId: string) {
    return this.db
      .delete(doctors)
      .where(and(eq(doctors.clinicId, clinicId), eq(doctors.id, doctorId)))
      .returning();
  }

  deleteClinicService(clinicId: string, serviceId: string) {
    return this.db
      .delete(clinicServices)
      .where(and(eq(clinicServices.clinicId, clinicId), eq(clinicServices.id, serviceId)))
      .returning();
  }

  deleteDoctorServiceMapping(clinicId: string, mappingId: string) {
    return this.db
      .delete(doctorServices)
      .where(and(eq(doctorServices.clinicId, clinicId), eq(doctorServices.id, mappingId)))
      .returning();
  }

  deleteDoctorServiceMappingsForDoctor(clinicId: string, doctorId: string) {
    return this.db
      .delete(doctorServices)
      .where(and(eq(doctorServices.clinicId, clinicId), eq(doctorServices.doctorId, doctorId)))
      .returning();
  }

  deleteDoctorServiceMappingsForService(clinicId: string, serviceId: string) {
    return this.db
      .delete(doctorServices)
      .where(and(eq(doctorServices.clinicId, clinicId), eq(doctorServices.clinicServiceId, serviceId)))
      .returning();
  }

  deleteDoctorSchedulesForDoctor(clinicId: string, doctorId: string) {
    return this.db
      .delete(doctorSchedules)
      .where(and(eq(doctorSchedules.clinicId, clinicId), eq(doctorSchedules.doctorId, doctorId)))
      .returning();
  }

  deleteBookingRulesForDoctor(clinicId: string, doctorId: string) {
    return this.db
      .delete(doctorServiceBookingRules)
      .where(
        and(
          eq(doctorServiceBookingRules.clinicId, clinicId),
          eq(doctorServiceBookingRules.doctorId, doctorId),
        ),
      )
      .returning();
  }

  deleteBookingRulesForService(clinicId: string, serviceId: string) {
    return this.db
      .delete(doctorServiceBookingRules)
      .where(
        and(
          eq(doctorServiceBookingRules.clinicId, clinicId),
          eq(doctorServiceBookingRules.clinicServiceId, serviceId),
        ),
      )
      .returning();
  }

  deleteBookingRulesForDoctorService(
    clinicId: string,
    doctorId: string,
    clinicServiceId: string,
  ) {
    return this.db
      .delete(doctorServiceBookingRules)
      .where(
        and(
          eq(doctorServiceBookingRules.clinicId, clinicId),
          eq(doctorServiceBookingRules.doctorId, doctorId),
          eq(doctorServiceBookingRules.clinicServiceId, clinicServiceId),
        ),
      )
      .returning();
  }
}
