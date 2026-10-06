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
 *   - appendRecord(r)     → void  (file-locked, append-only)
 *   - appendRecords(rs)   → void  (file-locked, batch append)
 *   - lifecycle recovery  → reconcile journaled reject/reopen operations before state reads
 *   - renameClipForRetry  → RenameClipForRetryOutcome  (exclusive move; never replaces a destination)
 *
 * Lock mechanism: exclusive write lock via a .lock file with ownership
 * metadata. Locks are only reclaimed when the owner process is confirmed dead;
 * otherwise callers receive a retryable busy error.
 */

import { randomUUID } from 'crypto';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import type {
  LifecycleClipIdentity,
  LifecycleTransitionIntent,
  VideoStatusRecord,
  VideoStatusSnapshot,
} from './shot-state-machine.js';

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

export type RenameClipForRetryOutcome =
  | {
    kind: 'moved';
    sourcePath: string;
    destinationPath: string;
  }
  | {
    kind: 'missing';
    sourcePath: string;
    destinationPath: string;
  }
  | {
    kind: 'failed';
    sourcePath: string;
    destinationPath: string;
    error: NodeJS.ErrnoException;
  };

export type LifecycleCheckpoint = 'after-intent' | 'after-archive-link' | 'after-archive' | 'after-status-append';

/** Optional deterministic fault seams used by the lifecycle recovery tests. */
export interface LifecycleTransitionFaultInjector {
  afterCheckpoint?: (checkpoint: LifecycleCheckpoint) => void | Promise<void>;
  moveClip?: (
    sourcePath: string,
    destinationPath: string,
    move: typeof moveFileExclusive,
  ) => Promise<RenameClipForRetryOutcome>;
  appendTransitionRecords?: (
    records: VideoStatusRecord[],
    persist: (records?: VideoStatusRecord[]) => Promise<void>,
  ) => Promise<void>;
}

export class LifecycleTransitionError extends Error {
  constructor(
    public readonly shotId: string,
    public readonly operation: 'reject' | 'reopen' | 'unknown',
    public readonly phase: 'archive' | 'append' | 'recovery',
    message: string,
    public readonly recoveryRequired = false,
  ) {
    super(message);
    this.name = 'LifecycleTransitionError';
  }
}

export interface ClipLifecycleTransitionResult {
  archiveOutcome: RenameClipForRetryOutcome;
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

async function withStatusFileLock<T>(
  projectPath: string,
  action: () => Promise<T>,
): Promise<T> {
  const lockPath = path.join(projectPath, LOCK_FILE_NAME);
  const lease = await acquireLock(lockPath);
  try {
    return await action();
  } finally {
    await releaseLock(lockPath, lease);
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
  return withStatusFileLock(projectPath, async () => {
    await recoverPendingLifecycleTransitionsLocked(projectPath);
    return latestStateFromRecords(await readAllRecords(projectPath));
  });
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
  await withStatusFileLock(projectPath, async () => {
    await recoverPendingLifecycleTransitionsLocked(projectPath);
    await appendRecordsLocked(projectPath, records);
  });
}

function latestStateFromRecords(records: VideoStatusRecord[]): Map<string, VideoStatusRecord> {
  const map = new Map<string, VideoStatusRecord>();
  for (const record of records) map.set(record.shot_id, record);
  return map;
}

function snapshotRecord(record: VideoStatusRecord): VideoStatusSnapshot {
  const snapshot = { ...record };
  delete snapshot.lifecycle_operation;
  return snapshot;
}

function snapshotsMatch(left: VideoStatusSnapshot, right: VideoStatusSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function identityFromStats(stats: Awaited<ReturnType<typeof fsPromises.lstat>>): LifecycleClipIdentity {
  return {
    device: Number(stats.dev),
    inode: Number(stats.ino),
    size: Number(stats.size),
    modified_at_ms: Number(stats.mtimeMs),
  };
}

function identitiesMatch(left: LifecycleClipIdentity, right: LifecycleClipIdentity): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.size === right.size
    && left.modified_at_ms === right.modified_at_ms;
}

type FileInspection =
  | { kind: 'missing' }
  | { kind: 'present'; identity: LifecycleClipIdentity };

async function inspectFile(filePath: string): Promise<FileInspection> {
  try {
    return { kind: 'present', identity: identityFromStats(await fsPromises.lstat(filePath)) };
  } catch (err: unknown) {
    if (isErrnoCode(err, 'ENOENT')) return { kind: 'missing' };
    throw err;
  }
}

async function appendRecordsLocked(projectPath: string, records: VideoStatusRecord[]): Promise<void> {
  if (records.length === 0) return;
  const filePath = getStatusFilePath(projectPath);
  const lines = records.map(record => JSON.stringify(record)).join('\n') + '\n';
  await fsPromises.appendFile(filePath, lines, 'utf-8');
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVideoStatusSnapshot(value: unknown): value is VideoStatusSnapshot {
  if (!isObjectRecord(value)) return false;
  const nullableTextFields = [
    'provider',
    'provider_job_id',
    'clip_path',
    'rejection_reason',
    'approved_at',
    'rejected_at',
    'generated_at',
    'failed_at',
  ];
  return typeof value.shot_id === 'string'
    && ['pending', 'generating', 'complete', 'approved', 'rejected', 'failed'].includes(String(value.status))
    && nullableTextFields.every(field => value[field] === null || typeof value[field] === 'string')
    && typeof value.attempt_count === 'number'
    && Number.isFinite(value.attempt_count)
    && typeof value.credits_spent === 'number'
    && Number.isFinite(value.credits_spent)
    && typeof value.updated_at === 'string';
}

function isLifecycleIntent(value: unknown): value is LifecycleTransitionIntent {
  if (!isObjectRecord(value)) return false;
  const identity = value.source_identity;
  const validIdentity = identity === null || (
    isObjectRecord(identity)
    && typeof identity.device === 'number'
    && Number.isFinite(identity.device)
    && typeof identity.inode === 'number'
    && Number.isFinite(identity.inode)
    && typeof identity.size === 'number'
    && Number.isFinite(identity.size)
    && typeof identity.modified_at_ms === 'number'
    && Number.isFinite(identity.modified_at_ms)
  );
  return typeof value.operation_id === 'string'
    && typeof value.shot_id === 'string'
    && (value.operation === 'reject' || value.operation === 'reopen')
    && typeof value.source_clip_path === 'string'
    && typeof value.archive_clip_path === 'string'
    && validIdentity
    && isVideoStatusSnapshot(value.prior_record)
    && Array.isArray(value.planned_records)
    && value.planned_records.length > 0
    && value.planned_records.every(isVideoStatusSnapshot);
}

function getPendingLifecycleOperations(records: VideoStatusRecord[]): Map<string, {
  intent: LifecycleTransitionIntent;
  committed: Map<number, VideoStatusRecord>;
  aborted: boolean;
}> {
  const operations = new Map<string, {
    intent: LifecycleTransitionIntent;
    committed: Map<number, VideoStatusRecord>;
    aborted: boolean;
  }>();

  for (const record of records) {
    const markerValue: unknown = record.lifecycle_operation;
    if (markerValue === undefined) continue;
    if (!isObjectRecord(markerValue)) {
      throw new LifecycleTransitionError(
        record.shot_id,
        'unknown',
        'recovery',
        `the persisted lifecycle marker is malformed; manual recovery is required for shot "${record.shot_id}".`,
        true,
      );
    }

    if (markerValue.kind === 'intent') {
      if (!isLifecycleIntent(markerValue.intent)) {
        throw new LifecycleTransitionError(
          record.shot_id,
          'unknown',
          'recovery',
          `the persisted lifecycle intent is malformed; manual recovery is required for shot "${record.shot_id}".`,
          true,
        );
      }
      const intent = markerValue.intent;
      const expectedStatuses = intent.operation === 'reject'
        ? ['rejected', 'pending']
        : ['pending'];
      if (
        intent.shot_id !== record.shot_id
        || intent.prior_record.shot_id !== intent.shot_id
        || intent.planned_records.some(planned => planned.shot_id !== intent.shot_id)
        || intent.prior_record.status !== (intent.operation === 'reject' ? 'complete' : 'approved')
        || intent.planned_records.length !== expectedStatuses.length
        || intent.planned_records.some((planned, index) =>
          planned.status !== expectedStatuses[index]
          || planned.attempt_count !== intent.prior_record.attempt_count
          || planned.credits_spent !== intent.prior_record.credits_spent,
        )
      ) {
        throw new LifecycleTransitionError(
          record.shot_id,
          intent.operation,
          'recovery',
          `the persisted ${intent.operation} intent names inconsistent shot data; manual recovery is required for shot "${record.shot_id}".`,
          true,
        );
      }
      if (operations.has(intent.operation_id)) {
        throw new LifecycleTransitionError(
          record.shot_id,
          intent.operation,
          'recovery',
          `duplicate intent records were found; manual recovery is required for shot "${record.shot_id}".`,
          true,
        );
      }
      operations.set(intent.operation_id, { intent, committed: new Map(), aborted: false });
      continue;
    }

    const kind = markerValue.kind;
    const operationId = markerValue.operation_id;
    if ((kind !== 'commit' && kind !== 'aborted') || typeof operationId !== 'string') {
      throw new LifecycleTransitionError(
        record.shot_id,
        'unknown',
        'recovery',
        `the persisted lifecycle marker is malformed; manual recovery is required for shot "${record.shot_id}".`,
        true,
      );
    }

    const progress = operations.get(operationId);
    if (!progress) {
      throw new LifecycleTransitionError(
        record.shot_id,
        'unknown',
        'recovery',
        `a lifecycle ${kind} record has no matching intent; manual recovery is required for shot "${record.shot_id}".`,
        true,
      );
    }
    if (record.shot_id !== progress.intent.shot_id) {
      throw new LifecycleTransitionError(
        progress.intent.shot_id,
        progress.intent.operation,
        'recovery',
        `a lifecycle record names a different shot; manual recovery is required for shot "${progress.intent.shot_id}".`,
        true,
      );
    }

    if (kind === 'aborted') {
      if (typeof markerValue.reason !== 'string' || progress.committed.size > 0 || progress.aborted) {
        throw new LifecycleTransitionError(
          progress.intent.shot_id,
          progress.intent.operation,
          'recovery',
          `the ${progress.intent.operation} log contains conflicting completion records; manual recovery is required for shot "${progress.intent.shot_id}".`,
          true,
        );
      }
      progress.aborted = true;
      continue;
    }

    const step = markerValue.step;
    const planned = typeof step === 'number' ? progress.intent.planned_records[step] : undefined;
    if (
      typeof step !== 'number'
      || !Number.isInteger(step)
      || step < 0
      || !planned
      || !snapshotsMatch(snapshotRecord(record), planned)
      || progress.committed.has(step)
      || progress.aborted
    ) {
      throw new LifecycleTransitionError(
        progress.intent.shot_id,
        progress.intent.operation,
        'recovery',
        `the ${progress.intent.operation} transition log is inconsistent at step ${String(step)}; manual recovery is required for shot "${progress.intent.shot_id}".`,
        true,
      );
    }
    progress.committed.set(step, record);
  }

  return new Map([...operations].filter(([, progress]) =>
    !progress.aborted && progress.committed.size < progress.intent.planned_records.length,
  ));
}

function operationError(
  intent: LifecycleTransitionIntent,
  phase: LifecycleTransitionError['phase'],
  detail: string,
  recoveryRequired = false,
): LifecycleTransitionError {
  const prefix = phase === 'recovery'
    ? `Cannot recover interrupted ${intent.operation} for shot "${intent.shot_id}"`
    : phase === 'archive'
      ? `Failed to archive clip for shot "${intent.shot_id}"`
      : `Failed to record ${intent.operation} transition for shot "${intent.shot_id}"`;
  const suffix = recoveryRequired ? ' Manual recovery is required.' : '';
  return new LifecycleTransitionError(
    intent.shot_id,
    intent.operation,
    phase,
    `${prefix}: ${detail}.${suffix}`,
    recoveryRequired,
  );
}

async function reconcileIntentArchive(
  projectPath: string,
  intent: LifecycleTransitionIntent,
  move: typeof moveFileExclusive = moveFileExclusive,
): Promise<'moved' | 'missing'> {
  const sourcePath = path.resolve(projectPath, intent.source_clip_path);
  const archivePath = path.resolve(projectPath, intent.archive_clip_path);
  const source = await inspectFile(sourcePath);
  const archive = await inspectFile(archivePath);

  if (!intent.source_identity) {
    if (source.kind !== 'missing' || archive.kind !== 'missing') {
      throw new Error('the clip paths changed after the missing-source intent was recorded');
    }
    return 'missing';
  }

  const expected = intent.source_identity;
  if (source.kind === 'present' && archive.kind === 'present') {
    if (
      identitiesMatch(source.identity, expected)
      && identitiesMatch(archive.identity, expected)
    ) {
      await fsPromises.unlink(sourcePath);
      return 'moved';
    }
    throw new Error('both source and archive clips exist with different file identities');
  }

  if (source.kind === 'missing' && archive.kind === 'present') {
    if (identitiesMatch(archive.identity, expected)) return 'moved';
    throw new Error('the archive path contains a different clip than the recorded intent');
  }

  if (source.kind === 'missing' && archive.kind === 'missing') {
    throw new Error('both the source and archive clip are missing');
  }

  if (source.kind === 'present' && !identitiesMatch(source.identity, expected)) {
    throw new Error('the source path now contains a different clip than the recorded intent');
  }

  const moveOutcome = await move(sourcePath, archivePath);
  if (moveOutcome.kind === 'moved') return 'moved';

  // A link can succeed before unlinking the source fails. Reconcile that
  // intermediate state only when both names still identify the same clip.
  const afterSource = await inspectFile(sourcePath);
  const afterArchive = await inspectFile(archivePath);
  if (
    afterSource.kind === 'present'
    && afterArchive.kind === 'present'
    && identitiesMatch(afterSource.identity, expected)
    && identitiesMatch(afterArchive.identity, expected)
  ) {
    await fsPromises.unlink(sourcePath);
    return 'moved';
  }

  if (afterSource.kind === 'present' && afterArchive.kind === 'missing') {
    throw new Error(moveOutcome.kind === 'failed' ? moveOutcome.error.message : 'the source clip disappeared during archive');
  }
  throw new Error('the clip paths changed while archiving; neither path was overwritten');
}

function commitRecordsForIntent(intent: LifecycleTransitionIntent): VideoStatusRecord[] {
  return intent.planned_records.map((record, step) => ({
    ...record,
    lifecycle_operation: { kind: 'commit', operation_id: intent.operation_id, step },
  }));
}

async function appendAbortedIntentLocked(
  projectPath: string,
  intent: LifecycleTransitionIntent,
  reason: string,
): Promise<void> {
  await appendRecordsLocked(projectPath, [{
    ...intent.prior_record,
    lifecycle_operation: { kind: 'aborted', operation_id: intent.operation_id, reason },
  }]);
}

async function isSafeToAbortIntent(
  projectPath: string,
  intent: LifecycleTransitionIntent,
): Promise<boolean> {
  const sourcePath = path.resolve(projectPath, intent.source_clip_path);
  const archivePath = path.resolve(projectPath, intent.archive_clip_path);
  const source = await inspectFile(sourcePath);
  const archive = await inspectFile(archivePath);
  if (!intent.source_identity) return source.kind === 'missing' && archive.kind === 'missing';
  return source.kind === 'present'
    && archive.kind === 'missing'
    && identitiesMatch(source.identity, intent.source_identity);
}

async function restoreSourceClip(
  projectPath: string,
  intent: LifecycleTransitionIntent,
): Promise<void> {
  if (!intent.source_identity) return;
  const sourcePath = path.resolve(projectPath, intent.source_clip_path);
  const archivePath = path.resolve(projectPath, intent.archive_clip_path);
  const source = await inspectFile(sourcePath);
  const archive = await inspectFile(archivePath);
  if (source.kind !== 'missing' || archive.kind !== 'present') {
    throw new Error('the original clip location or archive destination changed before rollback');
  }
  if (!identitiesMatch(archive.identity, intent.source_identity)) {
    throw new Error('the archive destination no longer matches the clip being restored');
  }
  const outcome = await moveFileExclusive(archivePath, sourcePath);
  if (outcome.kind !== 'moved') {
    throw new Error(outcome.kind === 'failed' ? outcome.error.message : 'the archive clip disappeared during rollback');
  }
}

async function recoverPendingLifecycleTransitionsLocked(projectPath: string): Promise<void> {
  const records = await readAllRecords(projectPath);
  const pending = getPendingLifecycleOperations(records);
  const pendingShotIds = new Set<string>();
  for (const { intent } of pending.values()) {
    if (pendingShotIds.has(intent.shot_id)) {
      throw operationError(intent, 'recovery', 'more than one unfinished operation exists for this shot', true);
    }
    pendingShotIds.add(intent.shot_id);
  }

  for (const progress of pending.values()) {
    const { intent, committed } = progress;
    try {
      await reconcileIntentArchive(projectPath, intent);
      const steps = [...committed.keys()].sort((left, right) => left - right);
      if (steps.some((step, index) => step !== index)) {
        throw new Error('committed transition records are not a contiguous prefix');
      }
      const allCommits = commitRecordsForIntent(intent);
      await appendRecordsLocked(projectPath, allCommits.slice(steps.length));
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      throw operationError(intent, 'recovery', detail, true);
    }
  }
}

/**
 * Archive a reject/reopen clip and append its state transition under the status
 * lock. The intent checkpoint and commit markers make every awaited boundary
 * restart-reconcilable without claiming a cross-resource atomic transaction.
 */
export async function archiveClipAndAppendLifecycleTransition(
  projectPath: string,
  priorRecord: VideoStatusRecord,
  operation: 'reject' | 'reopen',
  plannedRecords: VideoStatusRecord[],
  faultInjector?: LifecycleTransitionFaultInjector,
): Promise<ClipLifecycleTransitionResult> {
  return withStatusFileLock(projectPath, async () => {
    await recoverPendingLifecycleTransitionsLocked(projectPath);
    const records = await readAllRecords(projectPath);
    const current = latestStateFromRecords(records).get(priorRecord.shot_id);
    if (!current || !snapshotsMatch(snapshotRecord(current), snapshotRecord(priorRecord))) {
      throw new LifecycleTransitionError(
        priorRecord.shot_id,
        operation,
        'recovery',
        `Shot "${priorRecord.shot_id}" changed before the ${operation} could be recorded. Retry after checking its current state.`,
      );
    }
    if (plannedRecords.length === 0 || plannedRecords.some(record => record.shot_id !== priorRecord.shot_id)) {
      throw new LifecycleTransitionError(
        priorRecord.shot_id,
        operation,
        'recovery',
        `The planned ${operation} records do not match shot "${priorRecord.shot_id}".`,
      );
    }

    const sourceAbsolutePath = path.resolve(
      projectPath,
      priorRecord.clip_path ?? path.join('video', 'clips', `${priorRecord.shot_id}.mp4`),
    );
    const extension = path.extname(sourceAbsolutePath);
    const archiveAbsolutePath = path.join(
      path.dirname(sourceAbsolutePath),
      `${path.basename(sourceAbsolutePath, extension)}_attempt${priorRecord.attempt_count}${extension}`,
    );
    let sourceInspection: FileInspection;
    let archiveInspection: FileInspection;
    try {
      sourceInspection = await inspectFile(sourceAbsolutePath);
      archiveInspection = await inspectFile(archiveAbsolutePath);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new LifecycleTransitionError(
        priorRecord.shot_id,
        operation,
        'archive',
        `Failed to inspect clip paths for shot "${priorRecord.shot_id}": ${detail}`,
      );
    }
    if (archiveInspection.kind === 'present') {
      throw new LifecycleTransitionError(
        priorRecord.shot_id,
        operation,
        'archive',
        `Failed to archive clip for shot "${priorRecord.shot_id}": attempt destination already exists; the existing clip was preserved.`,
      );
    }

    const intent: LifecycleTransitionIntent = {
      operation_id: randomUUID(),
      shot_id: priorRecord.shot_id,
      operation,
      source_clip_path: path.relative(projectPath, sourceAbsolutePath),
      archive_clip_path: path.relative(projectPath, archiveAbsolutePath),
      source_identity: sourceInspection.kind === 'present' ? sourceInspection.identity : null,
      prior_record: snapshotRecord(priorRecord),
      planned_records: plannedRecords.map(snapshotRecord),
    };
    try {
      await appendRecordsLocked(projectPath, [{
        ...intent.prior_record,
        lifecycle_operation: { kind: 'intent', intent },
      }]);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new LifecycleTransitionError(
        intent.shot_id,
        operation,
        'append',
        `Failed to record ${operation} recovery intent for shot "${intent.shot_id}": ${detail}`,
      );
    }
    await faultInjector?.afterCheckpoint?.('after-intent');

    let archiveKind: 'moved' | 'missing';
    try {
      archiveKind = await reconcileIntentArchive(
        projectPath,
        intent,
        faultInjector?.moveClip
          ? (sourcePath, destinationPath) => faultInjector.moveClip!(sourcePath, destinationPath, moveFileExclusive)
          : moveFileExclusive,
      );
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      let safeToAbort = false;
      try {
        safeToAbort = await isSafeToAbortIntent(projectPath, intent);
      } catch (inspectError: unknown) {
        const inspectDetail = inspectError instanceof Error ? inspectError.message : String(inspectError);
        throw operationError(intent, 'recovery', `archive failed (${detail}) and its paths could not be inspected (${inspectDetail})`, true);
      }
      if (safeToAbort) {
        try {
          await appendAbortedIntentLocked(projectPath, intent, detail);
        } catch (abortError: unknown) {
          const abortDetail = abortError instanceof Error ? abortError.message : String(abortError);
          throw operationError(intent, 'recovery', `archive failed (${detail}) and its abort marker could not be recorded (${abortDetail})`, true);
        }
        throw operationError(intent, 'archive', detail);
      }
      throw operationError(intent, 'recovery', detail, true);
    }
    await faultInjector?.afterCheckpoint?.('after-archive');

    const commitRecords = commitRecordsForIntent(intent);
    try {
      const persist = (recordsToPersist: VideoStatusRecord[] = commitRecords) =>
        appendRecordsLocked(projectPath, recordsToPersist);
      if (faultInjector?.appendTransitionRecords) {
        await faultInjector.appendTransitionRecords(commitRecords, persist);
      } else {
        await persist();
      }
    } catch (err: unknown) {
      const appendDetail = err instanceof Error ? err.message : String(err);
      const progress = getPendingLifecycleOperations(await readAllRecords(projectPath)).get(intent.operation_id);
      if (progress && progress.committed.size > 0) {
        throw operationError(intent, 'append', `status append stopped after ${progress.committed.size} transition record(s); ${appendDetail}`, true);
      }
      try {
        if (archiveKind === 'moved') await restoreSourceClip(projectPath, intent);
        await appendAbortedIntentLocked(projectPath, intent, `status append failed: ${appendDetail}`);
      } catch (rollbackError: unknown) {
        const rollbackDetail = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        throw operationError(intent, 'append', `${appendDetail}; rollback also failed: ${rollbackDetail}`, true);
      }
      throw operationError(
        intent,
        'append',
        `${appendDetail}${archiveKind === 'moved' ? '; the clip was restored to its original location' : ''}`,
      );
    }
    await faultInjector?.afterCheckpoint?.('after-status-append');

    return {
      archiveOutcome: archiveKind === 'moved'
        ? { kind: 'moved', sourcePath: sourceAbsolutePath, destinationPath: archiveAbsolutePath }
        : { kind: 'missing', sourcePath: sourceAbsolutePath, destinationPath: archiveAbsolutePath },
    };
  });
}

/**
 * Move a clip file for retry archiving without replacing an existing attempt.
 *
 * video/clips/s001.mp4  →  video/clips/s001_attempt{N}.mp4
 *
 * Creates the destination with an exclusive hard link, then removes the source.
 * Reject/reopen wrap this move in a persisted lifecycle intent so a stop between
 * the two filesystem operations is recoverable. Returns whether the move moved the file,
 * found the source missing, or failed for another filesystem reason.
 */
export async function renameClipForRetry(
  clipPath: string,
  attemptCount: number,
): Promise<RenameClipForRetryOutcome> {
  const ext  = path.extname(clipPath);
  const base = path.basename(clipPath, ext);
  const dir  = path.dirname(clipPath);
  const dest = path.join(dir, `${base}_attempt${attemptCount}${ext}`);
  let existingDestination: FileInspection;
  try {
    existingDestination = await inspectFile(dest);
  } catch (err: unknown) {
    return {
      kind: 'failed',
      sourcePath: clipPath,
      destinationPath: dest,
      error: err as NodeJS.ErrnoException,
    };
  }
  if (existingDestination.kind === 'present') {
    const error = new Error('Attempt destination already exists; existing clip was preserved.') as NodeJS.ErrnoException;
    error.code = 'EEXIST';
    return { kind: 'failed', sourcePath: clipPath, destinationPath: dest, error };
  }
  return moveFileExclusive(clipPath, dest);
}

async function moveFileExclusive(sourcePath: string, destinationPath: string): Promise<RenameClipForRetryOutcome> {
  try {
    await fsPromises.link(sourcePath, destinationPath);
  } catch (err: unknown) {
    if (isErrnoCode(err, 'ENOENT')) {
      return { kind: 'missing', sourcePath, destinationPath };
    }
    return {
      kind: 'failed',
      sourcePath,
      destinationPath,
      error: err as NodeJS.ErrnoException,
    };
  }

  try {
    await fsPromises.unlink(sourcePath);
  } catch (err: unknown) {
    return {
      kind: 'failed',
      sourcePath,
      destinationPath,
      error: err as NodeJS.ErrnoException,
    };
  }

  return { kind: 'moved', sourcePath, destinationPath };
}
