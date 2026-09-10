import { boolean, date, integer, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const knowledgeFiles = pgTable(
  'knowledge_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    fileName: text('file_name').notNull(),
    fileType: text('file_type').notNull(),
    storageKey: text('storage_key'),
    status: text('status').notNull().default('uploaded'),
    uploadedByUserId: uuid('uploaded_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicKnowledgeFileIdUnique: unique().on(table.clinicId, table.id),
  }),
);

/** Equivalent to knowledge_answer_versions — versioned translations per knowledge entry. */
export const clinicKnowledgeTranslations = pgTable(
  'clinic_knowledge_translations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    knowledgeId: uuid('knowledge_id').notNull(),
    languageCode: text('language_code').notNull(),
    translatedQuestion: text('translated_question'),
    translatedAnswer: text('translated_answer').notNull(),
    status: text('status').notNull().default('pending_review'),
    approvedByUserId: uuid('approved_by_user_id'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicKnowledgeTranslationUnique: unique().on(table.clinicId, table.knowledgeId, table.languageCode),
  }),
);

export const callTranscripts = pgTable('call_transcripts', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicId: uuid('clinic_id').notNull(),
  callId: uuid('call_id').notNull(),
  speaker: text('speaker').notNull(),
  transcriptText: text('transcript_text').notNull(),
  startedAtMs: integer('started_at_ms'),
  endedAtMs: integer('ended_at_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const callbackRequests = pgTable(
  'callback_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    patientName: text('patient_name'),
    patientPhone: text('patient_phone'),
    reason: text('reason'),
    status: text('status').notNull().default('pending'),
    sourceSessionId: uuid('source_session_id'),
    sourceCallId: uuid('source_call_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicCallbackIdUnique: unique().on(table.clinicId, table.id),
  }),
);

export const emergencyIncidents = pgTable(
  'emergency_incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    patientPhone: text('patient_phone'),
    patientName: text('patient_name'),
    messageText: text('message_text'),
    detectedReason: text('detected_reason'),
    sourceSessionId: uuid('source_session_id'),
    sourceCallId: uuid('source_call_id'),
    status: text('status').notNull().default('alert_created'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicEmergencyIdUnique: unique().on(table.clinicId, table.id),
  }),
);

export const subscriptionEvents = pgTable('subscription_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicId: uuid('clinic_id').notNull(),
  clinicSubscriptionId: uuid('clinic_subscription_id'),
  eventType: text('event_type').notNull(),
  oldPlanId: uuid('old_plan_id'),
  newPlanId: uuid('new_plan_id'),
  eventDataJson: jsonb('event_data_json').notNull().default({}),
  createdByUserId: uuid('created_by_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const clinicUsageMonthly = pgTable(
  'clinic_usage_monthly',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    billingMonth: date('billing_month').notNull(),
    voiceCallCount: integer('voice_call_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicUsageMonthUnique: unique().on(table.clinicId, table.billingMonth),
  }),
);

export const nluReviewItems = pgTable(
  'nlu_review_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    messageId: uuid('message_id').notNull(),
    messageTextRedacted: text('message_text_redacted').notNull(),
    currentFlow: text('current_flow').notNull(),
    currentState: text('current_state').notNull(),
    failureType: text('failure_type').notNull(),
    captureReason: text('capture_reason').notNull(),
    predictedIntent: text('predicted_intent'),
    predictedConfidence: numeric('predicted_confidence', { precision: 6, scale: 4 }),
    predictedEntitiesJson: jsonb('predicted_entities_json').notNull().default({}),
    correctIntent: text('correct_intent'),
    correctEntitiesJson: jsonb('correct_entities_json'),
    reviewStatus: text('review_status').notNull().default('pending'),
    reviewedByUserId: uuid('reviewed_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (table) => ({
    clinicMessageUnique: unique().on(table.clinicId, table.messageId),
  }),
);

export const reviewedExamples = pgTable('reviewed_examples', {
  id: uuid('id').primaryKey().defaultRandom(),
  languageCode: text('language_code').notNull(),
  messageTextRedacted: text('message_text_redacted').notNull(),
  contextFlow: text('context_flow').notNull(),
  contextState: text('context_state').notNull(),
  expectedRecognizedAs: text('expected_recognized_as').notNull(),
  expectedIntent: text('expected_intent'),
  expectedEntitiesJson: jsonb('expected_entities_json').notNull().default({}),
  source: text('source').notNull().default('manual_review'),
  approvedForPromptExamples: boolean('approved_for_prompt_examples').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
