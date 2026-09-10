import { and, eq } from 'drizzle-orm';

import type { Database } from '../client';
import {
  callTranscripts,
  calls,
  clinicHolidays,
  clinicHours,
  clinicTelephonySettings,
  clinics,
} from '../schema';

export type CallRow = typeof calls.$inferSelect;

export class VoiceRepository {
  constructor(private readonly db: Database) {}

  findTelephonyByProviderNumber(provider: string, providerNumber: string) {
    return this.db
      .select()
      .from(clinicTelephonySettings)
      .where(
        and(
          eq(clinicTelephonySettings.provider, provider),
          eq(clinicTelephonySettings.providerNumber, providerNumber),
          eq(clinicTelephonySettings.active, true),
        ),
      )
      .limit(1);
  }

  findCallById(clinicId: string, callId: string) {
    return this.db
      .select()
      .from(calls)
      .where(and(eq(calls.clinicId, clinicId), eq(calls.id, callId)))
      .limit(1);
  }

  findCallByIdGlobal(callId: string) {
    return this.db.select().from(calls).where(eq(calls.id, callId)).limit(1);
  }

  findCallByProviderCallId(clinicId: string, provider: string, providerCallId: string) {
    return this.db
      .select()
      .from(calls)
      .where(
        and(
          eq(calls.clinicId, clinicId),
          eq(calls.provider, provider),
          eq(calls.providerCallId, providerCallId),
        ),
      )
      .limit(1);
  }

  findCallBySessionId(clinicId: string, sessionId: string) {
    return this.db
      .select()
      .from(calls)
      .where(and(eq(calls.clinicId, clinicId), eq(calls.sessionId, sessionId)))
      .limit(1);
  }

  createCall(values: typeof calls.$inferInsert) {
    return this.db.insert(calls).values(values).returning();
  }

  updateCall(clinicId: string, callId: string, values: Partial<typeof calls.$inferInsert>) {
    return this.db
      .update(calls)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(calls.clinicId, clinicId), eq(calls.id, callId)))
      .returning();
  }

  insertCallTranscript(values: typeof callTranscripts.$inferInsert) {
    return this.db.insert(callTranscripts).values(values).returning();
  }

  listClinicHours(clinicId: string) {
    return this.db
      .select()
      .from(clinicHours)
      .where(and(eq(clinicHours.clinicId, clinicId), eq(clinicHours.active, true)));
  }

  findHolidayOnDate(clinicId: string, date: string) {
    return this.db
      .select()
      .from(clinicHolidays)
      .where(
        and(
          eq(clinicHolidays.clinicId, clinicId),
          eq(clinicHolidays.holidayDate, date),
          eq(clinicHolidays.active, true),
        ),
      )
      .limit(1);
  }

  getClinicTimezone(clinicId: string) {
    return this.db
      .select({ timezone: clinics.timezone })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);
  }
}
