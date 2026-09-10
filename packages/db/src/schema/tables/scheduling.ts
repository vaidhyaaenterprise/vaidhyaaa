import { boolean, date, integer, jsonb, pgTable, text, time, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const clinicHours = pgTable(
  'clinic_hours',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    dayOfWeek: integer('day_of_week').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicHoursIdUnique: unique().on(table.clinicId, table.id),
  }),
);

export const clinicHolidays = pgTable(
  'clinic_holidays',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    holidayDate: date('holiday_date').notNull(),
    isFullDay: boolean('is_full_day').notNull().default(true),
    startTime: time('start_time'),
    endTime: time('end_time'),
    reason: text('reason'),
    active: boolean('active').notNull().default(true),
    createdByUserId: uuid('created_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicHolidayIdUnique: unique().on(table.clinicId, table.id),
  }),
);

export const clinicHolidayDoctors = pgTable(
  'clinic_holiday_doctors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    holidayId: uuid('holiday_id').notNull(),
    doctorId: uuid('doctor_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicHolidayDoctorUnique: unique().on(table.clinicId, table.holidayId, table.doctorId),
    clinicHolidayDoctorIdUnique: unique().on(table.clinicId, table.id),
  }),
);

export const doctorSchedules = pgTable(
  'doctor_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    doctorId: uuid('doctor_id').notNull(),
    doctorServiceId: uuid('doctor_service_id'),
    dayOfWeek: integer('day_of_week').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    effectiveFrom: date('effective_from'),
    effectiveTo: date('effective_to'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicScheduleIdUnique: unique().on(table.clinicId, table.id),
  }),
);

export const doctorBlockedSlots = pgTable(
  'doctor_blocked_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    doctorId: uuid('doctor_id').notNull(),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }).notNull(),
    reason: text('reason'),
    active: boolean('active').notNull().default(true),
    createdByUserId: uuid('created_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicBlockedSlotIdUnique: unique().on(table.clinicId, table.id),
  }),
);

export const languagePacks = pgTable('language_packs', {
  languageCode: text('language_code').primaryKey(),
  yesWordsJson: jsonb('yes_words_json').notNull().default([]),
  noWordsJson: jsonb('no_words_json').notNull().default([]),
  todayWordsJson: jsonb('today_words_json').notNull().default([]),
  tomorrowWordsJson: jsonb('tomorrow_words_json').notNull().default([]),
  cancelWordsJson: jsonb('cancel_words_json').notNull().default([]),
  laterWordsJson: jsonb('later_words_json').notNull().default([]),
  timePreferenceWordsJson: jsonb('time_preference_words_json').notNull().default({}),
  classifierExamplesJson: jsonb('classifier_examples_json').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
