/**
 * FilmBuff Database Error Taxonomy
 *
 * Typed error classes for all SQLite / database error scenarios encountered by
 * the repository layer. Command handlers catch these types and surface
 * human-readable messages; they never catch raw `better-sqlite3` errors.
 *
 * Also exports `redactSessionFlags()` — used by SessionRepository before
 * writing CLI flags to the `sessions.flags` column so API keys and other
 * secrets are never stored in plaintext.
 *
 * Satisfies: bd-db-a10 buff-core.01.03.01 - Implement error taxonomy and
 *            redaction utility
 */

import { REDACTED } from '../utils/redaction.js';

// =============================================================================
// Base error
// =============================================================================

/** Context attached to every FilmBuff database error for diagnostics. */
export interface DatabaseErrorContext {
  /** Raw SQLite error code (e.g. 'SQLITE_BUSY') */
  sqliteCode?: string;
  /** Table or entity involved in the failing operation */
  table?: string;
  /** Additional free-form context */
  [key: string]: unknown;
}

/**
 * Base class for all database errors thrown by the FilmBuff repository layer.
 * Extends `Error` so it integrates with standard try/catch and `instanceof`.
 */
export class FilmBuffDatabaseError extends Error {
  /** Stable machine-readable code for programmatic handling. */
  readonly code: string;
  /** Optional structured context for diagnostics. */
  readonly context?: DatabaseErrorContext;

  constructor(code: string, message: string, context?: DatabaseErrorContext) {
    super(message);
    this.name = 'FilmBuffDatabaseError';
    this.code = code;
    this.context = context;
    // Restore prototype chain (required for extending Error in TypeScript)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// =============================================================================
// Concrete error subclasses
// =============================================================================

/**
 * Thrown when a project slug violates the UNIQUE constraint on `projects.slug`.
 * SQLite source: SQLITE_CONSTRAINT_UNIQUE
 */
export class DuplicateSlugError extends FilmBuffDatabaseError {
  constructor(slug: string, context?: DatabaseErrorContext) {
    super(
      'DUPLICATE_SLUG',
      `A project with slug "${slug}" already exists. Choose a different project name.`,
      { ...context, slug }
    );
    this.name = 'DuplicateSlugError';
  }
}

/**
 * Thrown when another process holds the SQLite write lock and the busy timeout
 * (5 000 ms) expires before the lock is released.
 * SQLite source: SQLITE_BUSY
 */
export class DatabaseBusyError extends FilmBuffDatabaseError {
  constructor(context?: DatabaseErrorContext) {
    super(
      'DATABASE_BUSY',
      'Another filmbuff process is running. Wait for it to finish and retry.',
      context
    );
    this.name = 'DatabaseBusyError';
  }
}

/**
 * Thrown when the SQLite WAL or main database file is detected as corrupt.
 * SQLite source: SQLITE_CORRUPT
 */
export class DatabaseCorruptError extends FilmBuffDatabaseError {
  constructor(dbPath?: string, context?: DatabaseErrorContext) {
    super(
      'DATABASE_CORRUPT',
      `The FilmBuff database${dbPath ? ` at "${dbPath}"` : ''} appears to be corrupt. ` +
        'Restore from a backup or delete the database file to start fresh.',
      { ...context, dbPath }
    );
    this.name = 'DatabaseCorruptError';
  }
}

/**
 * Thrown when the database file is on a read-only filesystem.
 * SQLite source: SQLITE_READONLY
 */
export class DatabaseReadonlyError extends FilmBuffDatabaseError {
  constructor(dbPath?: string, context?: DatabaseErrorContext) {
    super(
      'DATABASE_READONLY',
      `The FilmBuff database${dbPath ? ` at "${dbPath}"` : ''} is on a read-only filesystem. ` +
        'Check file permissions or move the project to a writable location.',
      { ...context, dbPath }
    );
    this.name = 'DatabaseReadonlyError';
  }
}

/**
 * Thrown when the migration runner detects that the checksum of a previously
 * applied migration no longer matches the SQL file on disk — indicating the
 * migration was tampered with after it was applied.
 */
export class MigrationTamperedError extends FilmBuffDatabaseError {
  constructor(version: string, storedChecksum: string, actualChecksum: string) {
    super(
      'MIGRATION_TAMPERED',
      `Migration "${version}" has been modified after it was applied. ` +
        `Stored checksum: ${storedChecksum}. Current checksum: ${actualChecksum}. ` +
        'Never edit a committed migration file. Create a new migration instead.',
      { version, storedChecksum, actualChecksum }
    );
    this.name = 'MigrationTamperedError';
  }
}

/**
 * Thrown when `ProviderRepository.deleteProfile` is called for the last
 * remaining profile of a built-in provider (anthropic, openai, google).
 */
export class BuiltinProviderProtectedError extends FilmBuffDatabaseError {
  constructor(providerId: string, profileName: string) {
    super(
      'BUILTIN_PROVIDER_PROTECTED',
      `Cannot delete profile "${profileName}" for built-in provider "${providerId}". ` +
        'Built-in providers must retain at least one profile.',
      { providerId, profileName }
    );
    this.name = 'BuiltinProviderProtectedError';
  }
}

// =============================================================================
// SQLite error translation
// =============================================================================

/** Shape of errors thrown by better-sqlite3. */
interface SqliteError extends Error {
  code?: string;
}

/**
 * Translate a raw `better-sqlite3` error into a typed `FilmBuffDatabaseError`.
 * Falls back to wrapping the original error in a base `FilmBuffDatabaseError`
 * if the code is not recognised.
 *
 * @param err   - The error caught from a better-sqlite3 operation.
 * @param table - Optional table name for additional context.
 * @param slug  - Optional project slug (used when translating UNIQUE errors).
 */
export function translateSQLiteError(
  err: unknown,
  table?: string,
  slug?: string
): FilmBuffDatabaseError {
  const e = err as SqliteError;
  const ctx: DatabaseErrorContext = { sqliteCode: e.code, table };

  switch (e.code) {
    case 'SQLITE_CONSTRAINT_UNIQUE':
      return new DuplicateSlugError(slug ?? 'unknown', ctx);
    case 'SQLITE_BUSY':
    case 'SQLITE_BUSY_RECOVERY':
    case 'SQLITE_BUSY_SNAPSHOT':
      return new DatabaseBusyError(ctx);
    case 'SQLITE_CORRUPT':
    case 'SQLITE_CORRUPT_VTAB':
      return new DatabaseCorruptError(undefined, ctx);
    case 'SQLITE_READONLY':
    case 'SQLITE_READONLY_RECOVERY':
    case 'SQLITE_READONLY_CANTINIT':
    case 'SQLITE_READONLY_DIRECTORY':
      return new DatabaseReadonlyError(undefined, ctx);
    default:
      return new FilmBuffDatabaseError(
        e.code ?? 'SQLITE_UNKNOWN',
        e.message ?? 'An unexpected database error occurred.',
        ctx
      );
  }
}

// =============================================================================
// Session flag redaction
// =============================================================================

/**
 * Patterns whose keys indicate sensitive CLI flags.
 * Any CLI flag key matching one of these patterns is redacted before the flags
 * object is serialised and stored in `sessions.flags`.
 */
const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /key/i,
  /token/i,
  /secret/i,
  /password/i,
];

/**
 * Return a copy of `flags` with the values of sensitive keys replaced by
 * `[REDACTED]`.  Safe to call on any arbitrary CLI flag map.
 *
 * @example
 * redactSessionFlags({ '--api-key': 'sk-ant-...', '--verbose': 'true' })
 * // => { '--api-key': '[REDACTED]', '--verbose': 'true' }
 */
export function redactSessionFlags(
  flags: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flags)) {
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
    result[key] = isSensitive ? REDACTED : value;
  }
  return result;
}

