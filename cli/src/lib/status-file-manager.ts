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
 * Lock mechanism: simple exclusive write lock via a .lock file.
 * Lock timeout: 10 seconds before stealing.
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import type { VideoStatusRecord } from './shot-state-machine.js';

export const STATUS_FILE_NAME = '08-video-status.jsonl';
const LOCK_FILE_NAME          = '08-video-status.jsonl.lock';
const LOCK_TIMEOUT_MS         = 10_000;
const LOCK_POLL_MS            = 50;

// ---------------------------------------------------------------------------
// Internal lock helpers
// ---------------------------------------------------------------------------

async function acquireLock(lockPath: string): Promise<void> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      // O_EXCL ensures atomic creation — only one process succeeds
      const fd = fs.openSync(lockPath, 'wx');
      fs.closeSync(fd);
      return;
    } catch {
      await new Promise(r => setTimeout(r, LOCK_POLL_MS));
    }
  }
  // Steal stale lock
  await fsPromises.writeFile(lockPath, '');
}

async function releaseLock(lockPath: string): Promise<void> {
  try { await fsPromises.unlink(lockPath); } catch { /* already gone */ }
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

  await acquireLock(lockPath);
  try {
    const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
    await fsPromises.appendFile(filePath, lines, 'utf-8');
  } finally {
    await releaseLock(lockPath);
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
