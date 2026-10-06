import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  archiveClipAndAppendLifecycleTransition,
  getLatestState,
  readAllRecords,
  type LifecycleCheckpoint,
  type LifecycleTransitionFaultInjector,
} from '../../../cli/src/lib/status-file-manager';
import { transition, type VideoStatusRecord } from '../../../cli/src/lib/shot-state-machine';
import { videoRejectCommand } from '../../../cli/src/commands/video/reject';

type Operation = 'reject' | 'reopen';

interface TestProject {
  root: string;
  clipPath: string;
  archivePath: string;
  record: VideoStatusRecord;
}

class SimulatedProcessStop extends Error {
  constructor(readonly checkpoint: LifecycleCheckpoint) {
    super(`simulated process stop at ${checkpoint}`);
  }
}

class CommandExit extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
    this.name = 'CommandExit';
  }
}

const temporaryDirectories: string[] = [];

async function createProject(operation: Operation, includeClip = true): Promise<TestProject> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fb-video-lifecycle-'));
  temporaryDirectories.push(root);
  const clipsDir = path.join(root, 'video', 'clips');
  await fs.mkdir(clipsDir, { recursive: true });
  const clipPath = path.join(clipsDir, 's001.mp4');
  const archivePath = path.join(clipsDir, 's001_attempt3.mp4');
  if (includeClip) await fs.writeFile(clipPath, 'preserved clip bytes', 'utf-8');

  const record: VideoStatusRecord = {
    shot_id: 's001',
    status: operation === 'reject' ? 'complete' : 'approved',
    provider: 'runway-gen3',
    provider_job_id: 'job-s001',
    clip_path: 'video/clips/s001.mp4',
    attempt_count: 3,
    rejection_reason: null,
    approved_at: operation === 'reopen' ? '2026-10-01T12:00:00.000Z' : null,
    rejected_at: null,
    generated_at: '2026-10-01T11:00:00.000Z',
    failed_at: null,
    credits_spent: 17,
    updated_at: '2026-10-01T12:00:00.000Z',
  };
  await fs.writeFile(
    path.join(root, '08-video-status.jsonl'),
    `${JSON.stringify(record)}\n`,
    'utf-8',
  );
  return { root, clipPath, archivePath, record };
}

function plannedRecords(operation: Operation, record: VideoStatusRecord): VideoStatusRecord[] {
  return operation === 'reject'
    ? transition(record, 'REJECT', {
      rejection_reason: 'test rejection',
      now: '2026-10-06T12:00:00.000Z',
    })
    : transition(record, 'REOPEN', { now: '2026-10-06T12:00:00.000Z' });
}

async function runTransition(
  project: TestProject,
  operation: Operation,
  faultInjector?: LifecycleTransitionFaultInjector,
): Promise<void> {
  await archiveClipAndAppendLifecycleTransition(
    project.root,
    project.record,
    operation,
    plannedRecords(operation, project.record),
    faultInjector,
  );
}

async function expectConverged(project: TestProject, operation: Operation): Promise<void> {
  const latest = (await getLatestState(project.root)).get('s001');
  const expectedStatuses = operation === 'reject'
    ? ['complete', 'complete', 'rejected', 'pending']
    : ['approved', 'approved', 'pending'];
  const expectedCommitCount = operation === 'reject' ? 2 : 1;
  const records = await readAllRecords(project.root);
  expect(records.map(record => record.status)).toEqual(expectedStatuses);

  const commits = records.filter(record => record.lifecycle_operation?.kind === 'commit');
  expect(commits).toHaveLength(expectedCommitCount);
  expect(new Set(commits.map(record =>
    record.lifecycle_operation?.kind === 'commit'
      ? `${record.lifecycle_operation.operation_id}:${record.lifecycle_operation.step}`
      : '',
  )).size).toBe(expectedCommitCount);
  expect(commits.every(record => record.attempt_count === 3 && record.credits_spent === 17)).toBe(true);

  expect(latest).toMatchObject({ status: 'pending', attempt_count: 3, credits_spent: 17 });
  await expect(fs.stat(project.clipPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fs.readFile(project.archivePath, 'utf-8')).resolves.toBe('preserved clip bytes');

  const recordCount = (await readAllRecords(project.root)).length;
  await getLatestState(project.root);
  await getLatestState(project.root);
  expect(await readAllRecords(project.root)).toHaveLength(recordCount);
}

describe('reject and reopen crash recovery', () => {
  beforeEach(() => {
    temporaryDirectories.length = 0;
  });

  afterEach(async () => {
    await Promise.all(temporaryDirectories.map(directory =>
      fs.rm(directory, { recursive: true, force: true }),
    ));
  });

  it.each(['reject', 'reopen'] as const)('completes a normal %s transition', async operation => {
    const project = await createProject(operation);
    await runTransition(project, operation);
    await expectConverged(project, operation);
  });

  it.each([
    ['reject', 'after-intent'],
    ['reject', 'after-archive'],
    ['reject', 'after-status-append'],
    ['reopen', 'after-intent'],
    ['reopen', 'after-archive'],
    ['reopen', 'after-status-append'],
  ] as const)('recovers %s after interruption at %s', async (operation, checkpoint) => {
    const project = await createProject(operation);
    const simulatedStop = new SimulatedProcessStop(checkpoint);
    const faultInjector: LifecycleTransitionFaultInjector = {
      afterCheckpoint: reached => {
        if (reached === checkpoint) throw simulatedStop;
      },
    };

    await expect(runTransition(project, operation, faultInjector)).rejects.toBe(simulatedStop);
    if (checkpoint === 'after-intent') {
      await expect(fs.readFile(project.clipPath, 'utf-8')).resolves.toBe('preserved clip bytes');
      await expect(fs.stat(project.archivePath)).rejects.toMatchObject({ code: 'ENOENT' });
    } else {
      await expect(fs.stat(project.clipPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.readFile(project.archivePath, 'utf-8')).resolves.toBe('preserved clip bytes');
    }

    // Re-entering the normal status-read path acts as the next CLI invocation.
    await expectConverged(project, operation);
  });

  it.each(['reject', 'reopen'] as const)('recovers %s if stopped between exclusive archive link and unlink', async operation => {
    const project = await createProject(operation);
    const simulatedStop = new SimulatedProcessStop('after-archive-link');
    const faultInjector: LifecycleTransitionFaultInjector = {
      moveClip: async (sourcePath, destinationPath) => {
        await fs.link(sourcePath, destinationPath);
        throw simulatedStop;
      },
    };

    await expect(runTransition(project, operation, faultInjector)).rejects.toMatchObject({
      name: 'LifecycleTransitionError',
      phase: 'recovery',
      recoveryRequired: true,
    });
    await expect(fs.readFile(project.clipPath, 'utf-8')).resolves.toBe('preserved clip bytes');
    await expect(fs.readFile(project.archivePath, 'utf-8')).resolves.toBe('preserved clip bytes');

    await expectConverged(project, operation);
  });

  it('completes a reject whose first transition record was appended before interruption', async () => {
    const project = await createProject('reject');
    const simulatedStop = new SimulatedProcessStop('after-status-append');
    const faultInjector: LifecycleTransitionFaultInjector = {
      appendTransitionRecords: async (records, persist) => {
        await persist(records.slice(0, 1));
        throw simulatedStop;
      },
    };

    await expect(runTransition(project, 'reject', faultInjector)).rejects.toMatchObject({
      name: 'LifecycleTransitionError',
      phase: 'append',
      recoveryRequired: true,
      message: expect.stringContaining('status append stopped after 1 transition record'),
    });
    await expectConverged(project, 'reject');
  });

  it.each(['reject', 'reopen'] as const)('keeps %s state when the source clip is missing', async operation => {
    const project = await createProject(operation, false);
    await runTransition(project, operation);

    const latest = (await getLatestState(project.root)).get('s001');
    expect(latest).toMatchObject({ status: 'pending', attempt_count: 3, credits_spent: 17 });
    await expect(fs.stat(project.archivePath)).rejects.toMatchObject({ code: 'ENOENT' });
    const records = await readAllRecords(project.root);
    expect(records.filter(record => record.lifecycle_operation?.kind === 'commit'))
      .toHaveLength(operation === 'reject' ? 2 : 1);
  });

  it.each(['reject', 'reopen'] as const)('reports a %s move failure without changing status', async operation => {
    const project = await createProject(operation);
    const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const faultInjector: LifecycleTransitionFaultInjector = {
      moveClip: async (sourcePath, destinationPath) => ({
        kind: 'failed',
        sourcePath,
        destinationPath,
        error: permissionError,
      }),
    };

    await expect(runTransition(project, operation, faultInjector)).rejects.toMatchObject({
      name: 'LifecycleTransitionError',
      phase: 'archive',
      message: expect.stringContaining('permission denied'),
    });
    const records = await readAllRecords(project.root);
    expect(records.at(-1)).toMatchObject({ status: project.record.status, attempt_count: 3, credits_spent: 17 });
    expect(records.filter(record => record.lifecycle_operation?.kind === 'commit')).toHaveLength(0);
    await expect(fs.readFile(project.clipPath, 'utf-8')).resolves.toBe('preserved clip bytes');
    await expect(fs.stat(project.archivePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['reject', 'reopen'] as const)('rolls back %s when the status append fails', async operation => {
    const project = await createProject(operation);
    const faultInjector: LifecycleTransitionFaultInjector = {
      appendTransitionRecords: async () => {
        throw new Error('injected status append failure');
      },
    };

    await expect(runTransition(project, operation, faultInjector)).rejects.toMatchObject({
      name: 'LifecycleTransitionError',
      phase: 'append',
      recoveryRequired: false,
      message: expect.stringContaining('restored to its original location'),
    });
    const latest = (await getLatestState(project.root)).get('s001');
    expect(latest).toMatchObject({ status: project.record.status, attempt_count: 3, credits_spent: 17 });
    expect((await readAllRecords(project.root)).filter(record =>
      record.lifecycle_operation?.kind === 'commit',
    )).toHaveLength(0);
    await expect(fs.readFile(project.clipPath, 'utf-8')).resolves.toBe('preserved clip bytes');
    await expect(fs.stat(project.archivePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['reject', 'reopen'] as const)('does not overwrite a pre-existing %s attempt clip', async operation => {
    const project = await createProject(operation);
    await fs.writeFile(project.archivePath, 'pre-existing archive bytes', 'utf-8');

    await expect(runTransition(project, operation)).rejects.toMatchObject({
      name: 'LifecycleTransitionError',
      phase: 'archive',
      message: expect.stringContaining('attempt destination already exists'),
    });
    expect(await readAllRecords(project.root)).toEqual([project.record]);
    await expect(fs.readFile(project.clipPath, 'utf-8')).resolves.toBe('preserved clip bytes');
    await expect(fs.readFile(project.archivePath, 'utf-8')).resolves.toBe('pre-existing archive bytes');
  });

  it('fails closed with the shot identifier when the interrupted archive state is inconsistent', async () => {
    const project = await createProject('reject');
    const simulatedStop = new SimulatedProcessStop('after-intent');
    await expect(runTransition(project, 'reject', {
      afterCheckpoint: () => { throw simulatedStop; },
    })).rejects.toBe(simulatedStop);

    await fs.writeFile(project.archivePath, 'unrelated archive bytes', 'utf-8');
    await expect(getLatestState(project.root)).rejects.toMatchObject({
      name: 'LifecycleTransitionError',
      phase: 'recovery',
      recoveryRequired: true,
      shotId: 's001',
      message: expect.stringContaining('shot "s001"'),
    });
    await expect(fs.readFile(project.clipPath, 'utf-8')).resolves.toBe('preserved clip bytes');
    await expect(fs.readFile(project.archivePath, 'utf-8')).resolves.toBe('unrelated archive bytes');
  });

  it('shows the recovery state and shot ID in the reject command error', async () => {
    const project = await createProject('reject');
    const simulatedStop = new SimulatedProcessStop('after-intent');
    await expect(runTransition(project, 'reject', {
      afterCheckpoint: () => { throw simulatedStop; },
    })).rejects.toBe(simulatedStop);
    await fs.writeFile(project.archivePath, 'unrelated archive bytes', 'utf-8');

    let errorOutput = '';
    const capture = (chunk: unknown): void => {
      errorOutput += typeof chunk === 'string'
        ? chunk
        : Buffer.from(chunk as Uint8Array).toString('utf-8');
    };
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      capture(chunk);
      return true;
    }) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      capture(chunk);
      return true;
    }) as never);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new CommandExit(code ?? 0);
    }) as never);

    try {
      await expect(videoRejectCommand({
        project: project.root,
        shotId: 's001',
        agent: false,
      })).rejects.toMatchObject({ name: 'CommandExit', code: 1 });
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    }

    expect(errorOutput).toContain('s001');
    expect(errorOutput).toContain('Manual recovery is required');
  });
});
