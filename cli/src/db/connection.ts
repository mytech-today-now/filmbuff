/**
 * FilmBuff DatabaseContext — Singleton Connection Factory
 *
 * Provides a single managed better-sqlite3 connection per process.  The
 * connection is opened lazily on first use, applies the required PRAGMAs,
 * and can be closed / reset (useful in tests).
 *
 * Exports:
 *   openDatabase(dbPath?)   — Returns the singleton Database instance.
 *   closeDatabase()         — Closes and resets the singleton (for tests).
 *   withTransaction(db, fn) — Runs fn inside a SQLite transaction.
 *
 * Satisfies: bd-db-a3 buff-core.01.01.03 — Implement DatabaseContext
 *            singleton and connection factory
 */

import Database from 'better-sqlite3';
import { translateSQLiteError } from './errors.js';

// ---------------------------------------------------------------------------
// PRAGMAs — applied immediately after every new connection is opened.
// ---------------------------------------------------------------------------

/**
 * Apply required runtime PRAGMAs to a freshly opened SQLite connection.
 * Called automatically by `openDatabase()`.
 */
function applyPragmas(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
}

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

let _instance: Database.Database | null = null;
let _instancePath: string | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open (or return) the singleton FilmBuff SQLite database connection.
 *
 * On first call the database file is opened, PRAGMAs are applied, and the
 * connection is cached.  Subsequent calls with the same path return the
 * cached connection.  Passing a different path after the singleton is open
 * throws an error — call `closeDatabase()` first if you need to switch paths.
 *
 * @param dbPath - Absolute path to the SQLite database file.
 *                 Defaults to `filmbuff.db` in `process.cwd()`.
 */
export function openDatabase(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? require('path').join(process.cwd(), 'filmbuff.db');

  if (_instance) {
    if (_instancePath !== resolvedPath) {
      throw new Error(
        `DatabaseContext: singleton already open at "${_instancePath}". ` +
          `Call closeDatabase() before switching to "${resolvedPath}".`
      );
    }
    return _instance;
  }

  try {
    const db = new Database(resolvedPath);
    applyPragmas(db);
    _instance = db;
    _instancePath = resolvedPath;
    return db;
  } catch (err) {
    throw translateSQLiteError(err);
  }
}

/**
 * Close the singleton database connection and reset internal state.
 * Safe to call when no connection is open (no-op).
 * Primarily intended for test teardown.
 */
export function closeDatabase(): void {
  if (_instance) {
    _instance.close();
    _instance = null;
    _instancePath = null;
  }
}

/**
 * Execute `fn` inside a SQLite transaction on `db`.
 *
 * Uses better-sqlite3's native transaction wrapper which automatically
 * commits on success and rolls back on any thrown exception.
 *
 * @param db  - The Database instance (from `openDatabase()`).
 * @param fn  - Synchronous function to execute inside the transaction.
 * @returns     The return value of `fn`.
 */
export function withTransaction<T>(db: Database.Database, fn: () => T): T {
  try {
    return db.transaction(fn)();
  } catch (err) {
    throw translateSQLiteError(err);
  }
}

/** Re-export the Database type for consumers that need it. */
export type { Database };

