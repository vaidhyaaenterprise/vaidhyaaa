import { jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const conversationSessions = pgTable(
  'conversation_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    channel: text('channel').notNull(),
    patientPhone: text('patient_phone'),
    patientId: uuid('patient_id'),
    languageCode: text('language_code').notNull().default('ta_tanglish'),
    languageSource: text('language_source'),
    currentFlow: text('current_flow').notNull().default('none'),
    currentState: text('current_state').notNull().default('IDLE'),
    collectedJson: jsonb('collected_json').notNull().default({}),
    status: text('status').notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicSessionIdUnique: unique().on(table.clinicId, table.id),
  }),
);

export const conversationMessages = pgTable('conversation_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  clinicId: uuid('clinic_id').notNull(),
  sessionId: uuid('session_id').notNull(),
  sender: text('sender').notNull(),
  messageText: text('message_text').notNull(),
  intent: text('intent'),
  replyTemplateKey: text('reply_template_key'),
  flowBefore: text('flow_before'),
  stateBefore: text('state_before'),
  flowAfter: text('flow_after'),
  stateAfter: text('state_after'),
  debugJson: jsonb('debug_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messageIdempotencyKeys = pgTable(
  'message_idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clinicId: uuid('clinic_id').notNull(),
    sessionId: uuid('session_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash'),
    responseJson: jsonb('response_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clinicIdempotencyUnique: unique().on(table.clinicId, table.idempotencyKey),
  }),
);
