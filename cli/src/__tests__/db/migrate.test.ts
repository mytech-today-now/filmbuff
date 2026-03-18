/**
 * Unit tests for cli/src/db/migration-runner.ts
 * Satisfies: bd-db-a4 buff-core.01.01.04-01 Write migrate.test.ts
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import { runMigrations } from '../../db/migration-runner';
import { MigrationTamperedError } from '../../db/errors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'filmbuff-migrate-'));
}

function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeSql(dir: string, filename: string, sql: string): void {
  fs.writeFileSync(path.join(dir, filename), sql, 'utf8');
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

const CREATE_MIGRATIONS_TABLE = `
  CREATE TABLE migrations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    version    TEXT    NOT NULL UNIQUE,
    applied_at TEXT    NOT NULL,
    checksum   TEXT    NOT NULL
  );
`;

/** In-memory DB pre-seeded with the migrations tracking table. */
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(CREATE_MIGRATIONS_TABLE);
  return db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runMigrations', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = makeTempDir();
    db = makeDb();
  });

  afterEach(() => {
    db.close();
    rmrf(tmpDir);
  });

  it('returns 0 when migrations directory does not exist', () => {
    expect(runMigrations(db, path.join(tmpDir, 'nonexistent'))).toBe(0);
  });

  it('returns 0 when directory contains no .sql files', () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# ignore me');
    expect(runMigrations(db, tmpDir)).toBe(0);
  });

  it('ignores non-.sql files alongside valid migrations', () => {
    writeSql(tmpDir, '001_real.sql', 'CREATE TABLE real_tbl (id TEXT);');
    fs.writeFileSync(path.join(tmpDir, '000_skip.txt'), 'ignore');
    expect(runMigrations(db, tmpDir)).toBe(1);
  });

  it('applies a single migration and returns 1', () => {
    writeSql(tmpDir, '001_foo.sql', 'CREATE TABLE foo (id TEXT PRIMARY KEY);');
    expect(runMigrations(db, tmpDir)).toBe(1);
    expect(() => db.prepare('SELECT * FROM foo').all()).not.toThrow();
  });

  it('records version and checksum in the migrations table', () => {
    const sql = 'CREATE TABLE baz (x INTEGER);';
    writeSql(tmpDir, '001_baz.sql', sql);
    runMigrations(db, tmpDir);
    const rows = db.prepare('SELECT version, checksum FROM migrations').all() as Array<{ version: string; checksum: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe('001_baz');
    expect(rows[0].checksum).toBe(sha256(sql));
  });

  it('applies multiple migrations in lexicographic order', () => {
    writeSql(tmpDir, '002_b.sql', 'CREATE TABLE b_tbl (id TEXT);');
    writeSql(tmpDir, '001_a.sql', 'CREATE TABLE a_tbl (id TEXT);');
    writeSql(tmpDir, '003_c.sql', 'CREATE TABLE c_tbl (id TEXT);');
    expect(runMigrations(db, tmpDir)).toBe(3);
    const rows = db.prepare('SELECT version FROM migrations ORDER BY id').all() as Array<{ version: string }>;
    expect(rows.map((r) => r.version)).toEqual(['001_a', '002_b', '003_c']);
  });

  it('skips already-applied migrations on a second run', () => {
    writeSql(tmpDir, '001_init.sql', 'CREATE TABLE init_t (id TEXT);');
    runMigrations(db, tmpDir);
    expect(runMigrations(db, tmpDir)).toBe(0);
  });

  it('applies only new migrations when some are already recorded', () => {
    writeSql(tmpDir, '001_first.sql', 'CREATE TABLE first_t (id TEXT);');
    runMigrations(db, tmpDir);
    writeSql(tmpDir, '002_second.sql', 'CREATE TABLE second_t (id TEXT);');
    expect(runMigrations(db, tmpDir)).toBe(1);
  });

  it('throws MigrationTamperedError when a migration file is modified after being applied', () => {
    writeSql(tmpDir, '001_tamper.sql', 'CREATE TABLE tamper_t (id TEXT);');
    runMigrations(db, tmpDir);
    writeSql(tmpDir, '001_tamper.sql', 'CREATE TABLE tamper_t (id TEXT, extra TEXT);');
    expect(() => runMigrations(db, tmpDir)).toThrow(MigrationTamperedError);
  });

  it('MigrationTamperedError carries the correct version in context', () => {
    writeSql(tmpDir, '001_vers.sql', 'CREATE TABLE vers_t (id TEXT);');
    runMigrations(db, tmpDir);
    writeSql(tmpDir, '001_vers.sql', '-- changed');
    let err: MigrationTamperedError | undefined;
    try { runMigrations(db, tmpDir); } catch (e) { err = e as MigrationTamperedError; }
    expect(err).toBeInstanceOf(MigrationTamperedError);
    expect(err?.context?.version).toBe('001_vers');
  });

  it('handles a migration file containing multiple SQL statements', () => {
    const sql = `CREATE TABLE m1 (id TEXT); CREATE TABLE m2 (id TEXT); INSERT INTO m1 VALUES ('hi');`;
    writeSql(tmpDir, '001_multi.sql', sql);
    expect(runMigrations(db, tmpDir)).toBe(1);
    const rows = db.prepare('SELECT id FROM m1').all() as Array<{ id: string }>;
    expect(rows[0].id).toBe('hi');
  });
});

