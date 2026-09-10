import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const clinics = pgTable('clinics', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  uniqueNumber: integer('unique_number').notNull(),
  primaryPhone: text('primary_phone'),
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: text('city'),
  state: text('state'),
  postalCode: text('postal_code'),
  country: text('country').default('India'),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  defaultLanguageCode: text('default_language_code').notNull().default('ta_tanglish'),
  active: boolean('active').notNull().default(true),
  onboardingStatus: text('onboarding_status').notNull().default('setup_pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const clinicSettings = pgTable('clinic_settings', {
  clinicId: uuid('clinic_id').primaryKey(),
  agentEnabled: boolean('agent_enabled').notNull().default(false),
  answeringMode: text('answering_mode').notNull().default('off'),
  fallbackPhone: text('fallback_phone'),
  overflowAfterRings: integer('overflow_after_rings'),
  bookingMode: text('booking_mode').notNull().default('pending_confirmation'),
  maxConcurrentCalls: integer('max_concurrent_calls').notNull().default(1),
  recordingRetentionDays: integer('recording_retention_days').notNull().default(10),
  transcriptRetentionDays: integer('transcript_retention_days').notNull().default(30),
  notifyStaffOnPendingAppointment: boolean('notify_staff_on_pending_appointment')
    .notNull()
    .default(true),
  pendingAppointmentNotificationChannel: text('pending_appointment_notification_channel'),
  allowDoctorServiceEdit: boolean('allow_doctor_service_edit').notNull().default(false),
  allowPatientAutoCancel: boolean('allow_patient_auto_cancel').notNull().default(false),
  updatedByUserId: uuid('updated_by_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const clinicOnboardingChecklist = pgTable('clinic_onboarding_checklist', {
  clinicId: uuid('clinic_id').primaryKey(),
  clinicDetailsDone: boolean('clinic_details_done').notNull().default(false),
  adminUserDone: boolean('admin_user_done').notNull().default(false),
  clinicHoursDone: boolean('clinic_hours_done').notNull().default(false),
  doctorsDone: boolean('doctors_done').notNull().default(false),
  servicesDone: boolean('services_done').notNull().default(false),
  doctorServiceMappingDone: boolean('doctor_service_mapping_done').notNull().default(false),
  doctorSchedulesDone: boolean('doctor_schedules_done').notNull().default(false),
  bookingRulesDone: boolean('booking_rules_done').notNull().default(false),
  knowledgeBaseDone: boolean('knowledge_base_done').notNull().default(false),
  notificationSetupDone: boolean('notification_setup_done').notNull().default(false),
  telephonySetupDone: boolean('telephony_setup_done').notNull().default(false),
  testConversationDone: boolean('test_conversation_done').notNull().default(false),
  readyForAgent: boolean('ready_for_agent').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const clinicTelephonySettings = pgTable(
  'clinic_telephony_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id'),
    providerNumber: text('provider_number'),
    fallbackPhone: text('fallback_phone'),
    incomingWebhookSecret: text('incoming_webhook_secret'),
    recordingEnabled: boolean('recording_enabled').notNull().default(true),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicProviderNumberUnique: unique().on(table.clinicId, table.provider, table.providerNumber),
    clinicIdUnique: unique().on(table.clinicId, table.id),
  }),
);
