import { and, desc, eq, inArray } from 'drizzle-orm';

import type { Database } from '../client';
import { appointmentRequests, calls, conversationSessions, patientVisits, patients } from '../schema';

function normalizeName(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

export class PatientsRepository {
  constructor(private readonly db: Database) {}

  findByPhone(clinicId: string, normalizedPhone: string) {
    return this.db
      .select()
      .from(patients)
      .where(and(eq(patients.clinicId, clinicId), eq(patients.normalizedPhone, normalizedPhone)))
      .orderBy(desc(patients.updatedAt));
  }

  findById(clinicId: string, patientId: string) {
    return this.db
      .select()
      .from(patients)
      .where(and(eq(patients.clinicId, clinicId), eq(patients.id, patientId)))
      .limit(1);
  }

  insertPatient(values: typeof patients.$inferInsert) {
    return this.db.insert(patients).values(values).returning();
  }

  updatePatient(
    clinicId: string,
    patientId: string,
    values: Partial<typeof patients.$inferInsert>,
  ) {
    return this.db
      .update(patients)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(patients.clinicId, clinicId), eq(patients.id, patientId)))
      .returning();
  }

  async reassignPatientReferences(clinicId: string, fromPatientId: string, toPatientId: string) {
    if (fromPatientId === toPatientId) {
      return;
    }

    await this.db
      .update(appointmentRequests)
      .set({ patientId: toPatientId })
      .where(
        and(
          eq(appointmentRequests.clinicId, clinicId),
          eq(appointmentRequests.patientId, fromPatientId),
        ),
      );

    await this.db
      .update(patientVisits)
      .set({ patientId: toPatientId })
      .where(and(eq(patientVisits.clinicId, clinicId), eq(patientVisits.patientId, fromPatientId)));

    await this.db
      .update(conversationSessions)
      .set({ patientId: toPatientId })
      .where(
        and(
          eq(conversationSessions.clinicId, clinicId),
          eq(conversationSessions.patientId, fromPatientId),
        ),
      );

    await this.db
      .update(calls)
      .set({ patientId: toPatientId })
      .where(and(eq(calls.clinicId, clinicId), eq(calls.patientId, fromPatientId)));
  }

  deletePatient(clinicId: string, patientId: string) {
    return this.db
      .delete(patients)
      .where(and(eq(patients.clinicId, clinicId), eq(patients.id, patientId)))
      .returning();
  }

  async upsertByPhone(input: {
    clinicId: string;
    name: string;
    phone: string;
    normalizedPhone: string;
    normalizedName?: string;
    ageYears?: number | null;
    dateOfBirth?: string | null;
  }) {
    const normalizedName = input.normalizedName ?? normalizeName(input.name);
    const candidates = await this.findByPhone(input.clinicId, input.normalizedPhone);

    const existing = normalizedName
      ? candidates.find((row) => {
          const currentName = row.normalizedName ?? normalizeName(row.name);
          return currentName === normalizedName;
        })
      : candidates[0];

    if (existing) {
      const [updated] = await this.db
        .update(patients)
        .set({
          name: input.name,
          normalizedName,
          phone: input.phone,
          ...(input.ageYears !== undefined ? { ageYears: input.ageYears } : {}),
          ...(input.dateOfBirth !== undefined ? { dateOfBirth: input.dateOfBirth } : {}),
          updatedAt: new Date(),
        })
        .where(eq(patients.id, existing.id))
        .returning();
      return updated ? [updated] : [];
    }

    return this.db
      .insert(patients)
      .values({
        clinicId: input.clinicId,
        name: input.name,
        normalizedName,
        phone: input.phone,
        normalizedPhone: input.normalizedPhone,
        ...(input.ageYears !== undefined ? { ageYears: input.ageYears } : {}),
        ...(input.dateOfBirth !== undefined ? { dateOfBirth: input.dateOfBirth } : {}),
      })
      .returning();
  }

  insertVisit(values: typeof patientVisits.$inferInsert) {
    return this.db.insert(patientVisits).values(values).returning();
  }

  listVisitsByAppointmentIds(clinicId: string, appointmentIds: string[]) {
    if (appointmentIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .select({
        appointmentRequestId: patientVisits.appointmentRequestId,
        reasonForVisit: patientVisits.reasonForVisit,
        examinationNotes: patientVisits.examinationNotes,
        diagnosis: patientVisits.diagnosis,
        advice: patientVisits.advice,
        visitedAt: patientVisits.visitedAt,
      })
      .from(patientVisits)
      .where(
        and(
          eq(patientVisits.clinicId, clinicId),
          inArray(patientVisits.appointmentRequestId, appointmentIds),
        ),
      )
      .orderBy(desc(patientVisits.visitedAt));
  }

  listRecentVisits(clinicId: string, patientId: string, limit = 5) {
    return this.db
      .select()
      .from(patientVisits)
      .where(and(eq(patientVisits.clinicId, clinicId), eq(patientVisits.patientId, patientId)))
      .orderBy(desc(patientVisits.visitedAt))
      .limit(limit);
  }

  findVisitById(clinicId: string, visitId: string) {
    return this.db
      .select()
      .from(patientVisits)
      .where(and(eq(patientVisits.clinicId, clinicId), eq(patientVisits.id, visitId)))
      .limit(1);
  }
}
