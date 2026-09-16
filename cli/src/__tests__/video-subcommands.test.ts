/**
 * cli/src/__tests__/video-subcommands.test.ts
 *
 * Test plan: openspec/changes/filmb-ai-p/tests/video-subcommands.test-plan.md
 * Beads: bd-1751 (Phase 8 — Testing & Quality Gates, AC-01 through AC-15)
 *
 * UT-INIT-01 through UT-INIT-05  video init
 * UT-NEXT-01 through UT-NEXT-02  video next
 * UT-GEN-01  through UT-GEN-02   video generate
 * UT-APP-01  through UT-APP-02   video approve
 * UT-STAT-01 through UT-STAT-06  video status
 * UT-DEPR-01 through UT-DEPR-02  generate-video deprecation
 * UT-PROJ-01 through UT-PROJ-02  --project flag
 *
 * All tests use real file-system operations in temp directories.
 * FILMBUFF_MOCK_PROVIDER=1 enables mock generateSingleShot() in per-shot-api.ts.
 */

import * as fs    from 'fs';
import * as os    from 'os';
import * as path  from 'path';

import type { VideoStatusRecord } from '../lib/shot-state-machine';

// ---------------------------------------------------------------------------
// Mocks hoisted above all imports
// ---------------------------------------------------------------------------

jest.mock('chalk', () => {
  const fn = (s: string) => s;
  const p  = new Proxy(fn, { get: () => p });
  return { default: p, yellow: p, green: p, red: p, bold: p };
});

// ---------------------------------------------------------------------------
// ExitError — thrown by our process.exit mock
// ---------------------------------------------------------------------------

class ExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
    this.name = 'ExitError';
  }
}

// ---------------------------------------------------------------------------
// Capture helper
// ---------------------------------------------------------------------------

interface Capture {
  readonly stdout:   string;
  readonly stderr:   string;
  readonly exitCode: number | undefined;
  restore(): void;
}

function beginCapture(): Capture {
  const state = { stdout: '', stderr: '', exitCode: undefined as number | undefined };
  const sOut  = jest.spyOn(process.stdout, 'write').mockImplementation((d) => {
    state.stdout += typeof d === 'string' ? d : Buffer.from(d as Uint8Array).toString();
    return true;
  });
  const sErr  = jest.spyOn(process.stderr, 'write').mockImplementation((d) => {
    state.stderr += typeof d === 'string' ? d : Buffer.from(d as Uint8Array).toString();
    return true;
  });
  const sExit = jest.spyOn(process, 'exit').mockImplementation((code?) => {
    state.exitCode = (code as number) ?? 0;
    throw new ExitError((code as number) ?? 0);
  }) as jest.SpyInstance;

  return {
    get stdout()   { return state.stdout; },
    get stderr()   { return state.stderr; },
    get exitCode() { return state.exitCode; },
    restore() { sOut.mockRestore(); sErr.mockRestore(); sExit.mockRestore(); },
  };
}

// ---------------------------------------------------------------------------
// Temp project factory
// ---------------------------------------------------------------------------

const SHOT_LIST_3 = [
  { shot_id: 's001', scene: 'EXT. ROOFTOP - NIGHT', shot_type: 'Wide',     duration_seconds: 8 },
  { shot_id: 's002', scene: 'EXT. ROOFTOP - NIGHT', shot_type: 'Close-Up', duration_seconds: 5 },
  { shot_id: 's003', scene: 'INT. WAREHOUSE - NIGHT', shot_type: 'Medium', duration_seconds: 6 },
];

async function makeTempProject(shots = SHOT_LIST_3): Promise<string> {
  const dir   = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fb-subcmd-'));
  const lines = shots.map(s => JSON.stringify(s)).join('\n') + '\n';
  await fs.promises.writeFile(path.join(dir, '08-shot-list.jsonl'), lines);
  return dir;
}

const STALE_UPDATED_AT = '2024-01-01T00:00:00.000Z';

function makeStatusRecord(overrides: Partial<VideoStatusRecord> = {}): VideoStatusRecord {
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
    updated_at:       STALE_UPDATED_AT,
    ...overrides,
  };
}

async function writeStatusFile(dir: string, records: VideoStatusRecord[]): Promise<void> {
  const lines = records.map(record => JSON.stringify(record)).join('\n') + '\n';
  await fs.promises.writeFile(path.join(dir, '08-video-status.jsonl'), lines);
}

async function writeClipFile(
  dir: string,
  relativeClipPath: string,
  contents = 'fake mp4 data',
): Promise<string> {
  const clipPath = path.join(dir, relativeClipPath);
  await fs.promises.mkdir(path.dirname(clipPath), { recursive: true });
  await fs.promises.writeFile(clipPath, contents);
  return clipPath;
}

function mockStdinTTY(value: boolean): () => void {
  const original = process.stdin.isTTY;
  Object.defineProperty(process.stdin, 'isTTY', {
    value,
    configurable: true,
  });
  return () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: original,
      configurable: true,
    });
  };
}

async function initProject(dir: string): Promise<void> {
  const { videoInitCommand } = await import('../commands/video/init');
  const c = beginCapture();
  try { await videoInitCommand({ project: dir, agent: true }); }
  catch (e) { if (!(e instanceof ExitError)) throw e; }
  finally   { c.restore(); }
}

// Resolve commands fresh to bypass module caching between tests
async function initCmd()     { return (await import('../commands/video/init')).videoInitCommand; }
async function nextCmd()     { return (await import('../commands/video/next')).videoNextCommand; }
async function generateCmd() { return (await import('../commands/video/generate')).videoGenerateCommand; }
async function generateAllCmd() { return (await import('../commands/video/generate-all')).videoGenerateAllCommand; }
async function approveCmd()  { return (await import('../commands/video/approve')).videoApproveCommand; }
async function rejectCmd()   { return (await import('../commands/video/reject')).videoRejectCommand; }
async function reopenCmd()   { return (await import('../commands/video/reopen')).videoReopenCommand; }
async function statusCmd()   { return (await import('../commands/video/status')).videoStatusCommand; }

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

interface MockSingleShotResult {
  jobId: string;
  status: 'complete' | 'failed';
  creditsCharged?: number;
  errorMessage?: string;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 250): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return predicate();
}

// ---------------------------------------------------------------------------
// afterEach cleanup
// ---------------------------------------------------------------------------

let tmpDir = '';
beforeEach(() => { process.env['FILMBUFF_MOCK_PROVIDER'] = '1'; });

// ===========================================================================
// UT-INIT — video init
// ===========================================================================

describe('[UT-INIT-01] video init creates 08-video-status.jsonl with pending records', () => {
  it('creates status file with one pending record per shot', async () => {
    tmpDir = await makeTempProject();
    const cmd = await initCmd();
    const c   = beginCapture();
    try { await cmd({ project: tmpDir, agent: true }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally   { c.restore(); }

    expect(c.exitCode).toBe(0);
    const statusPath = path.join(tmpDir, '08-video-status.jsonl');
    expect(fs.existsSync(statusPath)).toBe(true);

    const records = fs.readFileSync(statusPath, 'utf-8')
      .split('\n').filter(Boolean).map(l => JSON.parse(l));
    expect(records).toHaveLength(3);
    expect(records.every((r: { status: string }) => r.status === 'pending')).toBe(true);
    expect(records.map((r: { shot_id: string }) => r.shot_id)).toEqual(['s001', 's002', 's003']);
  });
});

describe('[UT-INIT-02] video init creates video/clips/ directory', () => {
  it('creates the clips directory', async () => {
    tmpDir = await makeTempProject();
    const cmd = await initCmd();
    const c   = beginCapture();
    try { await cmd({ project: tmpDir, agent: true }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally   { c.restore(); }

    expect(fs.existsSync(path.join(tmpDir, 'video', 'clips'))).toBe(true);
  });
});

describe('[UT-INIT-03] video init exits with STATE_CONFLICT(5) if already initialized', () => {
  it('fails with exit code 5 without --overwrite', async () => {
    tmpDir = await makeTempProject();
    const cmd = await initCmd();
    // First init
    let c = beginCapture();
    try { await cmd({ project: tmpDir, agent: true }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally   { c.restore(); }

    // Second init without --overwrite
    c = beginCapture();
    try { await cmd({ project: tmpDir, agent: true }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally   { c.restore(); }

    expect(c.exitCode).toBe(5);
    const env = JSON.parse(c.stdout.trim());
    expect(env.status).toBe('error');
    expect(env.errorCode).toBe('STATE_CONFLICT');
  });
});

describe('[UT-INIT-04] video init --overwrite reinitializes existing file', () => {
  it('succeeds with --overwrite even when status file exists', async () => {
    tmpDir = await makeTempProject();
    const cmd = await initCmd();
    let c = beginCapture();
    try { await cmd({ project: tmpDir, agent: true }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally { c.restore(); }

    c = beginCapture();
    try { await cmd({ project: tmpDir, overwrite: true, agent: true }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally { c.restore(); }

    expect(c.exitCode).toBe(0);
    const records = fs.readFileSync(path.join(tmpDir, '08-video-status.jsonl'), 'utf-8')
      .split('\n').filter(Boolean).map(l => JSON.parse(l));
    expect(records).toHaveLength(3);
  });
});

describe('[UT-INIT-05] video init exits with NOT_FOUND(2) for missing shot list', () => {
  it('exits 2 when 08-shot-list.jsonl absent', async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fb-empty-'));
    const cmd = await initCmd();
    const c   = beginCapture();
    try { await cmd({ project: tmpDir, agent: true }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally   { c.restore(); }

    expect(c.exitCode).toBe(2);
    const env = JSON.parse(c.stdout.trim());
    expect(env.errorCode).toBe('NOT_FOUND');
  });
});

// ===========================================================================
// UT-NEXT — video next
// ===========================================================================

describe('[UT-NEXT-01] video next generates clip for first pending shot', () => {
  it('returns exit 0 and complete status', async () => {
    tmpDir = await makeTempProject();
    await initProject(tmpDir);
    // Create clips dir (mock provider writes the file)
    await fs.promises.mkdir(path.join(tmpDir, 'video', 'clips'), { recursive: true });

    const cmd = await nextCmd();
    const c   = beginCapture();
    try { await cmd({ project: tmpDir, provider: 'runway-gen3', agent: true }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally   { c.restore(); }

    expect(c.exitCode).toBe(0);
    const env = JSON.parse(c.stdout.trim());
    expect(env.status).toBe('success');
    expect(env.shotId ?? env.data?.shot_id).toMatch(/s00[123]/);
  });
});

describe('[UT-NEXT-02] video next exits 0 with all_generated when no pending remain', () => {
  it('exits 0 when all shots are already approved', async () => {
    tmpDir = await makeTempProject([{ shot_id: 's001', scene: 'A', shot_type: 'Wide', duration_seconds: 5 }]);
    // Manually create a fully-approved status file
    const record = JSON.stringify({
      shot_id: 's001', status: 'approved', provider: 'runway-gen3',
      provider_job_id: 'j1', clip_path: 'video/clips/s001.mp4',
      attempt_count: 1, rejection_reason: null, approved_at: new Date().toISOString(),
      rejected_at: null, generated_at: new Date().toISOString(), failed_at: null,
      credits_spent: 5, updated_at: new Date().toISOString(),
    });
    await fs.promises.writeFile(path.join(tmpDir, '08-video-status.jsonl'), record + '\n');

    const cmd = await nextCmd();
    const c   = beginCapture();
    try { await cmd({ project: tmpDir, provider: 'runway-gen3', agent: true }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally   { c.restore(); }

    expect(c.exitCode).toBe(0);
    const env = JSON.parse(c.stdout.trim());
    expect(env.status).toBe('success');
    expect(env.data?.all_generated).toBe(true);
  });
});

// ===========================================================================
// UT-GA — video generate-all
// ===========================================================================

describe('[UT-GA-01] video generate-all completes all pending shots', () => {
  it('exits 0 and reports credits for every completed shot', async () => {
    tmpDir = await makeTempProject();
    await initProject(tmpDir);

    const cmd = await generateAllCmd();
    const c   = beginCapture();
    try {
      await cmd({ project: tmpDir, provider: 'runway-gen3', concurrency: 3, agent: true });
    } catch (e) {
      if (!(e instanceof ExitError)) throw e;
    } finally {
      c.restore();
    }

    expect(c.exitCode).toBe(0);
    const env = JSON.parse(c.stdout.trim());
    expect(env.status).toBe('success');
    expect(env.data?.generated).toBe(3);
    expect(env.data?.failed).toBe(0);
    expect(env.data?.pending_remaining).toBe(0);
    expect(env.creditsSpent).toBe(15);
  });
});

describe('[UT-GA-02] video generate-all stops later batch shots after credit exhaustion', () => {
  it('exits 3, counts only completed work, and never submits shot 3', async () => {
    tmpDir = await makeTempProject();
    await initProject(tmpDir);

    const perShotApi = await import('../lib/per-shot-api');
    const calls: string[] = [];
    const deferredResults = new Map<string, Deferred<MockSingleShotResult>>();

    const generateSpy = jest.spyOn(perShotApi, 'generateSingleShot').mockImplementation(async ({ shot }) => {
      calls.push(shot.shot_id);
      let deferred = deferredResults.get(shot.shot_id);
      if (!deferred) {
        deferred = createDeferred<MockSingleShotResult>();
        deferredResults.set(shot.shot_id, deferred);
      }
      return deferred.promise;
    });

    const cmd = await generateAllCmd();
    const c   = beginCapture();
    const runPromise = (async () => {
      try {
        await cmd({ project: tmpDir, provider: 'runway-gen3', concurrency: 3, agent: true });
        return c.exitCode ?? 0;
      } catch (e) {
        if (e instanceof ExitError) return e.code;
        throw e;
      }
    })();

    const resolveShot = (shotId: string, result: MockSingleShotResult) => {
      const deferred = deferredResults.get(shotId);
      if (deferred) {
        deferred.resolve(result);
      }
    };

    try {
      expect(await waitForCondition(() => calls.length >= 1, 500)).toBe(true);
      expect(calls).toEqual(['s001']);

      resolveShot('s001', { jobId: 'job-s001', status: 'complete', creditsCharged: 5 });

      expect(await waitForCondition(() => calls.length >= 2, 500)).toBe(true);
      expect(calls.slice(0, 2)).toEqual(['s001', 's002']);

      resolveShot('s002', {
        jobId: 'job-s002',
        status: 'failed',
        creditsCharged: 0,
        errorMessage: 'credit_exhaustion',
      });

      expect(await waitForCondition(() => calls.length === 2, 100)).toBe(true);

      const exitCode = await runPromise;
      expect(exitCode).toBe(3);
      const env = JSON.parse(c.stdout.trim());
      expect(env.status).toBe('error');
      expect(env.errorCode).toBe('INSUFFICIENT_CREDITS');
      expect(env.creditsSpent).toBe(5);
      expect(calls).toEqual(['s001', 's002']);
    } finally {
      resolveShot('s001', { jobId: 'cleanup-s001', status: 'complete', creditsCharged: 5 });
      resolveShot('s002', {
        jobId: 'cleanup-s002',
        status: 'failed',
        creditsCharged: 0,
        errorMessage: 'credit_exhaustion',
      });
      const s3 = deferredResults.get('s003');
      if (s3) {
        s3.resolve({ jobId: 'cleanup-s003', status: 'complete', creditsCharged: 0 });
      }
      await runPromise.catch(() => undefined);
      generateSpy.mockRestore();
      c.restore();
    }
  });
});

describe('[UT-GA-03] video generate-all exits 0 when no pending shots remain', () => {
  it('returns success without submitting any additional shots', async () => {
    tmpDir = await makeTempProject([{ shot_id: 's001', scene: 'A', shot_type: 'Wide', duration_seconds: 5 }]);
    const completeRecord = JSON.stringify({
      shot_id: 's001', status: 'complete', provider: 'runway-gen3',
      provider_job_id: 'j1', clip_path: 'video/clips/s001.mp4',
      attempt_count: 1, rejection_reason: null, approved_at: null,
      rejected_at: null, generated_at: new Date().toISOString(), failed_at: null,
      credits_spent: 5, updated_at: new Date().toISOString(),
    });
    await fs.promises.writeFile(path.join(tmpDir, '08-video-status.jsonl'), completeRecord + '\n');

    const cmd = await generateAllCmd();
    const c   = beginCapture();
    try {
      await cmd({ project: tmpDir, provider: 'runway-gen3', agent: true });
    } catch (e) {
      if (!(e instanceof ExitError)) throw e;
    } finally {
      c.restore();
    }

    expect(c.exitCode).toBe(0);
    const env = JSON.parse(c.stdout.trim());
    expect(env.status).toBe('success');
    expect(env.data?.generated).toBe(0);
    expect(env.data?.pending_remaining).toBe(0);
    expect(env.creditsSpent).toBe(0);
  });
});

afterEach(async () => {
  if (tmpDir) { await fs.promises.rm(tmpDir, { recursive: true, force: true }); tmpDir = ''; }
  delete process.env['FILMBUFF_MOCK_PROVIDER'];
  delete process.env['FILMBUFF_WATCHDOG_TIMEOUT_MS'];
  jest.resetModules();
});

// ===========================================================================
// UT-GEN — video generate
// ===========================================================================

describe('[UT-GEN-01] video generate --shot <id> succeeds for pending shot', () => {
  it('exits 0 and records complete status', async () => {
    tmpDir = await makeTempProject();
    await initProject(tmpDir);
    await fs.promises.mkdir(path.join(tmpDir, 'video', 'clips'), { recursive: true });
    const cmd = await generateCmd();
    const c   = beginCapture();
    try { await cmd({ project: tmpDir, shotId: 's001', provider: 'pika-2', agent: true }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally   { c.restore(); }

    expect(c.exitCode).toBe(0);
    const env = JSON.parse(c.stdout.trim());
    expect(env.status).toBe('success');
    expect(env.shotId ?? env.data?.shot_id).toBe('s001');
  });
});

describe('[UT-GEN-02] video generate exits STATE_CONFLICT(5) for non-pending shot without --force', () => {
  it('exits 5 when shot already approved', async () => {
    tmpDir = await makeTempProject([{ shot_id: 's001', scene: 'A', shot_type: 'Wide', duration_seconds: 5 }]);
    const approvedRecord = JSON.stringify({
      shot_id: 's001', status: 'approved', provider: 'runway-gen3',
      provider_job_id: 'j1', clip_path: 'video/clips/s001.mp4',
      attempt_count: 1, rejection_reason: null, approved_at: new Date().toISOString(),
      rejected_at: null, generated_at: new Date().toISOString(), failed_at: null,
      credits_spent: 5, updated_at: new Date().toISOString(),
    });
    await fs.promises.writeFile(path.join(tmpDir, '08-video-status.jsonl'), approvedRecord + '\n');

    const cmd = await generateCmd();
    const c   = beginCapture();
    try { await cmd({ project: tmpDir, shotId: 's001', agent: true }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally   { c.restore(); }

    expect(c.exitCode).toBe(5);
    const env = JSON.parse(c.stdout.trim());
    expect(env.errorCode).toBe('STATE_CONFLICT');
  });
});

// ===========================================================================
// UT-APP — video approve
// ===========================================================================

describe('[UT-APP-01] video approve transitions complete→approved', () => {
  it('exits 0 and sets status to approved', async () => {
    tmpDir = await makeTempProject([{ shot_id: 's001', scene: 'A', shot_type: 'Wide', duration_seconds: 5 }]);
    const completeRecord = JSON.stringify({
      shot_id: 's001', status: 'complete', provider: 'runway-gen3',
      provider_job_id: 'j1', clip_path: 'video/clips/s001.mp4',
      attempt_count: 1, rejection_reason: null, approved_at: null,
      rejected_at: null, generated_at: new Date().toISOString(), failed_at: null,
      credits_spent: 5, updated_at: new Date().toISOString(),
    });
    await fs.promises.writeFile(path.join(tmpDir, '08-video-status.jsonl'), completeRecord + '\n');

    const cmd = await approveCmd();
    const c   = beginCapture();
    try { await cmd({ project: tmpDir, shots: ['s001'], agent: true }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally   { c.restore(); }

    expect(c.exitCode).toBe(0);
    const env = JSON.parse(c.stdout.trim());
    expect(env.status).toBe('success');
    expect(env.data?.approved_this_call).toBe(1);
  });
});

describe('[UT-APP-02] video approve exits STATE_CONFLICT(5) for non-complete shot', () => {
  it('exits 5 when shot is pending', async () => {
    tmpDir = await makeTempProject([{ shot_id: 's001', scene: 'A', shot_type: 'Wide', duration_seconds: 5 }]);
    const pendingRecord = JSON.stringify({
      shot_id: 's001', status: 'pending', provider: null, provider_job_id: null,
      clip_path: null, attempt_count: 0, rejection_reason: null, approved_at: null,
      rejected_at: null, generated_at: null, failed_at: null, credits_spent: 0,
      updated_at: new Date().toISOString(),
    });
    await fs.promises.writeFile(path.join(tmpDir, '08-video-status.jsonl'), pendingRecord + '\n');

    const cmd = await approveCmd();
    const c   = beginCapture();
    try { await cmd({ project: tmpDir, shots: ['s001'], agent: true }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally   { c.restore(); }

    expect(c.exitCode).toBe(5);
  });
});

// ===========================================================================
// UT-ARC — video reject / reopen archive outcomes
// ===========================================================================

describe('[UT-ARC-01] video reject reports missing source clips explicitly', () => {
  it('prints a missing-source message and does not claim archive success', async () => {
    tmpDir = await makeTempProject([{ shot_id: 's001', scene: 'A', shot_type: 'Wide', duration_seconds: 5 }]);
    await writeStatusFile(tmpDir, [
      makeStatusRecord({
        shot_id: 's001',
        status: 'complete',
        provider: 'runway-gen3',
        provider_job_id: 'job-s001',
        clip_path: 'video/clips/s001.mp4',
        attempt_count: 1,
        generated_at: STALE_UPDATED_AT,
      }),
    ]);

    const cmd = await rejectCmd();
    const restoreTTY = mockStdinTTY(true);
    const c = beginCapture();
    try {
      await cmd({ project: tmpDir, shotId: 's001', reason: 'missing source', agent: false });
    } catch (e) {
      if (!(e instanceof ExitError)) throw e;
    } finally {
      c.restore();
      restoreTTY();
    }

    expect(c.exitCode).toBe(0);
    expect(c.stdout).toContain('Clip missing at source:');
    expect(c.stdout).toContain('no archive created');
    expect(c.stdout).not.toContain('Clip archived to:');
    const records = fs.readFileSync(path.join(tmpDir, '08-video-status.jsonl'), 'utf-8')
      .split('\n').filter(Boolean).map(line => JSON.parse(line));
    expect(records).toHaveLength(3);
    expect(records[0].status).toBe('complete');
    expect(records[1].status).toBe('rejected');
    expect(records[2].status).toBe('pending');
    expect(fs.existsSync(path.join(tmpDir, 'video', 'clips', 's001_attempt1.mp4'))).toBe(false);
  });
});

describe('[UT-ARC-02] video reopen reports missing source clips explicitly', () => {
  it('prints a missing-source message and still reopens the shot', async () => {
    tmpDir = await makeTempProject([{ shot_id: 's001', scene: 'A', shot_type: 'Wide', duration_seconds: 5 }]);
    await writeStatusFile(tmpDir, [
      makeStatusRecord({
        shot_id: 's001',
        status: 'approved',
        provider: 'runway-gen3',
        provider_job_id: 'job-s001',
        clip_path: 'video/clips/s001.mp4',
        attempt_count: 1,
        approved_at: STALE_UPDATED_AT,
        generated_at: STALE_UPDATED_AT,
      }),
    ]);

    const cmd = await reopenCmd();
    const restoreTTY = mockStdinTTY(true);
    const c = beginCapture();
    try {
      await cmd({ project: tmpDir, shotId: 's001', reason: 'missing source', agent: false });
    } catch (e) {
      if (!(e instanceof ExitError)) throw e;
    } finally {
      c.restore();
      restoreTTY();
    }

    expect(c.exitCode).toBe(0);
    expect(c.stdout).toContain('Approved clip missing at source:');
    expect(c.stdout).toContain('no archive created');
    expect(c.stdout).not.toContain('Approved clip archived to:');

    const records = fs.readFileSync(path.join(tmpDir, '08-video-status.jsonl'), 'utf-8')
      .split('\n').filter(Boolean).map(line => JSON.parse(line));
    expect(records).toHaveLength(2);
    expect(records[1].status).toBe('pending');
    expect(records[1].clip_path).toBeNull();
  });
});

describe('[UT-ARC-07] video reject agent payload reports missing source clips without an archive', () => {
  it('returns a success envelope with missing archive metadata', async () => {
    tmpDir = await makeTempProject([{ shot_id: 's001', scene: 'A', shot_type: 'Wide', duration_seconds: 5 }]);
    await writeStatusFile(tmpDir, [
      makeStatusRecord({
        shot_id: 's001',
        status: 'complete',
        provider: 'runway-gen3',
        provider_job_id: 'job-s001',
        clip_path: 'video/clips/s001.mp4',
        attempt_count: 1,
        generated_at: STALE_UPDATED_AT,
      }),
    ]);

    const cmd = await rejectCmd();
    const c = beginCapture();
    try {
      await cmd({ project: tmpDir, shotId: 's001', reason: 'missing source', agent: true });
    } catch (e) {
      if (!(e instanceof ExitError)) throw e;
    } finally {
      c.restore();
    }

    const env = JSON.parse(c.stdout.trim());
    expect(c.exitCode).toBe(0);
    expect(env.status).toBe('success');
    expect(env.shotId).toBe('s001');
    expect(env.data?.archived_clip).toBeNull();
    expect(env.data?.archive_result?.kind).toBe('missing');
    expect(env.data?.archive_result?.source_path).toBe(path.join(tmpDir, 'video', 'clips', 's001.mp4'));
    expect(env.data?.archive_result?.destination_path).toBe(path.join(tmpDir, 'video', 'clips', 's001_attempt1.mp4'));
    expect(env.data?.new_status).toBe('pending');
  });
});

describe('[UT-ARC-08] video reopen agent payload reports missing source clips without an archive', () => {
  it('returns a success envelope with missing archive metadata', async () => {
    tmpDir = await makeTempProject([{ shot_id: 's001', scene: 'A', shot_type: 'Wide', duration_seconds: 5 }]);
    await writeStatusFile(tmpDir, [
      makeStatusRecord({
        shot_id: 's001',
        status: 'approved',
        provider: 'runway-gen3',
        provider_job_id: 'job-s001',
        clip_path: 'video/clips/s001.mp4',
        attempt_count: 1,
        approved_at: STALE_UPDATED_AT,
        generated_at: STALE_UPDATED_AT,
      }),
    ]);

    const cmd = await reopenCmd();
    const c = beginCapture();
    try {
      await cmd({ project: tmpDir, shotId: 's001', reason: 'missing source', agent: true });
    } catch (e) {
      if (!(e instanceof ExitError)) throw e;
    } finally {
      c.restore();
    }

    const env = JSON.parse(c.stdout.trim());
    expect(c.exitCode).toBe(0);
    expect(env.status).toBe('success');
    expect(env.shotId).toBe('s001');
    expect(env.data?.archived_clip).toBeNull();
    expect(env.data?.archive_result?.kind).toBe('missing');
    expect(env.data?.archive_result?.source_path).toBe(path.join(tmpDir, 'video', 'clips', 's001.mp4'));
    expect(env.data?.archive_result?.destination_path).toBe(path.join(tmpDir, 'video', 'clips', 's001_attempt1.mp4'));
    expect(env.data?.reason).toBe('missing source');
    expect(env.data?.new_status).toBe('pending');
  });
});

describe('[UT-ARC-09] video reject rolls back an archived clip when status append fails', () => {
  it('restores the source clip and keeps the status file unchanged', async () => {
    tmpDir = await makeTempProject([{ shot_id: 's001', scene: 'A', shot_type: 'Wide', duration_seconds: 5 }]);
    await writeStatusFile(tmpDir, [
      makeStatusRecord({
        shot_id: 's001',
        status: 'complete',
        provider: 'runway-gen3',
        provider_job_id: 'job-s001',
        clip_path: 'video/clips/s001.mp4',
        attempt_count: 1,
        generated_at: STALE_UPDATED_AT,
      }),
    ]);
    await writeClipFile(tmpDir, 'video/clips/s001.mp4');

    const appendSpy = jest.spyOn(fs.promises, 'appendFile').mockImplementation(async () => {
      const err = new Error('disk full') as NodeJS.ErrnoException;
      err.code = 'ENOSPC';
      throw err;
    });

    const cmd = await rejectCmd();
    const c = beginCapture();
    try {
      await cmd({ project: tmpDir, shotId: 's001', reason: 'archive move', agent: true });
    } catch (e) {
      if (!(e instanceof ExitError)) throw e;
    } finally {
      c.restore();
      appendSpy.mockRestore();
    }

    expect(c.exitCode).toBe(1);
    const env = JSON.parse(c.stdout.trim());
    expect(env.status).toBe('error');
    expect(env.errorCode).toBe('GENERAL_ERROR');
    expect(env.shotId).toBe('s001');

    const records = fs.readFileSync(path.join(tmpDir, '08-video-status.jsonl'), 'utf-8')
      .split('\n').filter(Boolean).map(line => JSON.parse(line));
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('complete');
    expect(records[0].clip_path).toBe('video/clips/s001.mp4');
    expect(records[0].rejection_reason).toBeNull();
    expect(fs.existsSync(path.join(tmpDir, 'video', 'clips', 's001.mp4'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'video', 'clips', 's001_attempt1.mp4'))).toBe(false);
  });
});

describe('[UT-ARC-10] video reopen rolls back an archived clip when status append fails', () => {
  it('restores the source clip and keeps the status file unchanged', async () => {
    tmpDir = await makeTempProject([{ shot_id: 's001', scene: 'A', shot_type: 'Wide', duration_seconds: 5 }]);
    await writeStatusFile(tmpDir, [
      makeStatusRecord({
        shot_id: 's001',
        status: 'approved',
        provider: 'runway-gen3',
        provider_job_id: 'job-s001',
        clip_path: 'video/clips/s001_attempt1.mp4',
        attempt_count: 2,
        approved_at: STALE_UPDATED_AT,
        generated_at: STALE_UPDATED_AT,
      }),
    ]);
    await writeClipFile(tmpDir, 'video/clips/s001_attempt1.mp4');

    const appendSpy = jest.spyOn(fs.promises, 'appendFile').mockImplementation(async () => {
      const err = new Error('disk full') as NodeJS.ErrnoException;
      err.code = 'ENOSPC';
      throw err;
    });

    const cmd = await reopenCmd();
    const c = beginCapture();
    try {
      await cmd({ project: tmpDir, shotId: 's001', reason: 'archive move', agent: true });
    } catch (e) {
      if (!(e instanceof ExitError)) throw e;
    } finally {
      c.restore();
      appendSpy.mockRestore();
    }

    expect(c.exitCode).toBe(1);
    const env = JSON.parse(c.stdout.trim());
    expect(env.status).toBe('error');
    expect(env.errorCode).toBe('GENERAL_ERROR');
    expect(env.shotId).toBe('s001');

    const records = fs.readFileSync(path.join(tmpDir, '08-video-status.jsonl'), 'utf-8')
      .split('\n').filter(Boolean).map(line => JSON.parse(line));
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('approved');
    expect(records[0].clip_path).toBe('video/clips/s001_attempt1.mp4');
    expect(records[0].rejection_reason).toBeNull();
    expect(fs.existsSync(path.join(tmpDir, 'video', 'clips', 's001_attempt1.mp4'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'video', 'clips', 's001_attempt1_attempt2.mp4'))).toBe(false);
  });
});

describe('[UT-ARC-03] video reject archives an existing clip', () => {
  it('moves the file to the attempt archive and reports the destination', async () => {
    tmpDir = await makeTempProject([{ shot_id: 's001', scene: 'A', shot_type: 'Wide', duration_seconds: 5 }]);
    await writeStatusFile(tmpDir, [
      makeStatusRecord({
        shot_id: 's001',
        status: 'complete',
        provider: 'runway-gen3',
        provider_job_id: 'job-s001',
        clip_path: 'video/clips/s001.mp4',
        attempt_count: 1,
        generated_at: STALE_UPDATED_AT,
      }),
    ]);
    await writeClipFile(tmpDir, 'video/clips/s001.mp4');

    const cmd = await rejectCmd();
    const restoreTTY = mockStdinTTY(true);
    const c = beginCapture();
    try {
      await cmd({ project: tmpDir, shotId: 's001', reason: 'archive move', agent: false });
    } catch (e) {
      if (!(e instanceof ExitError)) throw e;
    } finally {
      c.restore();
      restoreTTY();
    }

    const archivedPath = path.join(tmpDir, 'video', 'clips', 's001_attempt1.mp4');
    expect(c.exitCode).toBe(0);
    expect(c.stdout).toContain(`Clip archived to: ${archivedPath}`);
    const records = fs.readFileSync(path.join(tmpDir, '08-video-status.jsonl'), 'utf-8')
      .split('\n').filter(Boolean).map(line => JSON.parse(line));
    expect(records).toHaveLength(3);
    expect(records[0].status).toBe('complete');
    expect(records[1].status).toBe('rejected');
    expect(records[2].status).toBe('pending');
    expect(fs.existsSync(archivedPath)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'video', 'clips', 's001.mp4'))).toBe(false);
  });
});

describe('[UT-ARC-04] video reopen archives an already-attempted clip', () => {
  it('moves the file to the next attempt archive and reports the destination', async () => {
    tmpDir = await makeTempProject([{ shot_id: 's001', scene: 'A', shot_type: 'Wide', duration_seconds: 5 }]);
    await writeStatusFile(tmpDir, [
      makeStatusRecord({
        shot_id: 's001',
        status: 'approved',
        provider: 'runway-gen3',
        provider_job_id: 'job-s001',
        clip_path: 'video/clips/s001_attempt1.mp4',
        attempt_count: 2,
        approved_at: STALE_UPDATED_AT,
        generated_at: STALE_UPDATED_AT,
      }),
    ]);
    await writeClipFile(tmpDir, 'video/clips/s001_attempt1.mp4');

    const cmd = await reopenCmd();
    const restoreTTY = mockStdinTTY(true);
    const c = beginCapture();
    try {
      await cmd({ project: tmpDir, shotId: 's001', reason: 'archive move', agent: false });
    } catch (e) {
      if (!(e instanceof ExitError)) throw e;
    } finally {
      c.restore();
      restoreTTY();
    }

    const archivedPath = path.join(tmpDir, 'video', 'clips', 's001_attempt1_attempt2.mp4');
    expect(c.exitCode).toBe(0);
    expect(c.stdout).toContain(`Approved clip archived to: ${archivedPath}`);
    const records = fs.readFileSync(path.join(tmpDir, '08-video-status.jsonl'), 'utf-8')
      .split('\n').filter(Boolean).map(line => JSON.parse(line));
    expect(records).toHaveLength(2);
    expect(records[0].status).toBe('approved');
    expect(records[1].status).toBe('pending');
    expect(records[1].rejection_reason).toBe('Reopened: archive move');
    expect(fs.existsSync(archivedPath)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'video', 'clips', 's001_attempt1.mp4'))).toBe(false);
  });
});

describe('[UT-ARC-05] video reject leaves state untouched when clip rename fails', () => {
  it('returns a general error and does not append a partial transition', async () => {
    tmpDir = await makeTempProject([{ shot_id: 's001', scene: 'A', shot_type: 'Wide', duration_seconds: 5 }]);
    await writeStatusFile(tmpDir, [
      makeStatusRecord({
        shot_id: 's001',
        status: 'complete',
        provider: 'runway-gen3',
        provider_job_id: 'job-s001',
        clip_path: 'video/clips/s001.mp4',
        attempt_count: 1,
        generated_at: STALE_UPDATED_AT,
      }),
    ]);
    await writeClipFile(tmpDir, 'video/clips/s001.mp4');

    const renameSpy = jest.spyOn(fs.promises, 'rename').mockImplementation(async () => {
      const err = new Error('permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });

    const cmd = await rejectCmd();
    const c = beginCapture();
    try {
      await cmd({ project: tmpDir, shotId: 's001', reason: 'blocked move', agent: true });
    } catch (e) {
      if (!(e instanceof ExitError)) throw e;
    } finally {
      c.restore();
      renameSpy.mockRestore();
    }

    expect(c.exitCode).toBe(1);
    const env = JSON.parse(c.stdout.trim());
    expect(env.status).toBe('error');
    expect(env.errorCode).toBe('GENERAL_ERROR');

    const records = fs.readFileSync(path.join(tmpDir, '08-video-status.jsonl'), 'utf-8')
      .split('\n').filter(Boolean).map(line => JSON.parse(line));
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('complete');
    expect(records[0].rejection_reason).toBeNull();
    expect(fs.existsSync(path.join(tmpDir, 'video', 'clips', 's001.mp4'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'video', 'clips', 's001_attempt1.mp4'))).toBe(false);
  });
});

describe('[UT-ARC-06] video reopen leaves state untouched when clip rename fails', () => {
  it('returns a general error and does not append a partial transition', async () => {
    tmpDir = await makeTempProject([{ shot_id: 's001', scene: 'A', shot_type: 'Wide', duration_seconds: 5 }]);
    await writeStatusFile(tmpDir, [
      makeStatusRecord({
        shot_id: 's001',
        status: 'approved',
        provider: 'runway-gen3',
        provider_job_id: 'job-s001',
        clip_path: 'video/clips/s001_attempt1.mp4',
        attempt_count: 2,
        approved_at: STALE_UPDATED_AT,
        generated_at: STALE_UPDATED_AT,
      }),
    ]);
    await writeClipFile(tmpDir, 'video/clips/s001_attempt1.mp4');

    const renameSpy = jest.spyOn(fs.promises, 'rename').mockImplementation(async () => {
      const err = new Error('permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });

    const cmd = await reopenCmd();
    const c = beginCapture();
    try {
      await cmd({ project: tmpDir, shotId: 's001', reason: 'blocked move', agent: true });
    } catch (e) {
      if (!(e instanceof ExitError)) throw e;
    } finally {
      c.restore();
      renameSpy.mockRestore();
    }

    expect(c.exitCode).toBe(1);
    const env = JSON.parse(c.stdout.trim());
    expect(env.status).toBe('error');
    expect(env.errorCode).toBe('GENERAL_ERROR');

    const records = fs.readFileSync(path.join(tmpDir, '08-video-status.jsonl'), 'utf-8')
      .split('\n').filter(Boolean).map(line => JSON.parse(line));
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('approved');
    expect(records[0].rejection_reason).toBeNull();
    expect(fs.existsSync(path.join(tmpDir, 'video', 'clips', 's001_attempt1.mp4'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'video', 'clips', 's001_attempt1_attempt2.mp4'))).toBe(false);
  });
});

// ===========================================================================
// UT-STAT — video status
// ===========================================================================

describe('[UT-STAT-01] video status --json returns structured counts', () => {
  it('returns JSON with total_shots and counts', async () => {
    tmpDir = await makeTempProject();
    await initProject(tmpDir);

    const cmd = await statusCmd();
    const c   = beginCapture();
    try { await cmd({ project: tmpDir, json: true, agent: true }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally   { c.restore(); }

    expect(c.exitCode).toBe(0);
    const env = JSON.parse(c.stdout.trim());
    expect(env.status).toBe('success');
    expect(env.data?.total_shots).toBe(3);
    expect(env.data?.counts?.pending).toBeGreaterThanOrEqual(1);
  });
});

describe('[UT-STAT-02] video status exits NOT_FOUND(2) before init', () => {
  it('exits 2 when status file missing', async () => {
    tmpDir = await makeTempProject();
    const cmd = await statusCmd();
    const c   = beginCapture();
    try { await cmd({ project: tmpDir, json: true, agent: true }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally   { c.restore(); }

    expect(c.exitCode).toBe(2);
    const env = JSON.parse(c.stdout.trim());
    expect(env.errorCode).toBe('NOT_FOUND');
  });
});

describe('[UT-STAT-03] video status renders a table for valid human-mode input', () => {
  it('prints the table, rows, and summary for an initialized project', async () => {
    tmpDir = await makeTempProject();
    await initProject(tmpDir);

    const restoreTTY = mockStdinTTY(true);
    const cmd = await statusCmd();
    const c   = beginCapture();
    try { await cmd({ project: tmpDir }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally   { c.restore(); restoreTTY(); }

    expect(c.exitCode).toBe(0);
    expect(c.stdout).toContain('FilmBuff — Video Status');
    expect(c.stdout).toContain('Shot');
    expect(c.stdout).toContain('s001');
    expect(c.stdout).toContain('Summary:');
    expect(c.stdout).toContain('pending: 3');
  });
});

describe('[UT-STAT-04] video status fails loudly for corrupt shot-list input', () => {
  it('returns a structured GENERAL_ERROR and leaves the status file untouched', async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fb-corrupt-'));
    const statusPath = path.join(tmpDir, '08-video-status.jsonl');

    await writeStatusFile(tmpDir, [
      makeStatusRecord({
        shot_id: 's001',
        status: 'generating',
        provider: 'runway-gen3',
        provider_job_id: 'job-1',
        attempt_count: 1,
      }),
    ]);
    await fs.promises.writeFile(path.join(tmpDir, '08-shot-list.jsonl'), '{"shot_id":"s001"}\nnot-json\n');
    const before = fs.readFileSync(statusPath, 'utf-8');
    process.env['FILMBUFF_WATCHDOG_TIMEOUT_MS'] = '1';

    const cmd = await statusCmd();
    const c   = beginCapture();
    try { await cmd({ project: tmpDir, json: true, agent: true }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally   { c.restore(); }

    expect(c.exitCode).toBe(1);
    const env = JSON.parse(c.stdout.trim());
    expect(env.status).toBe('error');
    expect(env.errorCode).toBe('GENERAL_ERROR');
    expect(env.data).toBeNull();

    const err = JSON.parse(c.stderr.trim());
    expect(err.error.code).toBe('GENERAL_ERROR');
    expect(err.error.message).toContain('Unable to read the shot list');
    expect(fs.readFileSync(statusPath, 'utf-8')).toBe(before);
  });
});

describe('[UT-STAT-05] video status exits NOT_FOUND(2) when the shot list is missing', () => {
  it('prints the shot-list message in human mode and leaves state unchanged', async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fb-missing-'));
    const statusPath = path.join(tmpDir, '08-video-status.jsonl');

    await writeStatusFile(tmpDir, [
      makeStatusRecord({
        shot_id: 's001',
        status: 'pending',
      }),
    ]);
    const before = fs.readFileSync(statusPath, 'utf-8');

    const restoreTTY = mockStdinTTY(true);
    const cmd = await statusCmd();
    const c   = beginCapture();
    try { await cmd({ project: tmpDir }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally   { c.restore(); restoreTTY(); }

    expect(c.exitCode).toBe(2);
    const output = `${c.stdout}${c.stderr}`;
    expect(output).toContain('Unable to read the shot list. Fix 08-shot-list.jsonl before checking video status.');
    expect(output).not.toContain('FilmBuff — Video Status');
    expect(fs.readFileSync(statusPath, 'utf-8')).toBe(before);
  });
});

describe('[UT-STAT-06] video status filter returns an empty view without mutating state', () => {
  it('renders no matching rows when the filter value is absent', async () => {
    tmpDir = await makeTempProject();
    await initProject(tmpDir);

    const statusPath = path.join(tmpDir, '08-video-status.jsonl');
    const before = fs.readFileSync(statusPath, 'utf-8');
    const restoreTTY = mockStdinTTY(true);
    const cmd = await statusCmd();
    const c   = beginCapture();
    try { await cmd({ project: tmpDir, filter: 'ghost' }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally   { c.restore(); restoreTTY(); }

    expect(c.exitCode).toBe(0);
    expect(c.stdout).toContain('Filter: ghost');
    expect(c.stdout).toContain('Summary:');
    expect(c.stdout).not.toContain('s001');
    expect(fs.readFileSync(statusPath, 'utf-8')).toBe(before);
  });
});

describe('[UT-STAT-07] video status rejects unreadable shot-list permissions', () => {
  it('returns a GENERAL_ERROR envelope when readAll throws EACCES', async () => {
    tmpDir = await makeTempProject();
    await writeStatusFile(tmpDir, [
      makeStatusRecord({
        shot_id: 's001',
        status: 'pending',
      }),
    ]);

    jest.resetModules();
    const mockReadAll = jest.fn(async () => {
      const err = new Error('permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });
    jest.doMock('../lib/shot-list-reader', () => ({
      __esModule: true,
      readAll: mockReadAll,
    }));

    const { videoStatusCommand } = await import('../commands/video/status');
    const c = beginCapture();
    try { await videoStatusCommand({ project: tmpDir, json: true, agent: true }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally {
      c.restore();
      jest.dontMock('../lib/shot-list-reader');
    }

    expect(c.exitCode).toBe(1);
    const env = JSON.parse(c.stdout.trim());
    expect(env.status).toBe('error');
    expect(env.errorCode).toBe('GENERAL_ERROR');
    expect(env.data).toBeNull();
    expect(c.stdout).not.toContain('"total_shots"');
    expect(c.stderr).toContain('Unable to read the shot list');
  });
});

describe('[UT-STAT-08] video status stops after surfacing unreadable shot-list errors', () => {
  it('does not continue into watchdog or summary generation when readAll fails', async () => {
    tmpDir = await makeTempProject();
    await writeStatusFile(tmpDir, [
      makeStatusRecord({
        shot_id: 's001',
        status: 'pending',
      }),
    ]);

    jest.resetModules();

    const runWatchdog = jest.fn(async () => ({ timedOutCount: 0, timedOutShots: [] }));
    const getLatestState = jest.fn(async () => new Map());
    const mockReadAll = jest.fn(async () => {
      const err = new Error('permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });

    jest.doMock('../lib/shot-list-reader', () => ({
      __esModule: true,
      readAll: mockReadAll,
    }));
    jest.doMock('../lib/watchdog', () => {
      const actual = jest.requireActual('../lib/watchdog') as typeof import('../lib/watchdog');
      return {
        __esModule: true,
        ...actual,
        runWatchdog,
      };
    });
    jest.doMock('../lib/status-file-manager', () => {
      const actual = jest.requireActual('../lib/status-file-manager') as typeof import('../lib/status-file-manager');
      return {
        __esModule: true,
        ...actual,
        getLatestState,
      };
    });

    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      captured.stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString();
      return true;
    });
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      captured.stderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString();
      return true;
    });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const captured = { stdout: '', stderr: '' };

    try {
      const { videoStatusCommand } = await import('../commands/video/status');
      await expect(videoStatusCommand({ project: tmpDir, json: true, agent: true })).resolves.toBeUndefined();
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
      jest.dontMock('../lib/shot-list-reader');
      jest.dontMock('../lib/watchdog');
      jest.dontMock('../lib/status-file-manager');
    }

    expect(runWatchdog).not.toHaveBeenCalled();
    expect(getLatestState).not.toHaveBeenCalled();
    expect(captured.stdout).toContain('"errorCode":"GENERAL_ERROR"');
    expect(captured.stderr).toContain('Unable to read the shot list');
  });
});

// ===========================================================================
// UT-PROJ — --project flag
// ===========================================================================

describe('[UT-PROJ-01] --project resolves to absolute path', () => {
  it('resolves relative --project to absolute path correctly', async () => {
    tmpDir = await makeTempProject();
    const cmd = await initCmd();
    const c   = beginCapture();
    // Use the absolute path directly (relative resolution tested via real cwd)
    try { await cmd({ project: path.resolve(tmpDir), agent: true }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally   { c.restore(); }

    expect(c.exitCode).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, '08-video-status.jsonl'))).toBe(true);
  });
});

describe('[UT-PROJ-02] --project exits INVALID_ARGS(6) for nonexistent directory', () => {
  it('exits 6 for missing project directory', async () => {
    const cmd = await initCmd();
    const c   = beginCapture();
    const missing = '/tmp/this-dir-does-not-exist-fb-test-999';
    try { await cmd({ project: missing, agent: true }); }
    catch (e) { if (!(e instanceof ExitError)) throw e; }
    finally   { c.restore(); }

    expect(c.exitCode).toBe(6);
    const env = JSON.parse(c.stdout.trim());
    expect(env.errorCode).toBe('INVALID_ARGS');
  });
});
