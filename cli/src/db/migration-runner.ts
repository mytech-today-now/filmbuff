/**
 * FilmBuff Migration Runner
 *
 * Discovers SQL migration files in the `migrations/` directory, verifies
 * checksums of previously applied migrations (tampering guard), and applies
 * any unapplied migrations inside a single SQLite transaction.
 *
 * Migration file naming convention: NNN_description.sql  (e.g. 001_initial_schema.sql)
 * Files are sorted lexicographically so NNN padding determines execution order.
 *
 * Tampering guard:
 *   On each run, every already-applied migration's SHA-256 checksum is re-computed
 *   from the file on disk and compared to the value stored in the `migrations`
 *   table.  A mismatch throws `MigrationTamperedError` before any SQL executes.
 *
 * Satisfies: bd-db-a2 buff-core.01.01.02 — Implement migration runner
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type Database from 'better-sqlite3';
import { MigrationTamperedError, translateSQLiteError } from './errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-256 hex digest of a UTF-8 string. */
function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Return sorted list of .sql files in the migrations directory. */
function discoverMigrationFiles(migrationsDir: string): string[] {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** Read the `migrations` tracking table.  Returns empty map if table absent. */
function loadAppliedMigrations(db: Database.Database): Map<string, string> {
  try {
    const rows = db
      .prepare('SELECT version, checksum FROM migrations ORDER BY id')
      .all() as Array<{ version: string; checksum: string }>;
    return new Map(rows.map((r) => [r.version, r.checksum]));
  } catch {
    // migrations table does not exist yet (first ever run)
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Prepared-statement cache (per-connection)
// ---------------------------------------------------------------------------

const INSERT_MIGRATION_SQL = `
  INSERT INTO migrations (version, applied_at, checksum)
  VALUES (?, datetime('now'), ?)
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply all pending SQL migrations found in `migrationsDir` to `db`.
 *
 * Steps:
 *  1. Discover `.sql` files sorted by filename.
 *  2. Load the previously-applied-migration map from the `migrations` table.
 *  3. Verify checksums of already-applied migrations (throws on mismatch).
 *  4. Execute each unapplied migration with `db.exec()` and record it.
 *
 * @param db             - Open Database instance (from `openDatabase()`).
 * @param migrationsDir  - Absolute path to the SQL migrations directory.
 *                         Defaults to the `migrations/` folder adjacent to
 *                         this compiled file.
 * @returns Number of newly applied migrations.
 */
export function runMigrations(
  db: Database.Database,
  migrationsDir: string = path.join(__dirname, 'migrations')
): number {
  const files = discoverMigrationFiles(migrationsDir);
  if (files.length === 0) return 0;

  const applied = loadAppliedMigrations(db);

  // -- Phase 1: tampering check ------------------------------------------------
  for (const filename of files) {
    const version = path.basename(filename, '.sql');
    if (!applied.has(version)) continue; // not yet applied — skip check

    const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
    const actual = sha256(sql);
    const stored = applied.get(version)!;

    if (stored !== actual) {
      throw new MigrationTamperedError(version, stored, actual);
    }
  }

  // -- Phase 2: apply pending migrations --------------------------------------
  let count = 0;

  for (const filename of files) {
    const version = path.basename(filename, '.sql');
    if (applied.has(version)) continue; // already applied

    const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
    const checksum = sha256(sql);

    try {
      // Run the full SQL file (may contain multiple statements)
      db.exec(sql);
      // Prepare AFTER exec so the migrations table exists (created by first migration)
      db.prepare(INSERT_MIGRATION_SQL).run(version, checksum);
    } catch (err) {
      throw translateSQLiteError(err);
    }

    count++;
  }

  return count;
}

