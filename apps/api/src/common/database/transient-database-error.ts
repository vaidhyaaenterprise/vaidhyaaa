const TRANSIENT_POSTGRES_CODES = new Set([
  // PostgreSQL connection exception class.
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  // PostgreSQL resource/startup failures.
  '53300',
  '57P01',
  '57P02',
  '57P03',
  // postgres.js connection errors.
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_DESTROYED',
  // Supavisor pool exhaustion errors.
  'EMAXCONN',
  'EMAXCONNSESSION',
]);

const TRANSIENT_SOCKET_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT']);

const TRANSIENT_DATABASE_MESSAGES = [
  /\bEMAXCONN(?:SESSION)?\b/i,
  /max clients reached(?: in (?:session|transaction) mode)?/i,
  /remaining connection slots are reserved/i,
  /database system is (?:starting up|shutting down|in recovery mode)/i,
  /terminating connection due to administrator command/i,
  /server closed the connection unexpectedly/i,
];

type ErrorRecord = {
  cause?: unknown;
  code?: unknown;
  message?: unknown;
  query?: unknown;
};

function toErrorRecord(value: unknown): ErrorRecord | null {
  return typeof value === 'object' && value !== null ? (value as ErrorRecord) : null;
}

/**
 * Identifies only connection/pool failures that are safe to advertise as
 * temporary. Authentication, schema and SQL errors intentionally remain 500s.
 */
export function isTransientDatabaseError(error: unknown): boolean {
  const visited = new Set<object>();
  let current: unknown = error;
  let inheritedSqlContext = false;

  while (current !== undefined && current !== null) {
    const record = toErrorRecord(current);
    if (!record || visited.has(record)) {
      return false;
    }
    visited.add(record);

    const hasSqlContext: boolean = inheritedSqlContext || typeof record.query === 'string';
    const code = typeof record.code === 'string' ? record.code.toUpperCase() : '';
    const message = typeof record.message === 'string' ? record.message : '';

    if (TRANSIENT_POSTGRES_CODES.has(code)) {
      return true;
    }

    // Socket errors are shared by many integrations. Treat them as database
    // failures only when postgres.js attached the SQL query context.
    if (hasSqlContext && TRANSIENT_SOCKET_CODES.has(code)) {
      return true;
    }

    if (TRANSIENT_DATABASE_MESSAGES.some((pattern) => pattern.test(message))) {
      return true;
    }

    inheritedSqlContext = hasSqlContext;
    current = record.cause;
  }

  return false;
}
