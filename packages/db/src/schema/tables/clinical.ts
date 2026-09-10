import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const clinicServices = pgTable(
  'clinic_services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    serviceKey: text('service_key').notNull(),
    serviceName: text('service_name').notNull(),
    description: text('description'),
    handlesJson: jsonb('handles_json').notNull().default([]),
    doesNotHandleJson: jsonb('does_not_handle_json').notNull().default([]),
    redFlagsJson: jsonb('red_flags_json').notNull().default([]),
    routingExamplesJson: jsonb('routing_examples_json').notNull().default([]),
    requiresStaffConfirmation: boolean('requires_staff_confirmation').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicServiceKeyUnique: unique().on(table.clinicId, table.serviceKey),
    clinicServiceIdUnique: unique().on(table.clinicId, table.id),
  }),
);

export const doctorServices = pgTable(
  'doctor_services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    doctorId: uuid('doctor_id').notNull(),
    clinicServiceId: uuid('clinic_service_id').notNull(),
    consultationFeeAmount: numeric('consultation_fee_amount', { precision: 12, scale: 2 }),
    followupFeeAmount: numeric('followup_fee_amount', { precision: 12, scale: 2 }),
    followupValidDays: integer('followup_valid_days'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    doctorServiceUnique: unique().on(table.clinicId, table.doctorId, table.clinicServiceId),
    clinicDoctorServiceIdUnique: unique().on(table.clinicId, table.id),
  }),
);

export const doctorServiceBookingRules = pgTable(
  'doctor_service_booking_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    doctorId: uuid('doctor_id').notNull(),
    clinicServiceId: uuid('clinic_service_id').notNull(),
    slotDurationMinutes: integer('slot_duration_minutes').notNull(),
    capacityPerSlot: integer('capacity_per_slot').notNull(),
    bookingHorizonDays: integer('booking_horizon_days').notNull().default(45),
    minBookingNoticeMinutes: integer('min_booking_notice_minutes').notNull().default(0),
    maxAdvanceBookingDays: integer('max_advance_booking_days'),
    manualEditCutoffBeforeStartMinutes: integer('manual_edit_cutoff_before_start_minutes')
      .notNull()
      .default(60),
    manualEditMaxShiftMinutes: integer('manual_edit_max_shift_minutes').notNull().default(60),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    active: boolean('active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    bookingRuleVersionUnique: unique().on(
      table.clinicId,
      table.doctorId,
      table.clinicServiceId,
      table.version,
    ),
    clinicBookingRuleIdUnique: unique().on(table.clinicId, table.id),
  }),
);

export const supportedLanguages = pgTable('supported_languages', {
  languageCode: text('language_code').primaryKey(),
  displayName: text('display_name').notNull(),
  nativeName: text('native_name'),
  enabledPlatformWide: boolean('enabled_platform_wide').notNull().default(true),
  defaultTtsVoice: text('default_tts_voice'),
  defaultSttLanguageHint: text('default_stt_language_hint'),
  fallbackLanguageCode: text('fallback_language_code'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messageTemplates = pgTable(
  'message_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateKey: text('template_key').notNull(),
    languageCode: text('language_code').notNull(),
    templateText: text('template_text').notNull(),
    requiredVariablesJson: jsonb('required_variables_json').notNull().default([]),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    templateLanguageUnique: unique().on(table.templateKey, table.languageCode),
  }),
);

export const clinicKnowledgeBase = pgTable(
  'clinic_knowledge_base',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    category: text('category'),
    alternativePhrasesJson: jsonb('alternative_phrases_json').notNull().default([]),
    sourceFileId: uuid('source_file_id'),
    sourceFile: text('source_file'),
    sourcePage: integer('source_page'),
    templateKey: text('template_key'),
    sectionKey: text('section_key'),
    sourceNotes: text('source_notes'),
    serviceName: text('service_name'),
    applicable: boolean('applicable').notNull().default(true),
    qaApproved: boolean('qa_approved').notNull().default(false),
    status: text('status').notNull().default('pending_review'),
    searchText: text('search_text'),
    embeddingModel: text('embedding_model'),
    embeddingDimensions: integer('embedding_dimensions'),
    embeddingStatus: text('embedding_status').notNull().default('pending'),
    embeddingGeneratedAt: timestamp('embedding_generated_at', { withTimezone: true }),
    embeddingError: text('embedding_error'),
    embeddingSourceHash: text('embedding_source_hash'),
    lastEmbeddingJobId: uuid('last_embedding_job_id'),
    approvedByUserId: uuid('approved_by_user_id'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicKnowledgeIdUnique: unique().on(table.clinicId, table.id),
  }),
);
