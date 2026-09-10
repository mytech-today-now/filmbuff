import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  appendRecord,
  appendRecords,
  getLatestState,
  getStatusFilePath,
  readAllRecords,
  renameClipForRetry,
  releaseLock,
  STATUS_FILE_NAME,
  StatusFileBusyError,
} from '../../../cli/src/lib/status-file-manager';
import type { VideoStatusRecord } from '../../../cli/src/lib/shot-state-machine';

function makeRecord(overrides: Partial<VideoStatusRecord> = {}): VideoStatusRecord {
  return {
    shot_id:          's001',
    status:           'pending',
    provider:         null,
    provider_job_id:  null,
    clip_path:        null,
    attempt_count:    0,
    rejection_reason: null,
    approved_at:      null,
    rejected_at:      null,
    generated_at:     null,
    failed_at:        null,
    credits_spent:    0,
    updated_at:       new Date().toISOString(),
    ...overrides,
  };
}

function makeLockRecord(overrides: Partial<{ token: string; pid: number; acquiredAt: string }> = {}): string {
  return `${JSON.stringify({
    token: 'lock-token',
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    ...overrides,
  })}\n`;
}

function makeErrno(code: NodeJS.ErrnoException['code']): NodeJS.ErrnoException {
  const err = new Error(String(code)) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

function installFastPolling(): { restore: () => void } {
  let tick = 0;
  const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
    tick += 1;
    return 1_000_000_000_000 + (tick * 1_000);
  });
  const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: any) => {
    if (typeof handler === 'function') {
      handler();
    }
    return 0 as any;
  }) as typeof setTimeout);

  return {
    restore: () => {
      nowSpy.mockRestore();
      timeoutSpy.mockRestore();
    },
  };
}

describe('status-file-manager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fb-status-file-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when the status file is missing', async () => {
    await expect(readAllRecords(tmpDir)).resolves.toEqual([]);
  });

  it('appends records in order and preserves latest state', async () => {
    await appendRecord(tmpDir, makeRecord({ shot_id: 's001', status: 'pending' }));
    await appendRecords(tmpDir, [
      makeRecord({ shot_id: 's002', status: 'complete' }),
      makeRecord({ shot_id: 's001', status: 'generating', provider: 'runway-gen3', attempt_count: 1 }),
    ]);

    const records = await readAllRecords(tmpDir);
    expect(records).toHaveLength(3);
    expect(records.map(record => record.shot_id)).toEqual(['s001', 's002', 's001']);

    const latest = await getLatestState(tmpDir);
    expect(latest.get('s001')?.status).toBe('generating');
    expect(latest.get('s002')?.status).toBe('complete');
  });

  it('release cleanup still ignores ENOENT exactly as today', async () => {
    const lockPath = path.join(tmpDir, `${STATUS_FILE_NAME}.lock`);
    const lease = {
      token: 'lock-token',
      pid: process.pid,
      acquiredAt: '2026-09-10T12:00:00.000Z',
    };

    await expect(releaseLock(lockPath, lease)).resolves.toBeUndefined();
  });

  it('returns a retryable busy error when a live owner still holds the lock', async () => {
    const fastPolling = installFastPolling();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    await fs.writeFile(
      path.join(tmpDir, `${STATUS_FILE_NAME}.lock`),
      makeLockRecord({ pid: process.pid, acquiredAt: '2026-09-10T12:00:00.000Z' }),
      'utf-8',
    );

    try {
      const error = await appendRecords(tmpDir, [makeRecord({ shot_id: 's001' })]).then(
        () => undefined,
        (err) => err,
      );

      expect(error).toBeInstanceOf(StatusFileBusyError);
      expect(error).toMatchObject({
        name: 'StatusFileBusyError',
        code: 'STATUS_FILE_BUSY',
        retryable: true,
        message: 'The status file is busy. Retry after the lock clears.',
      });
    } finally {
      fastPolling.restore();
      killSpy.mockRestore();
    }

    await expect(readAllRecords(tmpDir)).resolves.toEqual([]);
  });

  it('reclaims a truly stale lock and appends without corrupting the log', async () => {
    const fastPolling = installFastPolling();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw makeErrno('ESRCH');
    });

    await fs.writeFile(
      path.join(tmpDir, `${STATUS_FILE_NAME}.lock`),
      makeLockRecord({ pid: 999_999, acquiredAt: '2026-09-10T11:00:00.000Z' }),
      'utf-8',
    );

    try {
      await expect(appendRecords(tmpDir, [makeRecord({ shot_id: 's001' })])).resolves.toBeUndefined();
    } finally {
      fastPolling.restore();
      killSpy.mockRestore();
    }

    const records = await readAllRecords(tmpDir);
    expect(records).toHaveLength(1);
    expect(records[0]?.shot_id).toBe('s001');
    await expect(fs.stat(path.join(tmpDir, `${STATUS_FILE_NAME}.lock`))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('renames clip files for retry without deleting the preserved clip', async () => {
    const clipsDir = path.join(tmpDir, 'video', 'clips');
    await fs.mkdir(clipsDir, { recursive: true });
    const clipPath = path.join(clipsDir, 's001.mp4');
    await fs.writeFile(clipPath, 'fake mp4 data', 'utf-8');

    const dest = await renameClipForRetry(clipPath, 2);
    expect(dest).toMatch(/s001_attempt2\.mp4$/);
    await expect(fs.stat(clipPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(dest)).resolves.toBeDefined();
  });

  it('returns the status file path with the expected filename', () => {
    const result = getStatusFilePath('/project-root');
    expect(result).toBe(path.join('/project-root', STATUS_FILE_NAME));
  });
});
