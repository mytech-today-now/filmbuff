/**
 * cli/src/__tests__/status-file-manager.test.ts
 *
 * Unit + integration tests for StatusFileManager (WS-2).
 * Tests: IT-SM-01, IT-SM-02 (temp file system integration)
 *
 * Spec: openspec/changes/filmb-ai-p/specs/video-status-file/spec.md
 * Beads: bd-b3e9 (Phase 3 — WS-2)
 */

import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  readAllRecords,
  getLatestState,
  appendRecord,
  appendRecords,
  renameClipForRetry,
  getStatusFilePath,
  STATUS_FILE_NAME,
} from '../lib/status-file-manager';
import type { VideoStatusRecord } from '../lib/shot-state-machine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Test setup — temp directory per test
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fb-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// IT-SM-01 — readAllRecords + appendRecord round-trip
// ---------------------------------------------------------------------------

describe('[IT-SM-01] readAllRecords / appendRecord round-trip', () => {
  it('returns empty array when status file does not exist', async () => {
    const records = await readAllRecords(tmpDir);
    expect(records).toEqual([]);
  });

  it('reads back appended records in order', async () => {
    const r1 = makeRecord({ shot_id: 's001', status: 'pending' });
    const r2 = makeRecord({ shot_id: 's002', status: 'pending' });
    await appendRecord(tmpDir, r1);
    await appendRecord(tmpDir, r2);

    const records = await readAllRecords(tmpDir);
    expect(records).toHaveLength(2);
    expect(records[0].shot_id).toBe('s001');
    expect(records[1].shot_id).toBe('s002');
  });

  it('appends multiple records atomically', async () => {
    const batch = [
      makeRecord({ shot_id: 's001' }),
      makeRecord({ shot_id: 's002' }),
      makeRecord({ shot_id: 's003' }),
    ];
    await appendRecords(tmpDir, batch);
    const records = await readAllRecords(tmpDir);
    expect(records).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// IT-SM-02 — getLatestState returns last record per shot_id
// ---------------------------------------------------------------------------

describe('[IT-SM-02] getLatestState — last record per shot_id wins', () => {
  it('returns last record when multiple records exist for same shot', async () => {
    const pending    = makeRecord({ shot_id: 's001', status: 'pending' });
    const generating = makeRecord({ shot_id: 's001', status: 'generating',
      provider: 'runway-gen3', attempt_count: 1 });
    await appendRecord(tmpDir, pending);
    await appendRecord(tmpDir, generating);

    const map = await getLatestState(tmpDir);
    expect(map.size).toBe(1);
    expect(map.get('s001')?.status).toBe('generating');
  });

  it('handles multiple distinct shots', async () => {
    await appendRecords(tmpDir, [
      makeRecord({ shot_id: 's001', status: 'pending' }),
      makeRecord({ shot_id: 's002', status: 'complete' }),
      makeRecord({ shot_id: 's001', status: 'generating' }),
    ]);
    const map = await getLatestState(tmpDir);
    expect(map.get('s001')?.status).toBe('generating');
    expect(map.get('s002')?.status).toBe('complete');
  });
});

// ---------------------------------------------------------------------------
// renameClipForRetry — atomic rename
// ---------------------------------------------------------------------------

describe('renameClipForRetry()', () => {
  it('renames clip to _attempt{N} pattern', async () => {
    const clipsDir = path.join(tmpDir, 'video', 'clips');
    await fs.mkdir(clipsDir, { recursive: true });
    const clipPath = path.join(clipsDir, 's001.mp4');
    await fs.writeFile(clipPath, 'fake mp4 data');

    const dest = await renameClipForRetry(clipPath, 1);
    expect(dest).toMatch(/s001_attempt1\.mp4$/);
    // Original gone; renamed file exists
    await expect(fs.access(clipPath)).rejects.toThrow();
    await expect(fs.access(dest)).resolves.toBeUndefined();
  });

  it('no-ops gracefully when source file does not exist', async () => {
    const clipPath = path.join(tmpDir, 'video', 'clips', 'ghost.mp4');
    // Should not throw
    await expect(renameClipForRetry(clipPath, 2)).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getStatusFilePath
// ---------------------------------------------------------------------------

describe('getStatusFilePath()', () => {
  it('returns path ending in STATUS_FILE_NAME', () => {
    const p = getStatusFilePath('/project');
    expect(p).toMatch(new RegExp(`${STATUS_FILE_NAME.replace('.', '\\.')}$`));
  });
});
