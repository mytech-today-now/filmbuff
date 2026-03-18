/**
 * FilmBuff DB — Performance Profiling Utilities
 *
 * Lightweight, zero-dependency profiling helpers for the SQLite layer.
 *
 * Features:
 *   - measure()      Wrap any synchronous db call and record elapsed time.
 *   - measureAsync() Async variant.
 *   - walStats()     Read WAL-specific PRAGMA values for monitoring.
 *   - pragmaReport() Snapshot of all tuning PRAGMAs for diagnostics.
 *
 * Satisfies: bd-int-d3 buff-core.04.01.03 - 01
 *   Performance profiling and WAL tuning
 */

import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result emitted by measure() / measureAsync(). */
export interface ProfileResult<T> {
  /** Return value of the profiled operation. */
  result: T;
  /** Wall-clock milliseconds the operation took. */
  elapsedMs: number;
  /** Label passed to the profiler. */
  label: string;
}

/** WAL health snapshot returned by walStats(). */
export interface WalStats {
  /** Current WAL journal mode ("wal" if correctly set). */
  journalMode: string;
  /** synchronous setting (0=OFF, 1=NORMAL, 2=FULL, 3=EXTRA). */
  synchronous: number;
  /** Auto-checkpoint threshold in pages. */
  walAutocheckpoint: number;
  /** Page-cache size in kibibytes (positive = pages, negative = KiB). */
  cacheSize: number;
  /** Memory-mapped I/O window in bytes. */
  mmapSize: number;
  /** Temp store location (0=default, 1=file, 2=memory). */
  tempStore: number;
  /** Number of pages in the WAL file (from wal_checkpoint). */
  walPageCount: number | null;
  /** SQLite page size in bytes. */
  pageSize: number;
}

/** Full PRAGMA snapshot for diagnostics. */
export interface PragmaReport extends WalStats {
  foreignKeys: number;
  busyTimeout: number;
}

// ---------------------------------------------------------------------------
// Profiling helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a synchronous operation and measure elapsed wall-clock time.
 *
 * @example
 * const { result, elapsedMs } = measure('insert-doc', () =>
 *   db.prepare('INSERT INTO docs VALUES (?)').run('hello'));
 * console.log(`insert-doc took ${elapsedMs.toFixed(2)} ms`);
 */
export function measure<T>(label: string, fn: () => T): ProfileResult<T> {
  const start = process.hrtime.bigint();
  const result = fn();
  const end = process.hrtime.bigint();
  const elapsedMs = Number(end - start) / 1_000_000;
  return { result, elapsedMs, label };
}

/**
 * Async variant of measure().
 *
 * @example
 * const { result, elapsedMs } = await measureAsync('fetch-api', () =>
 *   fetch('https://example.com').then(r => r.json()));
 */
export async function measureAsync<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<ProfileResult<T>> {
  const start = process.hrtime.bigint();
  const result = await fn();
  const end = process.hrtime.bigint();
  const elapsedMs = Number(end - start) / 1_000_000;
  return { result, elapsedMs, label };
}

// ---------------------------------------------------------------------------
// WAL / PRAGMA diagnostics
// ---------------------------------------------------------------------------

/**
 * Read WAL-related PRAGMAs from an open database connection.
 * Useful for health checks and test assertions.
 */
export function walStats(db: Database.Database): WalStats {
  const journalMode      = (db.pragma('journal_mode',       { simple: true }) as string)  ?? 'unknown';
  const synchronous      = (db.pragma('synchronous',        { simple: true }) as number)  ?? -1;
  const walAutocheckpoint= (db.pragma('wal_autocheckpoint', { simple: true }) as number)  ?? -1;
  const cacheSize        = (db.pragma('cache_size',         { simple: true }) as number)  ?? 0;
  const mmapSize         = (db.pragma('mmap_size',          { simple: true }) as number)  ?? 0;
  const tempStore        = (db.pragma('temp_store',         { simple: true }) as number)  ?? 0;
  const pageSize         = (db.pragma('page_size',          { simple: true }) as number)  ?? 4096;

  // wal_checkpoint(PASSIVE) returns { busy, log, checkpointed }
  let walPageCount: number | null = null;
  try {
    const ck = db.pragma('wal_checkpoint(PASSIVE)') as Array<{ log: number }>;
    walPageCount = ck?.[0]?.log ?? null;
  } catch {
    // WAL checkpoint may fail on read-only or in-memory DBs — ignore.
  }

  return { journalMode, synchronous, walAutocheckpoint, cacheSize, mmapSize, tempStore, walPageCount, pageSize };
}

/**
 * Full PRAGMA snapshot for logging and diagnostics.
 */
export function pragmaReport(db: Database.Database): PragmaReport {
  const wal         = walStats(db);
  const foreignKeys = (db.pragma('foreign_keys', { simple: true }) as number) ?? 0;
  const busyTimeout = (db.pragma('busy_timeout', { simple: true }) as number) ?? 0;
  return { ...wal, foreignKeys, busyTimeout };
}

