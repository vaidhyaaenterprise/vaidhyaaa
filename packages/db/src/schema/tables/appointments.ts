import { boolean, date, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const appointmentSlots = pgTable(
  'appointment_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    hospitalId: uuid('hospital_id'),
    doctorId: uuid('doctor_id').notNull(),
    clinicServiceId: uuid('clinic_service_id').notNull(),
    // Clinic-local wall clock — matches doctor_schedules.start_time (e.g. 18:00:00).
    startTime: timestamp('start_time', { withTimezone: false, mode: 'string' }).notNull(),
    endTime: timestamp('end_time', { withTimezone: false, mode: 'string' }).notNull(),
    capacityTotal: integer('capacity_total').notNull(),
    status: text('status').notNull().default('open'),
    generatedFromRuleId: uuid('generated_from_rule_id'),
    generationBatchId: uuid('generation_batch_id'),
    configVersion: integer('config_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicSlotIdUnique: unique().on(table.clinicId, table.id),
  }),
);

export const slotHolds = pgTable(
  'slot_holds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    slotId: uuid('slot_id').notNull(),
    sessionId: uuid('session_id'),
    patientPhone: text('patient_phone'),
    status: text('status').notNull().default('active'),
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicHoldIdUnique: unique().on(table.clinicId, table.id),
  }),
);

export const patients = pgTable(
  'patients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name'),
    phone: text('phone'),
    normalizedPhone: text('normalized_phone'),
    ageYears: integer('age_years'),
    dateOfBirth: date('date_of_birth'),
    gender: text('gender'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicPatientIdUnique: unique().on(table.clinicId, table.id),
  }),
);

export const appointmentRequests = pgTable(
  'appointment_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    slotId: uuid('slot_id'),
    slotHoldId: uuid('slot_hold_id'),
    patientId: uuid('patient_id'),
    patientName: text('patient_name').notNull(),
    patientPhone: text('patient_phone'),
    doctorId: uuid('doctor_id').notNull(),
    clinicServiceId: uuid('clinic_service_id').notNull(),
    reasonForVisit: text('reason_for_visit').notNull(),
    normalizedReason: text('normalized_reason'),
    appointmentStart: timestamp('appointment_start', { withTimezone: false, mode: 'string' }).notNull(),
    appointmentEnd: timestamp('appointment_end', { withTimezone: false, mode: 'string' }).notNull(),
    status: text('status').notNull(),
    isFollowup: boolean('is_followup').notNull().default(false),
    followupOfVisitId: uuid('followup_of_visit_id'),
    routingSource: text('routing_source'),
    sourceSessionId: uuid('source_session_id'),
    replacesAppointmentId: uuid('replaces_appointment_id'),
    replacedByAppointmentId: uuid('replaced_by_appointment_id'),
    createdByUserId: uuid('created_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicAppointmentIdUnique: unique().on(table.clinicId, table.id),
  }),
);

export const calls = pgTable(
  'calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    sessionId: uuid('session_id'),
    patientPhone: text('patient_phone'),
    patientId: uuid('patient_id'),
    provider: text('provider'),
    providerCallId: text('provider_call_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    durationSeconds: integer('duration_seconds'),
    outcome: text('outcome'),
    summary: text('summary'),
    recordingUrl: text('recording_url'),
    recordingStorageKey: text('recording_storage_key'),
    recordingExpiresAt: timestamp('recording_expires_at', { withTimezone: true }),
    recordingDeletedAt: timestamp('recording_deleted_at', { withTimezone: true }),
    transcriptExpiresAt: timestamp('transcript_expires_at', { withTimezone: true }),
    createdAppointmentRequestId: uuid('created_appointment_request_id'),
    createdCallbackRequestId: uuid('created_callback_request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicCallIdUnique: unique().on(table.clinicId, table.id),
  }),
);
