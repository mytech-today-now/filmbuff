/**
 * ai-powered/src/single-shot-job-store.ts
 *
 * Durable storage for per-shot job state.
 *
 * The store is intentionally tiny:
 *   - one SQLite table
 *   - one row per job_id
 *   - pending / complete / failed states
 *
 * The repository already depends on better-sqlite3, so we reuse that durable
 * storage pattern instead of keeping job state in process memory.
 */

import Database from 'better-sqlite3';
import * as path from 'path';

export type SingleShotJobStatus = 'pending' | 'complete' | 'failed';

export interface SingleShotJobRecord {
  jobId: string;
  shotId: string | null;
  provider: string;
  status: SingleShotJobStatus;
  clipUrl: string | null;
  clipPath: string | null;
  durationSeconds: number | null;
  resolution: string | null;
  creditsCharged: number | null;
  errorMessage: string | null;
  updatedAt: string;
}

export class SingleShotDurableStorageError extends Error {
  readonly code = 'SINGLE_SHOT_DURABLE_STORAGE_UNAVAILABLE';
  readonly retryable = false;

  constructor(message: string, cause?: unknown) {
    super(message, cause instanceof Error ? { cause } : undefined);
    this.name = 'SingleShotDurableStorageError';
  }
}

const DB_FILENAME = 'filmbuff.db';
const TABLE_NAME = 'single_shot_jobs';

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
    job_id TEXT PRIMARY KEY,
    shot_id TEXT,
    provider TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'complete', 'failed')),
    clip_url TEXT,
    clip_path TEXT,
    duration_seconds INTEGER,
    resolution TEXT,
    credits_charged INTEGER,
    error_message TEXT,
    updated_at TEXT NOT NULL
  )
`;

const UPSERT_PENDING_SQL = `
  INSERT INTO ${TABLE_NAME} (
    job_id, shot_id, provider, status,
    clip_url, clip_path, duration_seconds, resolution, credits_charged,
    error_message, updated_at
  ) VALUES (
    @job_id, @shot_id, @provider, 'pending',
    NULL, NULL, NULL, NULL, NULL,
    NULL, @updated_at
  )
  ON CONFLICT(job_id) DO UPDATE SET
    shot_id = COALESCE(excluded.shot_id, ${TABLE_NAME}.shot_id),
    provider = excluded.provider,
    status = excluded.status,
    clip_url = NULL,
    clip_path = NULL,
    duration_seconds = NULL,
    resolution = NULL,
    credits_charged = NULL,
    error_message = NULL,
    updated_at = excluded.updated_at
`;

const UPSERT_COMPLETE_SQL = `
  INSERT INTO ${TABLE_NAME} (
    job_id, shot_id, provider, status,
    clip_url, clip_path, duration_seconds, resolution, credits_charged,
    error_message, updated_at
  ) VALUES (
    @job_id, @shot_id, @provider, 'complete',
    @clip_url, @clip_path, @duration_seconds, @resolution, @credits_charged,
    NULL, @updated_at
  )
  ON CONFLICT(job_id) DO UPDATE SET
    shot_id = COALESCE(excluded.shot_id, ${TABLE_NAME}.shot_id),
    provider = excluded.provider,
    status = excluded.status,
    clip_url = excluded.clip_url,
    clip_path = excluded.clip_path,
    duration_seconds = excluded.duration_seconds,
    resolution = excluded.resolution,
    credits_charged = excluded.credits_charged,
    error_message = NULL,
    updated_at = excluded.updated_at
`;

const UPSERT_FAILED_SQL = `
  INSERT INTO ${TABLE_NAME} (
    job_id, shot_id, provider, status,
    clip_url, clip_path, duration_seconds, resolution, credits_charged,
    error_message, updated_at
  ) VALUES (
    @job_id, @shot_id, @provider, 'failed',
    NULL, NULL, NULL, NULL, @credits_charged,
    @error_message, @updated_at
  )
  ON CONFLICT(job_id) DO UPDATE SET
    shot_id = COALESCE(excluded.shot_id, ${TABLE_NAME}.shot_id),
    provider = excluded.provider,
    status = excluded.status,
    clip_url = NULL,
    clip_path = NULL,
    duration_seconds = NULL,
    resolution = NULL,
    credits_charged = excluded.credits_charged,
    error_message = excluded.error_message,
    updated_at = excluded.updated_at
`;

const SELECT_JOB_SQL = `SELECT * FROM ${TABLE_NAME} WHERE job_id = ?`;

let dbInstance: Database.Database | null = null;
let dbPath: string | null = null;

function resolveDatabasePath(): string {
  return process.env['FILMBUFF_SINGLE_SHOT_DB_PATH'] ?? path.join(process.cwd(), DB_FILENAME);
}

function applyPragmas(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
}

function translateStorageError(err: unknown): SingleShotDurableStorageError {
  if (err instanceof SingleShotDurableStorageError) {
    return err;
  }

  const message = err instanceof Error
    ? `Single-shot durable storage unavailable; restart-safe polling is disabled. ${err.message}`
    : 'Single-shot durable storage unavailable; restart-safe polling is disabled.';
  return new SingleShotDurableStorageError(message, err);
}

function ensureDatabase(): Database.Database {
  const resolvedPath = resolveDatabasePath();

  if (dbInstance) {
    if (dbPath !== resolvedPath) {
      throw new SingleShotDurableStorageError(
        `Single-shot durable storage is already open at "${dbPath}". Close it before switching to "${resolvedPath}".`,
      );
    }
    return dbInstance;
  }

  try {
    const db = new Database(resolvedPath);
    applyPragmas(db);
    db.prepare(CREATE_TABLE_SQL).run();
    dbInstance = db;
    dbPath = resolvedPath;
    return db;
  } catch (err) {
    throw translateStorageError(err);
  }
}

function rowToRecord(row: Record<string, unknown>): SingleShotJobRecord {
  return {
    jobId: row['job_id'] as string,
    shotId: (row['shot_id'] as string | null) ?? null,
    provider: row['provider'] as string,
    status: row['status'] as SingleShotJobStatus,
    clipUrl: (row['clip_url'] as string | null) ?? null,
    clipPath: (row['clip_path'] as string | null) ?? null,
    durationSeconds: row['duration_seconds'] == null ? null : Number(row['duration_seconds']),
    resolution: (row['resolution'] as string | null) ?? null,
    creditsCharged: row['credits_charged'] == null ? null : Number(row['credits_charged']),
    errorMessage: (row['error_message'] as string | null) ?? null,
    updatedAt: row['updated_at'] as string,
  };
}

function runStatement(sql: string, params: Record<string, unknown>): void {
  try {
    ensureDatabase().prepare(sql).run(params);
  } catch (err) {
    throw translateStorageError(err);
  }
}

export function getSingleShotJobStorePath(): string {
  return resolveDatabasePath();
}

export function ensureSingleShotJobStore(): Database.Database {
  return ensureDatabase();
}

export function closeSingleShotJobStore(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    dbPath = null;
  }
}

export function getSingleShotJob(jobId: string): SingleShotJobRecord | undefined {
  try {
    const row = ensureDatabase().prepare(SELECT_JOB_SQL).get(jobId) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : undefined;
  } catch (err) {
    throw translateStorageError(err);
  }
}

export function recordPendingSingleShotJob(input: {
  jobId: string;
  provider: string;
  shotId?: string;
  updatedAt?: string;
}): void {
  runStatement(UPSERT_PENDING_SQL, {
    job_id: input.jobId,
    shot_id: input.shotId ?? null,
    provider: input.provider,
    updated_at: input.updatedAt ?? new Date().toISOString(),
  });
}

export function recordCompleteSingleShotJob(input: {
  jobId: string;
  provider: string;
  shotId?: string;
  clipUrl: string;
  clipPath: string;
  durationSeconds?: number;
  resolution?: string;
  creditsCharged?: number;
  updatedAt?: string;
}): void {
  runStatement(UPSERT_COMPLETE_SQL, {
    job_id: input.jobId,
    shot_id: input.shotId ?? null,
    provider: input.provider,
    clip_url: input.clipUrl,
    clip_path: input.clipPath,
    duration_seconds: input.durationSeconds ?? null,
    resolution: input.resolution ?? null,
    credits_charged: input.creditsCharged ?? null,
    updated_at: input.updatedAt ?? new Date().toISOString(),
  });
}

export function recordFailedSingleShotJob(input: {
  jobId: string;
  provider: string;
  shotId?: string;
  errorMessage: string;
  creditsCharged?: number;
  updatedAt?: string;
}): void {
  runStatement(UPSERT_FAILED_SQL, {
    job_id: input.jobId,
    shot_id: input.shotId ?? null,
    provider: input.provider,
    credits_charged: input.creditsCharged ?? null,
    error_message: input.errorMessage,
    updated_at: input.updatedAt ?? new Date().toISOString(),
  });
}
