import { date, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const appointmentActionRequests = pgTable(
  'appointment_action_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    appointmentId: uuid('appointment_id').notNull(),
    requestType: text('request_type').notNull(),
    requestedBy: text('requested_by').notNull(),
    status: text('status').notNull().default('pending'),
    requestedNewSlotId: uuid('requested_new_slot_id'),
    requestedNewDate: date('requested_new_date'),
    requestedNewTimePreference: text('requested_new_time_preference'),
    reason: text('reason'),
    sourceCallId: uuid('source_call_id'),
    sourceSessionId: uuid('source_session_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicActionRequestIdUnique: unique().on(table.clinicId, table.id),
  }),
);

export const appointmentEvents = pgTable('appointment_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicId: uuid('clinic_id').notNull(),
  appointmentRequestId: uuid('appointment_request_id').notNull(),
  eventType: text('event_type').notNull(),
  oldValuesJson: jsonb('old_values_json'),
  newValuesJson: jsonb('new_values_json'),
  actorType: text('actor_type').notNull(),
  actorUserId: uuid('actor_user_id'),
  sourceSessionId: uuid('source_session_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const patientVisits = pgTable(
  'patient_visits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    appointmentRequestId: uuid('appointment_request_id'),
    doctorId: uuid('doctor_id').notNull(),
    clinicServiceId: uuid('clinic_service_id').notNull(),
    reasonForVisit: text('reason_for_visit').notNull(),
    examinationNotes: text('examination_notes'),
    diagnosis: text('diagnosis'),
    advice: text('advice'),
    normalizedReason: text('normalized_reason'),
    visitedAt: timestamp('visited_at', { withTimezone: true }).notNull(),
    followupValidUntil: timestamp('followup_valid_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicVisitIdUnique: unique().on(table.clinicId, table.id),
  }),
);

export const generatedSlotBatches = pgTable(
  'generated_slot_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    triggerSource: text('trigger_source').notNull(),
    ruleId: uuid('rule_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    status: text('status').notNull().default('running'),
    summaryJson: jsonb('summary_json').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicBatchIdUnique: unique().on(table.clinicId, table.id),
  }),
);
