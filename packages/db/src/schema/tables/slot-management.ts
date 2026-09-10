import { boolean, date, integer, pgTable, text, time, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const hospitals = pgTable('hospitals', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  registrationNumber: text('registration_number'),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  status: text('status').notNull().default('active'),
  timezone: text('timezone').notNull().default('UTC'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const doctorWorkingHours = pgTable(
  'doctor_working_hours',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    doctorId: uuid('doctor_id').notNull(),
    dayOfWeek: text('day_of_week').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    isAvailable: boolean('is_available').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    doctorWorkingHoursUnique: unique().on(table.doctorId, table.dayOfWeek),
  }),
);

export const doctorLeaves = pgTable('doctor_leaves', {
  id: uuid('id').primaryKey().defaultRandom(),
  doctorId: uuid('doctor_id').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  reason: text('reason'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const blockedDates = pgTable(
  'blocked_dates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hospitalId: uuid('hospital_id').notNull(),
    date: date('date').notNull(),
    reason: text('reason'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    blockedDatesUnique: unique().on(table.hospitalId, table.date),
  }),
);

export const slotGenerationLogs = pgTable('slot_generation_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  executionStartedAt: timestamp('execution_started_at', { withTimezone: true }).notNull().defaultNow(),
  executionCompletedAt: timestamp('execution_completed_at', { withTimezone: true }),
  hospitalsProcessed: integer('hospitals_processed').notNull().default(0),
  doctorsProcessed: integer('doctors_processed').notNull().default(0),
  slotsCreated: integer('slots_created').notNull().default(0),
  slotsExpired: integer('slots_expired').notNull().default(0),
  slotsBlocked: integer('slots_blocked').notNull().default(0),
  errors: text('errors'),
  status: text('status').notNull().default('completed'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
