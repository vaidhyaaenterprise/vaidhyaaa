/** BullMQ queue names — kebab-case identifiers. */
export const QUEUE_NAMES = {
  NOTIFICATIONS: 'notifications',
  SLOT_HOLDS: 'slot-holds',
  SLOT_GENERATION: 'slot-generation',
  RECORDINGS_CLEANUP: 'recordings-cleanup',
  TRANSCRIPTS_CLEANUP: 'transcripts-cleanup',
  KNOWLEDGE_PROCESSING: 'knowledge-processing',
  EMBEDDINGS: 'embeddings',
  DAILY_REPORTS: 'daily-reports',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const ALL_QUEUE_NAMES: readonly QueueName[] = Object.values(QUEUE_NAMES);

/** Aliases used in some docs/test packs. */
export const QUEUE_NAME_ALIASES: Record<string, QueueName> = {
  'recording-cleanup': QUEUE_NAMES.RECORDINGS_CLEANUP,
  'transcript-cleanup': QUEUE_NAMES.TRANSCRIPTS_CLEANUP,
};
