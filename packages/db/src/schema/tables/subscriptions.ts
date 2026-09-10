import { boolean, integer, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const subscriptionPlans = pgTable('subscription_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  planKey: text('plan_key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  billingCycle: text('billing_cycle').notNull().default('monthly'),
  currency: text('currency').notNull().default('INR'),
  basePrice: numeric('base_price', { precision: 12, scale: 2 }).notNull().default('0'),
  includedVoiceMinutes: integer('included_voice_minutes').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const clinicSubscriptions = pgTable(
  'clinic_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    subscriptionPlanId: uuid('subscription_plan_id'),
    status: text('status').notNull(),
    planSnapshotJson: jsonb('plan_snapshot_json').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicSubscriptionIdUnique: unique().on(table.clinicId, table.id),
  }),
);

export const clinicLanguages = pgTable(
  'clinic_languages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    languageCode: text('language_code').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicLanguageUnique: unique().on(table.clinicId, table.languageCode),
  }),
);
