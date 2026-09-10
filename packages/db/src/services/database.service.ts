import { and, eq, sql as drizzleSql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { AppError, type ApiErrorCode } from '@vaidya/shared';

import type { Database } from '../client';
import {
  appointmentSlots,
  auditLogs,
  clinicServices,
  clinics,
  doctorServices,
  doctors,
} from '../schema';

type ClinicScopedTable = PgTable & {
  clinicId: PgColumn;
  id: PgColumn;
};

export type AuditLogInsert = {
  clinicId?: string;
  actorUserId?: string;
  actorType: string;
  eventType: string;
  entityType?: string;
  entityId?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  eventData?: Record<string, unknown>;
  source?: string;
  requestId?: string;
};

export class DatabaseService {
  constructor(private readonly db: Database) {}

  get database(): Database {
    return this.db;
  }

  async withTransaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => fn(tx));
  }

  async getClinicScopedRecordOrThrow<T extends Record<string, unknown>>(
    table: ClinicScopedTable,
    clinicId: string,
    recordId: string,
    errorCode: ApiErrorCode = 'NOT_FOUND',
  ): Promise<T> {
    const rows = await this.db
      .select()
      .from(table)
      .where(and(eq(table.clinicId, clinicId), eq(table.id, recordId)))
      .limit(1);

    const record = rows[0];
    if (!record) {
      throw new AppError(errorCode, 'Clinic-scoped record not found.', {
        clinic_id: clinicId,
        id: recordId,
      });
    }

    return record as T;
  }

  async assertDoctorBelongsToClinic(clinicId: string, doctorId: string): Promise<void> {
    const [doctor] = await this.db
      .select({ id: doctors.id })
      .from(doctors)
      .where(and(eq(doctors.clinicId, clinicId), eq(doctors.id, doctorId)))
      .limit(1);

    if (!doctor) {
      throw new AppError('CLINIC_NOT_FOUND', 'Doctor does not belong to clinic.', {
        clinic_id: clinicId,
        doctor_id: doctorId,
      });
    }
  }

  async assertServiceBelongsToClinic(clinicId: string, serviceId: string): Promise<void> {
    const [service] = await this.db
      .select({ id: clinicServices.id })
      .from(clinicServices)
      .where(and(eq(clinicServices.clinicId, clinicId), eq(clinicServices.id, serviceId)))
      .limit(1);

    if (!service) {
      throw new AppError('CLINIC_NOT_FOUND', 'Service does not belong to clinic.', {
        clinic_id: clinicId,
        clinic_service_id: serviceId,
      });
    }
  }

  async assertDoctorHandlesService(
    clinicId: string,
    doctorId: string,
    serviceId: string,
  ): Promise<void> {
    await this.assertDoctorBelongsToClinic(clinicId, doctorId);
    await this.assertServiceBelongsToClinic(clinicId, serviceId);

    const [mapping] = await this.db
      .select({ id: doctorServices.id })
      .from(doctorServices)
      .where(
        and(
          eq(doctorServices.clinicId, clinicId),
          eq(doctorServices.doctorId, doctorId),
          eq(doctorServices.clinicServiceId, serviceId),
          eq(doctorServices.active, true),
        ),
      )
      .limit(1);

    if (!mapping) {
      throw new AppError('DOCTOR_NOT_OWNER', 'Doctor does not handle this service.', {
        clinic_id: clinicId,
        doctor_id: doctorId,
        clinic_service_id: serviceId,
      });
    }
  }

  async withSlotForUpdate<T>(
    clinicId: string,
    slotId: string,
    fn: (slot: typeof appointmentSlots.$inferSelect, tx: Database) => Promise<T>,
  ): Promise<T> {
    return this.withTransaction(async (tx) => {
      const rows = await tx
        .select()
        .from(appointmentSlots)
        .where(and(eq(appointmentSlots.clinicId, clinicId), eq(appointmentSlots.id, slotId)))
        .for('update')
        .limit(1);

      const slot = rows[0];
      if (!slot) {
        throw new AppError('SLOT_NOT_AVAILABLE', 'Slot not found for update.', {
          clinic_id: clinicId,
          slot_id: slotId,
        });
      }

      return fn(slot, tx);
    });
  }

  async insertAuditLog(input: AuditLogInsert): Promise<void> {
    await this.db.insert(auditLogs).values({
      actorType: input.actorType,
      eventType: input.eventType,
      eventDataJson: input.eventData ?? {},
      ...(input.clinicId !== undefined ? { clinicId: input.clinicId } : {}),
      ...(input.actorUserId !== undefined ? { actorUserId: input.actorUserId } : {}),
      ...(input.entityType !== undefined ? { entityType: input.entityType } : {}),
      ...(input.entityId !== undefined ? { entityId: input.entityId } : {}),
      ...(input.oldValues !== undefined ? { oldValuesJson: input.oldValues } : {}),
      ...(input.newValues !== undefined ? { newValuesJson: input.newValues } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    });
  }

  async findClinicById(clinicId: string) {
    const [clinic] = await this.db
      .select()
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);

    if (!clinic) {
      throw new AppError('CLINIC_NOT_FOUND', 'Clinic not found.', { clinic_id: clinicId });
    }

    return clinic;
  }

  /** Ensures no table stores binary audio — recordings use object storage keys/URLs only. */
  async assertNoBinaryAudioColumns(): Promise<{ tableName: string; columnName: string }[]> {
    const rows = await this.db.execute<{ table_name: string; column_name: string }>(drizzleSql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND udt_name = 'bytea'
        AND table_name IN ('calls', 'call_transcripts', 'knowledge_files', 'clinic_knowledge_base')
    `);

    return [...rows].map((row) => ({
      tableName: row.table_name,
      columnName: row.column_name,
    }));
  }
}
