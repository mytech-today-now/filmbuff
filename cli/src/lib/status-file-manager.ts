/**
 * cli/src/lib/status-file-manager.ts
 *
 * Manages reads and append-only writes to 08-video-status.jsonl.
 * Provides file-lock safety for concurrent CLI invocations.
 *
 * Spec: openspec/changes/filmb-ai-p/specs/video-status-file/spec.md
 * Beads: bd-b3e9 (Phase 3 — WS-2)
 *
 * Design:
 *   - readAllRecords()    → VideoStatusRecord[]  (all records in file order)
 *   - getLatestState()    → Map<shotId, record>  (last record per shot_id, O(n))
 *   - appendRecord(r)     → void  (file-locked, atomic append)
 *   - appendRecords(rs)   → void  (file-locked, batch append)
 *   - renameClipForRetry  → void  (atomic rename; never copy+delete)
 *
 * Lock mechanism: exclusive write lock via a .lock file with ownership
 * metadata. Locks are only reclaimed when the owner process is confirmed dead;
 * otherwise callers receive a retryable busy error.
 */

import { randomUUID } from 'crypto';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import type { VideoStatusRecord } from './shot-state-machine.js';

export const STATUS_FILE_NAME = '08-video-status.jsonl';
const LOCK_FILE_NAME          = '08-video-status.jsonl.lock';
const LOCK_TIMEOUT_MS         = 10_000;
const LOCK_POLL_MS            = 50;
const LOCK_BUSY_MESSAGE       = 'The status file is busy. Retry after the lock clears.';

// ---------------------------------------------------------------------------
// Internal lock helpers
// ---------------------------------------------------------------------------

interface LockRecord {
  token: string;
  pid: number;
  acquiredAt: string;
}

type LockReadResult =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'valid'; record: LockRecord };

export class StatusFileBusyError extends Error {
  readonly code = 'STATUS_FILE_BUSY';
  readonly retryable = true;

  constructor(
    public readonly lockPath: string,
    public readonly lockRecord?: Pick<LockRecord, 'pid' | 'acquiredAt'>,
  ) {
    super(LOCK_BUSY_MESSAGE);
    this.name = 'StatusFileBusyError';
  }
}

function isErrnoCode(err: unknown, code: string): boolean {
  return typeof err === 'object'
    && err !== null
    && 'code' in err
    && (err as NodeJS.ErrnoException).code === code;
}

function createLockRecord(): LockRecord {
  return {
    token: randomUUID(),
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  };
}

async function writeLockRecord(lockPath: string, record: LockRecord): Promise<void> {
  await fsPromises.writeFile(lockPath, `${JSON.stringify(record)}\n`, { flag: 'wx', encoding: 'utf-8' });
}

async function readLockRecord(lockPath: string): Promise<LockReadResult> {
  let raw: string;
  try {
    raw = await fsPromises.readFile(lockPath, 'utf-8');
  } catch (err: unknown) {
    if (isErrnoCode(err, 'ENOENT')) return { kind: 'missing' };
    throw err;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: 'invalid' };

  try {
    const parsed = JSON.parse(trimmed) as Partial<LockRecord>;
    if (
      typeof parsed.token !== 'string' ||
      typeof parsed.pid !== 'number' ||
      !Number.isFinite(parsed.pid) ||
      typeof parsed.acquiredAt !== 'string'
    ) {
      return { kind: 'invalid' };
    }
    return { kind: 'valid', record: parsed as LockRecord };
  } catch {
    return { kind: 'invalid' };
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (isErrnoCode(err, 'ESRCH')) return false;
    if (isErrnoCode(err, 'EPERM')) return true;
    throw err;
  }
}

async function createExclusiveLock(lockPath: string): Promise<LockRecord> {
  const record = createLockRecord();
  await writeLockRecord(lockPath, record);
  return record;
}

async function reclaimStaleLock(lockPath: string): Promise<LockRecord> {
  const reclaimedLockPath = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
  try {
    await fsPromises.rename(lockPath, reclaimedLockPath);
  } catch (err: unknown) {
    if (!isErrnoCode(err, 'ENOENT')) {
      if (isErrnoCode(err, 'EACCES') || isErrnoCode(err, 'EPERM') || isErrnoCode(err, 'EBUSY')) {
        throw new StatusFileBusyError(lockPath);
      }
      throw err;
    }
  }

  try {
    return await createExclusiveLock(lockPath);
  } catch (err: unknown) {
    if (isErrnoCode(err, 'EEXIST')) {
      throw new StatusFileBusyError(lockPath);
    }
    throw err;
  } finally {
    await fsPromises.unlink(reclaimedLockPath).catch(() => {});
  }
}

async function acquireLock(lockPath: string): Promise<LockRecord> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      return await createExclusiveLock(lockPath);
    } catch (err: unknown) {
      if (!isErrnoCode(err, 'EEXIST')) throw err;
      await new Promise(r => setTimeout(r, LOCK_POLL_MS));
    }
  }

  const currentLock = await readLockRecord(lockPath);
  switch (currentLock.kind) {
    case 'missing':
      try {
        return await createExclusiveLock(lockPath);
      } catch (err: unknown) {
        if (isErrnoCode(err, 'EEXIST')) {
          throw new StatusFileBusyError(lockPath);
        }
        throw err;
      }
    case 'invalid':
      throw new StatusFileBusyError(lockPath);
    case 'valid':
      if (isProcessAlive(currentLock.record.pid)) {
        throw new StatusFileBusyError(lockPath, {
          pid: currentLock.record.pid,
          acquiredAt: currentLock.record.acquiredAt,
        });
      }
      return reclaimStaleLock(lockPath);
  }
}

export async function releaseLock(lockPath: string, lease: LockRecord): Promise<void> {
  try {
    const currentLock = await readLockRecord(lockPath);
    if (currentLock.kind !== 'valid') return;
    if (currentLock.record.token !== lease.token) return;
    await fsPromises.unlink(lockPath);
  } catch (err: unknown) {
    if (isErrnoCode(err, 'ENOENT')) return;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the path to the status file for a given project directory.
 */
export function getStatusFilePath(projectPath: string): string {
  return path.join(projectPath, STATUS_FILE_NAME);
}

/**
 * Read all records from 08-video-status.jsonl in file order.
 * Returns an empty array if the file does not exist.
 */
export async function readAllRecords(projectPath: string): Promise<VideoStatusRecord[]> {
  const filePath = getStatusFilePath(projectPath);
  let raw: string;
  try {
    raw = await fsPromises.readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return raw
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as VideoStatusRecord);
}

/**
 * Build a Map<shotId, lastRecord> from a single O(n) scan.
 * The last record for each shot_id in file order wins.
 */
export async function getLatestState(
  projectPath: string,
): Promise<Map<string, VideoStatusRecord>> {
  const records = await readAllRecords(projectPath);
  const map = new Map<string, VideoStatusRecord>();
  for (const record of records) {
    map.set(record.shot_id, record);
  }
  return map;
}

/**
 * Append a single record to 08-video-status.jsonl under a file lock.
 * Creates the file if it does not exist.
 */
export async function appendRecord(
  projectPath: string,
  record: VideoStatusRecord,
): Promise<void> {
  await appendRecords(projectPath, [record]);
}

/**
 * Append multiple records atomically under a single file lock.
 */
export async function appendRecords(
  projectPath: string,
  records: VideoStatusRecord[],
): Promise<void> {
  if (records.length === 0) return;
  const filePath = getStatusFilePath(projectPath);
  const lockPath = path.join(projectPath, LOCK_FILE_NAME);

  const lease = await acquireLock(lockPath);
  try {
    const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
    await fsPromises.appendFile(filePath, lines, 'utf-8');
  } finally {
    await releaseLock(lockPath, lease);
  }
}

/**
 * Rename a clip file for retry archiving.
 *
 * video/clips/s001.mp4  →  video/clips/s001_attempt{N}.mp4
 *
 * Must be atomic (rename, not copy+delete) per spec to avoid data loss on failure.
 * No-ops if the source file does not exist.
 */
export async function renameClipForRetry(
  clipPath: string,
  attemptCount: number,
): Promise<string> {
  const ext  = path.extname(clipPath);
  const base = path.basename(clipPath, ext);
  const dir  = path.dirname(clipPath);
  const dest = path.join(dir, `${base}_attempt${attemptCount}${ext}`);
  try {
    await fsPromises.rename(clipPath, dest);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // Source file absent — nothing to rename
  }
  return dest;
}
