import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ExecFileOptions } from 'child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock('child_process', () => ({ execFile: execFileMock }));

import { videoCompileCommand } from '../../../cli/src/commands/video/compile';

interface CompileShot {
  shotId: string;
  scene: string;
  clipName: string;
}

interface FfmpegInvocation {
  args: string[];
  outputPath: string;
  sceneText?: string;
  isConcat: boolean;
}

interface CompileRunOptions {
  agentMode?: boolean;
  titleCards?: boolean;
}

interface CompileRunResult {
  exitCode: number | undefined;
  stdout: string;
  stderr: string;
  concatText: string;
  invocations: FfmpegInvocation[];
  envelope?: { status: string; data: { clips_compiled: number } | null };
}

type ExecFileCallback = (error: Error | null, stdout?: string, stderr?: string) => void;

class CompileExit extends Error {
  constructor(readonly code: number) {
    super('process.exit(' + code + ')');
  }
}

const temporaryDirectories: string[] = [];
const ffmpegInvocations: FfmpegInvocation[] = [];
let failingTitleScene: string | undefined;

async function createProject(shots: CompileShot[]): Promise<string> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fb-compile-title-cards-'));
  temporaryDirectories.push(projectDir);
  const clipsDir = path.join(projectDir, 'video', 'clips');
  await fs.mkdir(clipsDir, { recursive: true });

  const shotList = shots.map(shot => JSON.stringify({
    shot_id: shot.shotId,
    scene: shot.scene,
  })).join('\n') + '\n';
  const statuses = shots.map(shot => ({
    shot_id: shot.shotId,
    status: 'approved',
    clip_path: path.posix.join('video', 'clips', shot.clipName),
  }));

  await fs.writeFile(path.join(projectDir, '08-shot-list.jsonl'), shotList, 'utf-8');
  await fs.writeFile(
    path.join(projectDir, '08-video-status.jsonl'),
    statuses.map(status => JSON.stringify(status)).join('\n') + '\n',
    'utf-8',
  );
  for (const shot of shots) {
    await fs.writeFile(path.join(clipsDir, shot.clipName), 'mock input clip');
  }
  return projectDir;
}

function asOutputText(chunk: unknown): string {
  return typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf-8');
}

async function runCompile(
  shots: CompileShot[],
  options: CompileRunOptions = {},
): Promise<CompileRunResult> {
  const projectDir = await createProject(shots);
  const outputDir = path.join(projectDir, 'video', 'output');
  const agentMode = options.agentMode ?? true;
  const invocationStart = ffmpegInvocations.length;
  const stdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  let stdout = '';
  let stderr = '';
  let exitCode: number | undefined;

  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    stdout += asOutputText(chunk);
    return true;
  }) as never);
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    stderr += asOutputText(chunk);
    return true;
  }) as never);
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code ?? 0;
    throw new CompileExit(exitCode);
  }) as never);

  try {
    if (!agentMode) {
      Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    }
    try {
      await videoCompileCommand({
        project: projectDir,
        outputDir,
        titleCards: options.titleCards ?? true,
        agent: agentMode,
      });
    } catch (error) {
      if (!(error instanceof CompileExit)) throw error;
    }
  } finally {
    if (!agentMode) {
      if (stdinIsTTY) {
        Object.defineProperty(process.stdin, 'isTTY', stdinIsTTY);
      } else {
        Reflect.deleteProperty(process.stdin, 'isTTY');
      }
    }
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  }

  return {
    exitCode,
    stdout,
    stderr,
    concatText: await fs.readFile(path.join(outputDir, 'concat.txt'), 'utf-8'),
    invocations: ffmpegInvocations.slice(invocationStart),
    envelope: agentMode ? JSON.parse(stdout.trim()) as CompileRunResult['envelope'] : undefined,
  };
}

describe('video compile title cards', () => {
  beforeEach(() => {
    vi.stubEnv('FILMBUFF_AGENT_MODE', '0');
    ffmpegInvocations.length = 0;
    failingTitleScene = undefined;
    execFileMock.mockReset();
    execFileMock.mockImplementation((
      _command: string,
      args: string[],
      options: ExecFileOptions,
      callback: ExecFileCallback,
    ) => {
      void (async () => {
        const cwd = typeof options.cwd === 'string' ? options.cwd : process.cwd();
        const outputPath = path.resolve(cwd, args[args.length - 1]);
        const filterIndex = args.indexOf('-vf');
        let sceneText: string | undefined;
        if (filterIndex >= 0) {
          const textFileName = args[filterIndex + 1]?.match(/textfile=([^:]+)/)?.[1];
          if (textFileName) sceneText = await fs.readFile(path.resolve(cwd, textFileName), 'utf-8');
        }

        ffmpegInvocations.push({
          args: [...args],
          outputPath,
          sceneText,
          isConcat: args.includes('concat'),
        });
        if (sceneText !== undefined && sceneText === failingTitleScene) {
          callback(new Error('controlled title-card rendering failure'), '', '');
          return;
        }

        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, 'mock mp4 output');
        callback(null, '', '');
      })().catch(error => {
        callback(error instanceof Error ? error : new Error(String(error)), '', '');
      });
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    execFileMock.mockReset();
    for (const dir of temporaryDirectories.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('renders one card at every scene boundary and only one for consecutive shots in a scene', async () => {
    const scenes = [
      'INT. CONTROL ROOM - NIGHT',
      'INT. CONTROL ROOM - NIGHT',
      'EXT. CITY STREET - DAWN',
      'EXT. CITY STREET - DAWN',
      'INT. ARCHIVE - DAY',
    ];
    const shots = scenes.map((scene, index) => ({
      shotId: 's00' + (index + 1),
      scene,
      clipName: 'clip-' + (index + 1) + '.mp4',
    }));

    const result = await runCompile(shots);
    const titleCards = result.invocations.filter(invocation => invocation.sceneText !== undefined);
    expect(result.exitCode).toBe(0);
    expect(result.envelope).toMatchObject({ status: 'success', data: { clips_compiled: shots.length } });
    expect(titleCards.map(invocation => invocation.sceneText)).toEqual([
      'INT. CONTROL ROOM - NIGHT',
      'EXT. CITY STREET - DAWN',
      'INT. ARCHIVE - DAY',
    ]);
    expect(result.concatText.match(/title_[0-9]{4}\.mp4/g)).toEqual([
      'title_0000.mp4',
      'title_0001.mp4',
      'title_0002.mp4',
    ]);
    expect(result.stderr).not.toContain('card was omitted');
  });

  it('warns human and agent callers when a failed title card is omitted and concat succeeds', async () => {
    const scene = 'INT. CONTROL ROOM - NIGHT';
    const shots = [
      { shotId: 's001', scene, clipName: 'clip-1.mp4' },
      { shotId: 's002', scene, clipName: 'clip-2.mp4' },
    ];
    failingTitleScene = scene;
    const agentResult = await runCompile(shots, { agentMode: true });
    const humanResult = await runCompile(shots, { agentMode: false });
    const expectedWarning = 'Could not render requested title card for scene '
      + JSON.stringify(scene)
      + '; the card was omitted.';

    expect(agentResult.exitCode).toBe(0);
    expect(agentResult.envelope?.status).toBe('success');
    expect(agentResult.stderr).toContain(expectedWarning);
    expect(agentResult.invocations.filter(invocation => invocation.isConcat)).toHaveLength(1);
    expect(agentResult.concatText).not.toContain('title_');
    expect(agentResult.concatText).toContain('clip-1.mp4');
    expect(agentResult.concatText).toContain('clip-2.mp4');
    expect(humanResult.exitCode).toBe(0);
    expect(humanResult.stdout).toContain('Compile complete.');
    expect(humanResult.stderr).toContain(expectedWarning);
    expect(humanResult.invocations.filter(invocation => invocation.isConcat)).toHaveLength(1);
    expect(humanResult.concatText).not.toContain('title_');
  });

  it('honors --no-title-cards without rendering cards or emitting a title-card warning', async () => {
    const shots = [
      { shotId: 's001', scene: 'INT. CONTROL ROOM - NIGHT', clipName: 'clip-1.mp4' },
      { shotId: 's002', scene: 'EXT. CITY STREET - DAWN', clipName: 'clip-2.mp4' },
    ];
    const result = await runCompile(shots, { agentMode: true, titleCards: false });
    expect(result.exitCode).toBe(0);
    expect(result.envelope?.status).toBe('success');
    expect(result.invocations.filter(invocation => invocation.sceneText !== undefined)).toHaveLength(0);
    expect(result.invocations.filter(invocation => invocation.isConcat)).toHaveLength(1);
    expect(result.concatText).not.toContain('title_');
    expect(result.stderr).not.toContain('title card');
    expect(result.stderr).not.toContain('card was omitted');
  });
});
