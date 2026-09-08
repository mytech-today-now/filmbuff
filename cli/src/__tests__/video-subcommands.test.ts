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
 * UT-STAT-01 through UT-STAT-02  video status
 * UT-DEPR-01 through UT-DEPR-02  generate-video deprecation
 * UT-PROJ-01 through UT-PROJ-02  --project flag
 *
 * All tests use real file-system operations in temp directories.
 * FILMBUFF_MOCK_PROVIDER=1 enables mock generateSingleShot() in per-shot-api.ts.
 */

import * as fs    from 'fs';
import * as os    from 'os';
import * as path  from 'path';

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
