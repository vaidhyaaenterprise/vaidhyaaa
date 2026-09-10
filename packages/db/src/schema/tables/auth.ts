import { boolean, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const otpChallenges = pgTable('otp_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  identifier: text('identifier').notNull(),
  otpHash: text('otp_hash').notNull(),
  purpose: text('purpose').notNull().default('login'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  attemptCount: integer('attempt_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  authProviderId: text('auth_provider_id'),
  name: text('name'),
  email: text('email'),
  phone: text('phone'),
  username: text('username'),
  passwordHash: text('password_hash'),
  passwordSalt: text('password_salt'),
  platformRole: text('platform_role'),
  active: boolean('active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const clinicUsers = pgTable(
  'clinic_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull(),
    doctorId: uuid('doctor_id'),
    active: boolean('active').notNull().default(true),
    invitedByUserId: uuid('invited_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicUserUnique: unique().on(table.clinicId, table.userId),
    clinicIdUnique: unique().on(table.clinicId, table.id),
  }),
);

export const doctors = pgTable(
  'doctors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    userId: uuid('user_id'),
    name: text('name').notNull(),
    qualification: text('qualification'),
    registrationNumber: text('registration_number'),
    appointmentDuration: integer('appointment_duration').notNull().default(30),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicDoctorUnique: unique().on(table.clinicId, table.id),
  }),
);
