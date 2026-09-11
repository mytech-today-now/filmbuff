/**
 * cli/src/__tests__/video-compile.test.ts
 *
 * Regression tests for `video compile` package output.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { VideoStatusRecord } from '../lib/shot-state-machine';

type ExecCallback = (err: Error | null, stdout?: string, stderr?: string) => void;

class ExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
    this.name = 'ExitError';
  }
}

const CLIP_FIXTURE = path.resolve(
  __dirname,
  '../../../output/wizard-in-the-engine-room/wizard-in-the-engine-room.mp4',
);

jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

jest.mock('archiver', () => {
  return () => {
    let output: NodeJS.WritableStream | undefined;
    let errorHandler: ((err?: Error) => void) | undefined;
    const entries: Array<{ source: string; name: string }> = [];

    const api = {
      on(event: string, handler: (err?: Error) => void) {
        if (event === 'error') {
          errorHandler = handler;
        }
        return api;
      },
      pipe(dest: NodeJS.WritableStream) {
        output = dest;
        return api;
      },
      file(source: string, meta: { name: string }) {
        entries.push({ source, name: meta.name });
        return api;
      },
      finalize() {
        void (async () => {
          try {
            const JSZip = require('jszip') as typeof import('jszip');
            const zip = new JSZip();
            for (const entry of entries) {
              zip.file(entry.name, await fs.promises.readFile(entry.source));
            }
            const buffer = await zip.generateAsync({
              type: 'nodebuffer',
              compression: 'STORE',
            });
            output?.end(buffer);
          } catch (err) {
            errorHandler?.(err as Error);
            const writable = output as (NodeJS.WritableStream & { destroy?: (err?: Error) => void }) | undefined;
            writable?.destroy?.(err as Error);
          }
        })();
      },
    };

    return api;
  };
}, { virtual: true });

interface CompileScenario {
  clipNames: [string, string];
  outputDirParts?: string[];
}

interface CompileResult {
  projectDir: string;
  outputDir: string;
  extractedDir: string;
  videoSrcs: string[];
  zipEntries: string[];
  envelope: {
    status: 'success' | 'error';
    data: {
      clips_compiled: number;
      combined_mp4: string;
      index_html: string;
      project_zip: string;
      output_dir: string;
    } | null;
  };
}

const tempDirs: string[] = [];

function beginCapture() {
  const state = {
    stdout: '',
    stderr: '',
    exitCode: undefined as number | undefined,
  };

  const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    state.stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString();
    return true;
  });
  const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    state.stderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString();
    return true;
  });
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code?) => {
    state.exitCode = (code as number) ?? 0;
    throw new ExitError((code as number) ?? 0);
  }) as jest.SpyInstance;

  return {
    get stdout() { return state.stdout; },
    get stderr() { return state.stderr; },
    get exitCode() { return state.exitCode; },
    restore() {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    },
  };
}

function rememberTempDir(dir: string): void {
  tempDirs.push(dir);
}

function makeApprovedRecord(shotId: string, clipName: string): VideoStatusRecord {
  const now = '2026-09-10T00:00:00.000Z';
  return {
    shot_id: shotId,
    status: 'approved',
    provider: 'runway-gen3',
    provider_job_id: `job-${shotId}`,
    clip_path: path.posix.join('video', 'clips', clipName),
    attempt_count: 1,
    rejection_reason: null,
    approved_at: now,
    rejected_at: null,
    generated_at: now,
    failed_at: null,
    credits_spent: 5,
    updated_at: now,
  };
}

async function linkClipFixture(targetPath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.promises.link(CLIP_FIXTURE, targetPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EXDEV' || code === 'EPERM' || code === 'EACCES') {
      await fs.promises.copyFile(CLIP_FIXTURE, targetPath);
      return;
    }
    throw err;
  }
}

async function extractZipToDir(zipBuffer: Buffer, destDir: string): Promise<{ zipEntries: string[] }> {
  const JSZip = require('jszip') as typeof import('jszip');
  const zip = await JSZip.loadAsync(zipBuffer);
  const zipEntries = Object.keys(zip.files).filter((name) => !name.endsWith('/'));

  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const outPath = path.join(destDir, name);
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    const data = await entry.async('nodebuffer');
    await fs.promises.writeFile(outPath, data);
  }

  return { zipEntries };
}

function extractVideoSrcs(indexHtml: string): string[] {
  return [...indexHtml.matchAll(/<video[^>]*src="([^"]+)"/g)].map((match) => match[1]);
}

async function createProject(scenario: CompileScenario): Promise<{ projectDir: string; outputDir: string }> {
  if (!fs.existsSync(CLIP_FIXTURE)) {
    throw new Error(`Missing clip fixture: ${CLIP_FIXTURE}`);
  }

  const projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fb-compile-'));
  rememberTempDir(projectDir);
  const outputDir = scenario.outputDirParts
    ? path.join(projectDir, ...scenario.outputDirParts)
    : path.join(projectDir, 'video', 'output');

  const clipsDir = path.join(projectDir, 'video', 'clips');
  await fs.promises.mkdir(clipsDir, { recursive: true });

  const shotListLines = scenario.clipNames.map((_, index) => JSON.stringify({
    shot_id: `s00${index + 1}`,
    scene: 'INT. EDIT SUITE - DAY',
    shot_type: index === 0 ? 'Wide' : 'Close-Up',
    duration_seconds: 5,
  })).join('\n') + '\n';
  await fs.promises.writeFile(path.join(projectDir, '08-shot-list.jsonl'), shotListLines, 'utf-8');

  const records = scenario.clipNames.map((clipName, index) => makeApprovedRecord(`s00${index + 1}`, clipName));
  await fs.promises.writeFile(
    path.join(projectDir, '08-video-status.jsonl'),
    records.map((record) => JSON.stringify(record)).join('\n') + '\n',
    'utf-8',
  );

  for (const clipName of scenario.clipNames) {
    await linkClipFixture(path.join(clipsDir, clipName));
  }

  return { projectDir, outputDir };
}

function getExecMock(): jest.Mock {
  return (jest.requireMock('child_process') as { exec: jest.Mock }).exec;
}

async function handleMockExec(command: string): Promise<void> {
  const outputMatch = [...command.matchAll(/"([^"]+\.mp4)"/g)].at(-1);
  if (!outputMatch) return;

  const outputPath = outputMatch[1];
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.promises.writeFile(outputPath, Buffer.from('mock mp4 output', 'utf-8'));
}

async function compileScenario(scenario: CompileScenario): Promise<CompileResult> {
  const { projectDir, outputDir } = await createProject(scenario);
  const extractedDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fb-extract-'));
  rememberTempDir(extractedDir);

  const capture = beginCapture();
  try {
    const { videoCompileCommand } = await import('../commands/video/compile');
    await videoCompileCommand({
      project: projectDir,
      outputDir,
      agent: true,
    });
  } catch (err) {
    if (!(err instanceof ExitError)) throw err;
  } finally {
    capture.restore();
  }

  expect(capture.exitCode).toBe(0);

  const envelope = JSON.parse(capture.stdout.trim()) as CompileResult['envelope'];
  expect(envelope.status).toBe('success');
  expect(envelope.data?.clips_compiled).toBe(scenario.clipNames.length);

  const zipPath = path.join(outputDir, 'project.zip');
  const zipBuffer = await fs.promises.readFile(zipPath);
  const { zipEntries } = await extractZipToDir(zipBuffer, extractedDir);
  const indexHtml = await fs.promises.readFile(path.join(extractedDir, 'index.html'), 'utf-8');
  const videoSrcs = extractVideoSrcs(indexHtml);

  return {
    projectDir,
    outputDir,
    extractedDir,
    videoSrcs,
    zipEntries,
    envelope,
  };
}

beforeEach(() => {
  jest.resetModules();
  getExecMock().mockImplementation((command: string, callback: ExecCallback) => {
    void handleMockExec(command)
      .then(() => callback(null, '', ''))
      .catch((err) => callback(err as Error, '', ''));
  });
});

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Regression tests
// ---------------------------------------------------------------------------

describe('[UT-VCOMP-01] compile viewer paths match the packaged clips folder', () => {
  it('writes index.html src values that resolve inside the extracted zip', async () => {
    const scenario: CompileScenario = {
      clipNames: ['lead.mp4', 'final.mp4'],
    };
    const result = await compileScenario(scenario);

    expect(result.videoSrcs).toEqual(['clips/lead.mp4', 'clips/final.mp4']);
    expect(result.zipEntries).toEqual(expect.arrayContaining([
      'index.html',
      'combined.mp4',
      'clips/lead.mp4',
      'clips/final.mp4',
      '08-shot-list.jsonl',
      '08-video-status.jsonl',
    ]));

    for (const src of result.videoSrcs) {
      expect(fs.existsSync(path.resolve(result.extractedDir, src))).toBe(true);
    }

    const firstClip = path.resolve(result.extractedDir, result.videoSrcs[0]);
    const lastClip = path.resolve(result.extractedDir, result.videoSrcs[result.videoSrcs.length - 1]);
    expect(fs.statSync(firstClip).size).toBeGreaterThan(0);
    expect(fs.statSync(lastClip).size).toBeGreaterThan(0);
  });
});

describe('[UT-VCOMP-02] compile viewer handles spaces and nested output directories', () => {
  it('keeps clip paths valid when clip names include spaces and output is nested', async () => {
    const scenario: CompileScenario = {
      clipNames: ['Lead Clip.mp4', 'Final Clip.mp4'],
      outputDirParts: ['video', 'output', 'review-pack'],
    };
    const result = await compileScenario(scenario);

    expect(result.outputDir).toContain(path.join('video', 'output', 'review-pack'));
    expect(result.videoSrcs).toEqual(['clips/Lead Clip.mp4', 'clips/Final Clip.mp4']);
    expect(result.zipEntries).toEqual(expect.arrayContaining([
      'index.html',
      'combined.mp4',
      'clips/Lead Clip.mp4',
      'clips/Final Clip.mp4',
    ]));

    for (const src of result.videoSrcs) {
      expect(fs.existsSync(path.resolve(result.extractedDir, src))).toBe(true);
    }
  });
});
