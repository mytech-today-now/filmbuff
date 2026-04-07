/**
 * ai-powered-integration.test.ts — Phase 10 (bd-2d41)
 *
 * Integration tests for the ai-powered migration:
 *   1. generate-video command (end-to-end with --mock / AI_MOCK)
 *   2. Deleted provider/configure commands → fallback message + exit non-zero
 *   3. All six typed ai-powered error classes → correct messages + exit codes
 *
 * Spec: openspec/changes/ai-powered-not-local/tests/plan.md
 */

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

jest.mock('chalk', () => {
  function make(): any {
    const fn = (s: string) => String(s);
    return new Proxy(fn, { get: (_t, _p) => make() });
  }
  const r = make();
  return { default: r, blue: r, green: r, red: r, gray: r, yellow: r, cyan: r,
           bold: r, dim: r, white: r };
});

// Mock FilmbuffVideoGenerator so no real API calls are made in integration tests.
jest.mock('../../lib/video-generator');

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import * as fs   from 'fs';
import * as path from 'path';
import * as os   from 'os';
import { generateVideoCommand }    from '../generate-video';
import { unknownProviderCommand }  from '../provider';
import { FilmbuffVideoGenerator }  from '../../lib/video-generator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temporary directory for test I/O. */
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fb-aipnl-test-'));
}

/** Write JSONL fixture with N shot entries to a file and return its path. */
function writeShotJsonl(dir: string, n: number, filename = 'shots.jsonl'): string {
  const p = path.join(dir, filename);
  const lines = Array.from({ length: n }, (_, i) => JSON.stringify({
    shotNumber: i + 1,
    description: `Shot ${i + 1}`,
    videoControls: { duration: 4 },
  }));
  fs.writeFileSync(p, lines.join('\n') + '\n', 'utf-8');
  return p;
}

/** Fake GeneratedVideoResult for a given shot number. */
function fakeResult(shotNumber: number) {
  return {
    shotNumber,
    videoData:   `https://cdn.example.com/shot-${shotNumber}.mp4`,
    mimeType:    'video/mp4',
    provider:    'mock',
    model:       'mock-model',
    generatedAt: new Date().toISOString(),
    durationMs:  10,
  };
}

// Typed reference to the mocked class
const MockGenerator = FilmbuffVideoGenerator as jest.MockedClass<typeof FilmbuffVideoGenerator>;

// ---------------------------------------------------------------------------
// 1. generate-video command — end-to-end integration tests
// ---------------------------------------------------------------------------

describe('generate-video command — integration', () => {
  let tmpDir: string;
  let inputFile: string;
  let exitSpy:   jest.SpiedFunction<typeof process.exit>;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;

  beforeEach(() => {
    tmpDir    = makeTmpDir();
    inputFile = writeShotJsonl(tmpDir, 5);
    exitSpy   = jest.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Default mock: generateForShotList returns one result per shot in the batch
    MockGenerator.mockImplementation(() => ({
      generateForShot:     jest.fn().mockResolvedValue(fakeResult(1)),
      generateForShotList: jest.fn().mockImplementation(async (shots: any[]) =>
        shots.map((s: any) => fakeResult(s.shotNumber))
      ),
    }) as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('basic end-to-end: exits 0 and writes manifest.json', async () => {
    const outputDir = path.join(tmpDir, 'out');
    await generateVideoCommand({ input: inputFile, mock: true, output: outputDir });
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(fs.existsSync(path.join(outputDir, 'manifest.json'))).toBe(true);
  });

  it('manifest contains entries for all 5 shots', async () => {
    const outputDir = path.join(tmpDir, 'out');
    await generateVideoCommand({ input: inputFile, mock: true, output: outputDir });
    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf-8'));
    expect(manifest).toHaveLength(5);
    expect(manifest.map((r: any) => r.shotNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it('--shots 1,3,5 filter: only shots 1, 3, 5 in manifest', async () => {
    const outputDir = path.join(tmpDir, 'out');
    await generateVideoCommand({ input: inputFile, shots: '1,3,5', mock: true, output: outputDir });
    expect(exitSpy).toHaveBeenCalledWith(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf-8'));
    expect(manifest.map((r: any) => r.shotNumber)).toEqual([1, 3, 5]);
  });

  it('--provider runway: provider passed to generateForShotList options', async () => {
    const generateSpy = jest.fn().mockResolvedValue([fakeResult(1)]);
    MockGenerator.mockImplementation(() => ({
      generateForShot:     jest.fn(),
      generateForShotList: generateSpy,
    }) as any);
    const outputDir = path.join(tmpDir, 'out');
    const singleShot = writeShotJsonl(tmpDir, 1, 'single.jsonl');
    await generateVideoCommand({ input: singleShot, provider: 'runway', mock: false, output: outputDir });
    expect(generateSpy).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ provider: 'runway' }),
      expect.any(Number),
    );
  });

  it('--concurrency 5: generateForShotList called with concurrency 5', async () => {
    const generateSpy = jest.fn().mockResolvedValue([fakeResult(1)]);
    MockGenerator.mockImplementation(() => ({
      generateForShot:     jest.fn(),
      generateForShotList: generateSpy,
    }) as any);
    const outputDir = path.join(tmpDir, 'out');
    await generateVideoCommand({ input: inputFile, concurrency: 5, mock: true, output: outputDir });
    expect(generateSpy).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      5,
    );
  });

  it('missing --input: exits non-zero when input file does not exist', async () => {
    await generateVideoCommand({ input: '/nonexistent/shots.jsonl', mock: true });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('JSONL parse failure: skips bad lines and still exits 0 if valid shots remain', async () => {
    const mixedPath = path.join(tmpDir, 'mixed.jsonl');
    fs.writeFileSync(mixedPath,
      'NOT_JSON_AT_ALL\n' +
      JSON.stringify({ shotNumber: 1, description: 'Good shot', videoControls: { duration: 4 } }) + '\n'
    );
    const outputDir = path.join(tmpDir, 'out-mixed');
    await generateVideoCommand({ input: mixedPath, mock: true, output: outputDir });
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Deleted commands — fallback message + exit non-zero
// ---------------------------------------------------------------------------

describe('Deleted commands — fallback messages', () => {
  let exitSpy:   jest.SpiedFunction<typeof process.exit>;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;

  beforeEach(() => {
    exitSpy   = jest.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => jest.restoreAllMocks());

  for (const subcmd of ['provider list', 'provider create', 'provider activate', 'provider show',
                        'provider validate', 'provider edit', 'provider delete', 'provider status']) {
    it(`filmbuff ${subcmd}: exits non-zero with ai-powered guidance`, () => {
      unknownProviderCommand(subcmd);
      expect(exitSpy).toHaveBeenCalledWith(1);
      const output = stderrSpy.mock.calls.flat().join('');
      expect(output).toMatch(/ai-powered/);
      expect(output).toMatch(/filmbuff ai status/);
    });
  }

  it('filmbuff configure: exits non-zero with ai-powered guidance', () => {
    unknownProviderCommand('configure');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = stderrSpy.mock.calls.flat().join('');
    expect(output).toMatch(/ai-powered/);
  });
});

// ---------------------------------------------------------------------------
// 3. Error-handling — all six typed ai-powered error classes
// ---------------------------------------------------------------------------

/** Factory to create a named error with extra properties. */
function makeErr(name: string, props: Record<string, unknown> = {}): Error {
  const err = Object.assign(new Error(name), { name, ...props });
  return err;
}

describe('generate-video — ai-powered typed error classes', () => {
  let tmpDir:    string;
  let inputFile: string;
  let exitSpy:   jest.SpiedFunction<typeof process.exit>;

  beforeEach(() => {
    tmpDir    = makeTmpDir();
    inputFile = writeShotJsonl(tmpDir, 1);
    exitSpy   = jest.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ProviderCapabilityError → exits 1', async () => {
    MockGenerator.mockImplementation(() => ({
      generateForShot:     jest.fn(),
      generateForShotList: jest.fn().mockRejectedValue(
        makeErr('ProviderCapabilityError')
      ),
    }) as any);
    await generateVideoCommand({ input: inputFile, mock: true, output: path.join(tmpDir, 'out') });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('AllProvidersExhaustedError → exits 1', async () => {
    MockGenerator.mockImplementation(() => ({
      generateForShot:     jest.fn(),
      generateForShotList: jest.fn().mockRejectedValue(
        makeErr('AllProvidersExhaustedError', { reasons: [{ provider: 'lumaai', reason: 'timeout' }] })
      ),
    }) as any);
    await generateVideoCommand({ input: inputFile, mock: true, output: path.join(tmpDir, 'out') });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('CircuitOpenError → exits 1', async () => {
    MockGenerator.mockImplementation(() => ({
      generateForShot:     jest.fn(),
      generateForShotList: jest.fn().mockRejectedValue(
        makeErr('CircuitOpenError', { estimatedRecovery: '2026-04-08T00:00:00Z' })
      ),
    }) as any);
    await generateVideoCommand({ input: inputFile, mock: true, output: path.join(tmpDir, 'out') });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('BudgetExceededError → exits 1', async () => {
    MockGenerator.mockImplementation(() => ({
      generateForShot:     jest.fn(),
      generateForShotList: jest.fn().mockRejectedValue(
        makeErr('BudgetExceededError', { spent: 10, limit: 5, configPath: '~/.ai-powered/config.json' })
      ),
    }) as any);
    await generateVideoCommand({ input: inputFile, mock: true, output: path.join(tmpDir, 'out') });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('ConfigError → exits 1', async () => {
    MockGenerator.mockImplementation(() => ({
      generateForShot:     jest.fn(),
      generateForShotList: jest.fn().mockRejectedValue(
        makeErr('ConfigError', { issues: ['provider is required'] })
      ),
    }) as any);
    await generateVideoCommand({ input: inputFile, mock: true, output: path.join(tmpDir, 'out') });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('ValidationError → exits 2', async () => {
    MockGenerator.mockImplementation(() => ({
      generateForShot:     jest.fn(),
      generateForShotList: jest.fn().mockRejectedValue(
        makeErr('ValidationError', { issues: ['schema mismatch'], rawResponse: { bad: true } })
      ),
    }) as any);
    await generateVideoCommand({ input: inputFile, mock: true, output: path.join(tmpDir, 'out') });
    expect(exitSpy).toHaveBeenCalledWith(2);
  });
});
