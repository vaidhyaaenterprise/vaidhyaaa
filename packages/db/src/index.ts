export {
  closeDatabaseConnection,
  createDatabase,
  createDatabaseConnection,
  type Database,
  type DatabaseClient,
  type DatabaseConnection,
} from './client';

export {
  getAppliedMigrations,
  getMigrationsDir,
  getSeedFilePath,
  listMigrationFiles,
  resetDatabase,
  runMigrations,
  runSeed,
  type MigrationRecord,
} from './migration/runner';

export { schema, SCHEMA_BASELINE, type VaidyaSchema } from './schema';
export * from './schema';

export { DatabaseService, type AuditLogInsert } from './services/database.service';
export {
  ACTIVE_APPOINTMENT_STATUSES,
  ACTIVE_HOLD_STATUS,
  DEFAULT_HOLD_TTL_MS,
  addDays,
  addMinutes,
  combineDateAndTime,
  computeAvailableCount,
  dayOfWeekMon1,
  formatClinicLocalTimestamp,
  formatDateInTimezone,
  formatTimeInTimezone,
  hasCapacityAvailable,
  hasCapacityToConvertHold,
  intervalsOverlap,
  normalizeTimeString,
  type ClinicLocalTimestamp,
} from './services/slot-capacity';
export {
  AuthRepository,
  ClinicsRepository,
  ClinicalRepository,
  ConversationMessageRepository,
  ConversationSessionRepository,
  DoctorsRepository,
  PatientsRepository,
  SlotsRepository,
  MessageIdempotencyRepository,
  PlatformRepository,
  UsersRepository,
  AppointmentLifecycleRepository,
  NotificationRepository,
  PlatformOpsRepository,
  KnowledgeRepository,
  NluReviewRepository,
  OtpRepository,
  type OtpPurpose,
  ReviewedExamplesRepository,
  computeEmbeddingSourceHash,
  createRepositories,
  type ConversationMessageRow,
  type ConversationSessionRow,
  type MessageIdempotencyRow,
  type NotificationEventRow,
  type KnowledgeEntryRow,
  type KnowledgeEmbeddingStatusSummary,
  type Repositories,
} from './repositories';

export { assertResetAllowed, resolveDatabaseUrl } from './cli/env';

export { and, eq, gt, sql } from 'drizzle-orm';
