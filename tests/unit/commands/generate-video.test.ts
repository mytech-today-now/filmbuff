import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { FilmbuffVideoGeneratorMock, generateForShotListMock } = vi.hoisted(() => {
  const generateForShotListMock = vi.fn();
  const FilmbuffVideoGeneratorMock = vi.fn(function FilmbuffVideoGeneratorMock() {
    return {
      generateForShotList: generateForShotListMock
    };
  });

  return { FilmbuffVideoGeneratorMock, generateForShotListMock };
});

vi.mock('chalk', () => {
  function make(): any {
    const fn = (s: string) => String(s);
    return new Proxy(fn, { get: () => make() });
  }

  const r = make();
  return { default: r, blue: r, green: r, red: r, gray: r, yellow: r, cyan: r, bold: r, dim: r, white: r };
});

vi.mock('../../../cli/src/lib/video-generator.js', () => ({
  FilmbuffVideoGenerator: FilmbuffVideoGeneratorMock
}));

import { generateVideoCommand } from '../../../cli/src/commands/generate-video';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fb-gvideo-test-'));
}

function writeJsonl(dir: string, lines: string[], filename = 'shots.jsonl'): string {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf-8');
  return filePath;
}

function shotLine(shotNumber: number): string {
  return JSON.stringify({
    shotNumber,
    description: `Shot ${shotNumber}`,
    videoControls: { duration: 4 }
  });
}

function fakeResult(shotNumber: number) {
  return {
    shotNumber,
    videoData: `https://cdn.example.com/shot-${shotNumber}.mp4`,
    mimeType: 'video/mp4',
    provider: 'mock',
    model: 'mock-model',
    generatedAt: '2026-09-09T00:00:00.000Z',
    durationMs: 10
  };
}

describe('generate-video command', () => {
  let tmpDir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    FilmbuffVideoGeneratorMock.mockClear();
    generateForShotListMock.mockReset();
    generateForShotListMock.mockImplementation(async (shots: Array<{ shotNumber: number }>) =>
      shots.map(({ shotNumber }) => fakeResult(shotNumber))
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails on malformed JSONL before generation and reports the bad line', async () => {
    const input = writeJsonl(tmpDir, [
      shotLine(1),
      'NOT_JSON_AT_ALL',
      shotLine(2)
    ]);
    const outputDir = path.join(tmpDir, 'out-malformed');

    await generateVideoCommand({ input, mock: true, output: outputDir });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(FilmbuffVideoGeneratorMock).not.toHaveBeenCalled();
    expect(generateForShotListMock).not.toHaveBeenCalled();
    expect(fs.existsSync(outputDir)).toBe(false);

    const errorText = errorSpy.mock.calls.flat().join(' ');
    expect(errorText).toContain('The shot list contains malformed JSON. Fix the bad line before generating video.');
    expect(errorText).toContain('Line 2');
  });

  it('writes the same manifest for valid JSONL input', async () => {
    const input = writeJsonl(tmpDir, [shotLine(1), shotLine(2), shotLine(3)]);
    const outputDir = path.join(tmpDir, 'out-valid');

    await generateVideoCommand({ input, mock: true, output: outputDir });

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(generateForShotListMock).toHaveBeenCalledTimes(1);

    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf-8'));
    expect(manifest).toEqual([fakeResult(1), fakeResult(2), fakeResult(3)]);
  });

  it('honors --shots filtering for valid JSONL input', async () => {
    const input = writeJsonl(tmpDir, [shotLine(1), shotLine(2), shotLine(3), shotLine(4)]);
    const outputDir = path.join(tmpDir, 'out-filtered');

    await generateVideoCommand({ input, shots: '1,3', mock: true, output: outputDir });

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(generateForShotListMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ shotNumber: 1 }),
        expect.objectContaining({ shotNumber: 3 })
      ]),
      expect.objectContaining({ mock: true }),
      3
    );

    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf-8'));
    expect(manifest.map((result: { shotNumber: number }) => result.shotNumber)).toEqual([1, 3]);
  });

  it('exits 0 with the existing no-shots message for empty input', async () => {
    const input = writeJsonl(tmpDir, ['   ', '']);

    await generateVideoCommand({ input, mock: true, output: path.join(tmpDir, 'out-empty') });

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(generateForShotListMock).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls.flat().join(' ')).toContain('No shots to process.');
  });

  it('mock mode still completes without network calls', async () => {
    const input = writeJsonl(tmpDir, [shotLine(1), shotLine(2)]);
    const outputDir = path.join(tmpDir, 'out-mock');

    await generateVideoCommand({ input, mock: true, output: outputDir });

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(FilmbuffVideoGeneratorMock).toHaveBeenCalledTimes(1);
    expect(generateForShotListMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ mock: true, provider: 'mock' }),
      3
    );

    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf-8'));
    expect(manifest).toHaveLength(2);
  });
});
