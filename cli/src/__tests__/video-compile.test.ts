/**
 * cli/src/__tests__/video-compile.test.ts
 *
 * Regression tests for `video compile` package output.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { ExecFileOptions } from 'child_process';
import { DOMParser } from '@xmldom/xmldom';
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
  execFile: jest.fn(),
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
  clipNames?: string[];
  shots?: CompileShot[];
  outputDirParts?: string[];
  projectDirPrefix?: string;
}

interface CompileShot {
  shotId: string;
  scene?: string;
  clipName: string;
  shotType?: string;
}

interface CompileResult {
  projectDir: string;
  outputDir: string;
  extractedDir: string;
  indexHtml: string;
  videoSrcs: string[];
  zipEntries: string[];
  concatText: string;
  ffmpegInvocations: FfmpegInvocation[];
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

interface FfmpegInvocation {
  command: string;
  args: string[];
  cwd?: string;
  outputPath?: string;
  drawtextFilter?: string;
  textFileContents?: string;
  shell?: boolean | string;
}

const tempDirs: string[] = [];
const ffmpegInvocations: FfmpegInvocation[] = [];

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

function resolveShots(scenario: CompileScenario): CompileShot[] {
  if (scenario.shots) {
    return scenario.shots;
  }

  return (scenario.clipNames ?? []).map((clipName, index) => ({
    shotId: `s00${index + 1}`,
    scene: 'INT. EDIT SUITE - DAY',
    shotType: index === 0 ? 'Wide' : 'Close-Up',
    clipName,
  }));
}

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': '\'',
};

function parseConcatEntry(entry: string): string {
  const prefix = 'file ';
  expect(entry.startsWith(prefix)).toBe(true);

  const quotedPath = entry.slice(prefix.length);
  expect(quotedPath.startsWith("'")).toBe(true);
  expect(quotedPath.endsWith("'")).toBe(true);

  let parsed = '';
  for (let index = 1; index < quotedPath.length - 1; index += 1) {
    const char = quotedPath[index];

    if (char === "'" && quotedPath.slice(index, index + 4) === "'\\''") {
      parsed += "'";
      index += 3;
      continue;
    }

    parsed += char;
  }

  return parsed;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, (entity) => HTML_ENTITY_MAP[entity]);
}

function parseIndexHtml(indexHtml: string) {
  return new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: () => undefined,
      fatalError: () => undefined,
    },
  }).parseFromString(indexHtml, 'text/html');
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
  return [...indexHtml.matchAll(/<video[^>]*src="([^"]+)"/g)].map((match) => decodeHtmlEntities(match[1]));
}

function extractHeadingTexts(indexHtml: string): string[] {
  return [...indexHtml.matchAll(/<h3>([\s\S]*?)<\/h3>/g)].map((match) => decodeHtmlEntities(match[1]));
}

async function createProject(
  shots: CompileShot[],
  outputDirParts?: string[],
  projectDirPrefix = 'fb-compile-',
): Promise<{ projectDir: string; outputDir: string }> {
  if (!fs.existsSync(CLIP_FIXTURE)) {
    throw new Error(`Missing clip fixture: ${CLIP_FIXTURE}`);
  }

  const projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), projectDirPrefix));
  rememberTempDir(projectDir);
  const outputDir = outputDirParts
    ? path.join(projectDir, ...outputDirParts)
    : path.join(projectDir, 'video', 'output');

  const clipsDir = path.join(projectDir, 'video', 'clips');
  await fs.promises.mkdir(clipsDir, { recursive: true });

  const shotListLines = shots.map((shot, index) => JSON.stringify({
    shot_id: shot.shotId,
    scene: shot.scene ?? 'INT. EDIT SUITE - DAY',
    shot_type: shot.shotType ?? (index === 0 ? 'Wide' : 'Close-Up'),
    duration_seconds: 5,
  })).join('\n') + '\n';
  await fs.promises.writeFile(path.join(projectDir, '08-shot-list.jsonl'), shotListLines, 'utf-8');

  const records = shots.map((shot) => makeApprovedRecord(shot.shotId, shot.clipName));
  await fs.promises.writeFile(
    path.join(projectDir, '08-video-status.jsonl'),
    records.map((record) => JSON.stringify(record)).join('\n') + '\n',
    'utf-8',
  );

  for (const shot of shots) {
    await linkClipFixture(path.join(clipsDir, shot.clipName));
  }

  return { projectDir, outputDir };
}

function getExecMock(): jest.Mock {
  return (jest.requireMock('child_process') as { exec: jest.Mock }).exec;
}

function getExecFileMock(): jest.Mock {
  return (jest.requireMock('child_process') as { execFile: jest.Mock }).execFile;
}

async function handleMockExecFile(
  command: string,
  args: string[],
  options: ExecFileOptions,
): Promise<void> {
  const cwd = path.resolve((options.cwd as string | undefined) ?? process.cwd());
  const outputArg = args.at(-1);
  const outputPath = outputArg ? (path.isAbsolute(outputArg) ? outputArg : path.resolve(cwd, outputArg)) : undefined;
  const vfIndex = args.indexOf('-vf');
  const drawtextFilter = vfIndex >= 0 ? args[vfIndex + 1] : undefined;
  let textFileContents: string | undefined;

  if (drawtextFilter) {
    const match = drawtextFilter.match(/textfile=([^:]+)/);
    if (match) {
      const titleTextPath = path.resolve(cwd, match[1]);
      textFileContents = await fs.promises.readFile(titleTextPath, 'utf-8');
    }
  }

  if (outputPath) {
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.promises.writeFile(outputPath, Buffer.from('mock mp4 output', 'utf-8'));
  }

  ffmpegInvocations.push({
    command,
    args: [...args],
    cwd,
    outputPath,
    drawtextFilter,
    textFileContents,
    shell: options.shell,
  });
}

async function compileScenario(scenario: CompileScenario): Promise<CompileResult> {
  const shots = resolveShots(scenario);
  const { projectDir, outputDir } = await createProject(
    shots,
    scenario.outputDirParts,
    scenario.projectDirPrefix,
  );
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
  expect(envelope.data?.clips_compiled).toBe(shots.length);

  const zipPath = path.join(outputDir, 'project.zip');
  const zipBuffer = await fs.promises.readFile(zipPath);
  const { zipEntries } = await extractZipToDir(zipBuffer, extractedDir);
  const concatText = await fs.promises.readFile(path.join(outputDir, 'concat.txt'), 'utf-8');
  const indexHtml = await fs.promises.readFile(path.join(extractedDir, 'index.html'), 'utf-8');
  const videoSrcs = extractVideoSrcs(indexHtml);

  return {
    projectDir,
    outputDir,
    extractedDir,
    indexHtml,
    videoSrcs,
    zipEntries,
    concatText,
    ffmpegInvocations: [...ffmpegInvocations],
    envelope,
  };
}

beforeEach(() => {
  jest.resetModules();
  ffmpegInvocations.length = 0;
  getExecMock().mockImplementation(() => {
    throw new Error('exec() should not be called by video compile');
  });
  getExecFileMock().mockImplementation((
    command: string,
    args: string[],
    options: ExecFileOptions,
    callback: ExecCallback,
  ) => {
    void handleMockExecFile(command, args, options)
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
    expect(result.indexHtml).toContain('src="clips/lead.mp4"');
    expect(result.indexHtml).toContain('src="clips/final.mp4"');
    expect(result.indexHtml).not.toContain('src="lead.mp4"');
    expect(result.indexHtml).not.toContain('src="final.mp4"');
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

    const titleCardCalls = result.ffmpegInvocations.filter((call) => call.drawtextFilter !== undefined);
    expect(titleCardCalls).toHaveLength(1);
    expect(result.ffmpegInvocations.every((call) => call.shell === false)).toBe(true);
    expect(titleCardCalls[0].cwd).toBe(result.outputDir);
    expect(titleCardCalls[0].drawtextFilter).toContain('textfile=title_0000.txt');
    expect(titleCardCalls[0].textFileContents).toBe('INT. EDIT SUITE - DAY');
    expect(getExecMock()).not.toHaveBeenCalled();
  });
});

describe('[UT-VCOMP-02] concat manifest escapes spaces, apostrophes, unicode, and nesting', () => {
  it('writes ffmpeg-safe concat entries for project, output, title-card, and clip paths', async () => {
    const scenario: CompileScenario = {
      projectDirPrefix: "fb compile 'prøject'-",
      outputDirParts: ['video', 'output', 'review pack & audit', 'Δ bundle $(whoami)'],
      shots: [
        {
          shotId: 's001',
          scene: "INT. EDIT SUITE - NIGHT - CONTINUOUS - CREW'S NOTES ✨",
          clipName: "nested/Lead Clip's Master & Demo $.mp4",
        },
        {
          shotId: 's002',
          scene: "INT. EDIT SUITE - NIGHT - CONTINUOUS - CREW'S NOTES ✨",
          clipName: 'nested/final reel/Final Clip; take 2 (cut).mp4',
        },
      ],
    };
    const result = await compileScenario(scenario);

    expect(result.projectDir).toContain("fb compile 'prøject'-");
    expect(result.outputDir).toContain(path.join('video', 'output', 'review pack & audit', 'Δ bundle $(whoami)'));
    expect(result.videoSrcs).toEqual([
      "clips/Lead Clip's Master & Demo $.mp4",
      'clips/Final Clip; take 2 (cut).mp4',
    ]);
    expect(result.zipEntries).toEqual(expect.arrayContaining([
      'index.html',
      'combined.mp4',
      "clips/Lead Clip's Master & Demo $.mp4",
      'clips/Final Clip; take 2 (cut).mp4',
    ]));

    for (const src of result.videoSrcs) {
      expect(fs.existsSync(path.resolve(result.extractedDir, src))).toBe(true);
    }

    expect(result.indexHtml).not.toContain('<script>');
    expect(extractHeadingTexts(result.indexHtml)[0]).toBe(
      "s001 — INT. EDIT SUITE - NIGHT - CONTINUOUS - CREW'S NOTES ✨",
    );
    expect(extractVideoSrcs(result.indexHtml)[0]).toBe("clips/Lead Clip's Master & Demo $.mp4");

    const document = parseIndexHtml(result.indexHtml);
    const shots = Array.from(document.getElementsByClassName('shot'));
    expect(shots).toHaveLength(2);
    expect(document.getElementsByTagName('script')).toHaveLength(0);
    expect(shots[0]?.getElementsByTagName('h3')[0]?.textContent).toBe(
      "s001 — INT. EDIT SUITE - NIGHT - CONTINUOUS - CREW'S NOTES ✨",
    );
    expect(shots[0]?.getElementsByTagName('video')[0]?.getAttribute('src')).toBe(
      "clips/Lead Clip's Master & Demo $.mp4",
    );

    const titleCardCalls = result.ffmpegInvocations.filter((call) => call.drawtextFilter !== undefined);
    expect(titleCardCalls).toHaveLength(1);
    expect(result.ffmpegInvocations.every((call) => call.shell === false)).toBe(true);
    expect(titleCardCalls[0].drawtextFilter).toBe(
      'drawtext=fontsize=64:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:expansion=none:textfile=title_0000.txt',
    );
    expect(titleCardCalls[0].textFileContents).toBe(
      "INT. EDIT SUITE - NIGHT - CONTINUOUS - CREW'S NOTES ✨",
    );
    expect(titleCardCalls[0].cwd).toBe(result.outputDir);

    const expectedConcatPaths = [
      path.join(result.outputDir, 'title_0000.mp4'),
      path.resolve(result.projectDir, path.join('video', 'clips', "nested/Lead Clip's Master & Demo $.mp4")),
      path.resolve(result.projectDir, path.join('video', 'clips', 'nested/final reel/Final Clip; take 2 (cut).mp4')),
    ];
    const parsedConcatPaths = result.concatText.trim().split('\n').map(parseConcatEntry);
    expect(parsedConcatPaths).toEqual(expectedConcatPaths);
    expect(result.concatText).toContain("'\\''");
    expect(getExecMock()).not.toHaveBeenCalled();
  });
});

describe('[UT-VCOMP-03] buildIndexHtml escapes hostile HTML input', () => {
  it('renders special characters as literal text and safe attribute values', async () => {
    const { buildIndexHtml } = await import('../commands/video/compile');
    const html = buildIndexHtml([
      {
        shotId: 'Shot <01> & "Alpha" \'Beta\'',
        scene: 'INT. ROOFTOP <script>alert("x")</script> & "Night" \'Sky\'',
        clipFile: 'clips/reel <1> & "cut" \'final\'.mp4',
      },
    ]);

    expect(html).toContain('Shot &lt;01&gt; &amp; &quot;Alpha&quot; &#39;Beta&#39;');
    expect(html).toContain('INT. ROOFTOP &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;Night&quot; &#39;Sky&#39;');
    expect(html).toContain('src="clips/reel &lt;1&gt; &amp; &quot;cut&quot; &#39;final&#39;.mp4"');
    expect(html).not.toContain('<script>alert("x")</script>');

    const document = parseIndexHtml(html);
    expect(document.getElementsByTagName('script')).toHaveLength(0);
    expect(document.getElementsByTagName('h3')[0]?.textContent).toBe(
      'Shot <01> & "Alpha" \'Beta\' — INT. ROOFTOP <script>alert("x")</script> & "Night" \'Sky\'',
    );
    expect(document.getElementsByTagName('video')[0]?.getAttribute('src')).toBe(
      'clips/reel <1> & "cut" \'final\'.mp4',
    );
  });
});

describe('[UT-VCOMP-04] title cards keep scene text literal', () => {
  it('passes scene text through execFile without shell parsing or inline interpolation', async () => {
    const hostileScene = `EXT. BACKLOT "ALPHA" - NIGHT; rm -rf $HOME && echo 'boom' | cat $(whoami)`;
    const result = await compileScenario({
      shots: [
        {
          shotId: 's001',
          scene: hostileScene,
          clipName: 'lead.mp4',
        },
      ],
    });

    const titleCardCalls = result.ffmpegInvocations.filter((call) => call.drawtextFilter !== undefined);
    expect(titleCardCalls).toHaveLength(1);
    expect(titleCardCalls[0].drawtextFilter).toBe(
      'drawtext=fontsize=64:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:expansion=none:textfile=title_0000.txt',
    );
    expect(titleCardCalls[0].textFileContents).toBe(hostileScene);
    expect(titleCardCalls[0].drawtextFilter).not.toContain(hostileScene);
    expect(titleCardCalls[0].cwd).toBe(result.outputDir);
    expect(titleCardCalls[0].shell).toBe(false);
    expect(titleCardCalls[0].command).toBe('ffmpeg');
    expect(titleCardCalls[0].args).toEqual([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=1920x1080:d=2',
      '-vf',
      'drawtext=fontsize=64:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:expansion=none:textfile=title_0000.txt',
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-an',
      'title_0000.mp4',
    ]);
    expect(getExecMock()).not.toHaveBeenCalled();
  });
});
