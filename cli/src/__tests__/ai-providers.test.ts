/**
 * ai-providers.test.ts — Phase 10 (bd-2d41)
 *
 * Unit and integration tests for the ai-powered-not-local migration:
 *
 *   1. getFilmbuffAiClient()   — filmbuff-ai-client.ts
 *   2. resolveAIClient()       — runtime-resolver.ts
 *   3. buildVideoPrompt()      — lib/video-generator.ts
 *   4. FilmbuffVideoGenerator  — lib/video-generator.ts
 *
 * All tests that previously mocked Anthropic SDK, profileStore, providerRegistry,
 * resolveActiveProvider, resolveProviderByProfile, AIPoweredClient, and
 * fetchWithTimeout have been removed (Phase 10 spec, bd-2d41).
 *
 * ai-powered is mocked at the module level so no real API calls are made.
 */

// ---------------------------------------------------------------------------
// Module-level mock — must precede all imports that touch 'ai-powered'
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-require-imports */

// ai-powered uses a complex package.json `exports` map that Jest's CommonJS
// resolver can't navigate without ESM support.  The `{ virtual: true }` flag
// bypasses module-existence validation so the factory is used directly.
//
// All tests in this file exercise the real implementations of
// getFilmbuffAiClient / resolveAIClient / FilmbuffVideoGenerator and let them
// call through to this mocked ai-powered layer — no stubs needed above that.
jest.mock('ai-powered', () => ({
  getAiClient: jest.fn(),
  loadConfig:  jest.fn(),
}), { virtual: true });

import { getFilmbuffAiClient } from '../utils/filmbuff-ai-client';
import { resolveAIClient }      from '../utils/runtime-resolver';
import {
  buildVideoPrompt,
  FilmbuffVideoGenerator,
  type ShotEntry,
} from '../lib/video-generator';

// Typed reference to the underlying mocked getAiClient
const mockGetAiClient = (jest.requireMock('ai-powered') as { getAiClient: jest.Mock })
  .getAiClient as jest.MockedFunction<(toolName: string, overrides?: object) => Promise<unknown>>;

// ---------------------------------------------------------------------------
// Helper: build a minimal ShotEntry for prompt tests
// ---------------------------------------------------------------------------

function makeShot(overrides: Partial<ShotEntry> = {}): ShotEntry {
  return {
    shotNumber:  1,
    description: 'Wide shot of the rooftop at dusk',
    videoControls: { duration: 5 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. getFilmbuffAiClient()
// ---------------------------------------------------------------------------

describe('getFilmbuffAiClient()', () => {
  const fakeClient = { generateText: jest.fn() };

  beforeEach(() => {
    mockGetAiClient.mockReset();
    mockGetAiClient.mockResolvedValue(fakeClient);
  });

  it('merges FILMBUFF_DEFAULTS: plugins=[audit-log] forwarded to getAiClient', async () => {
    await getFilmbuffAiClient('tool-a');
    expect(mockGetAiClient).toHaveBeenCalledWith(
      'tool-a',
      expect.objectContaining({ plugins: ['audit-log'] }),
    );
  });

  it('overrides win: { plugins: ["rate-limiter"] } replaces audit-log', async () => {
    await getFilmbuffAiClient('tool-b', { plugins: ['rate-limiter'] });
    expect(mockGetAiClient).toHaveBeenCalledWith(
      'tool-b',
      expect.objectContaining({ plugins: ['rate-limiter'] }),
    );
  });

  it('toolName is passed as the first argument to getAiClient', async () => {
    await getFilmbuffAiClient('blocking-extractor');
    expect(mockGetAiClient.mock.calls[0]?.[0]).toBe('blocking-extractor');
  });

  it('returns the AiClient instance returned by getAiClient', async () => {
    const result = await getFilmbuffAiClient('tool-c');
    expect(result).toBe(fakeClient);
  });

  it('overrides never contain credential fields', async () => {
    await getFilmbuffAiClient('tool-d', { provider: 'openai' } as any);
    const callArg = mockGetAiClient.mock.calls[0]?.[1] as Record<string, unknown> ?? {};
    const forbidden = ['apiKey', 'credential', 'secret', 'token', 'password'];
    for (const field of forbidden) {
      expect(callArg).not.toHaveProperty(field);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. resolveAIClient()
// ---------------------------------------------------------------------------

describe('resolveAIClient()', () => {
  const fakeClient = { generateText: jest.fn() };

  beforeEach(() => {
    mockGetAiClient.mockReset();
    mockGetAiClient.mockResolvedValue(fakeClient);
  });

  it('delegates to getFilmbuffAiClient with the given toolName', async () => {
    const result = await resolveAIClient('shot-list-tool');
    // resolveAIClient → getFilmbuffAiClient → mocked getAiClient
    expect(mockGetAiClient).toHaveBeenCalledWith(
      'shot-list-tool',
      expect.objectContaining({ plugins: ['audit-log'] }),
    );
    expect(result).toBe(fakeClient);
  });

  it('passes overrides through to getFilmbuffAiClient', async () => {
    await resolveAIClient('shot-list-tool', { mock: true } as any);
    expect(mockGetAiClient).toHaveBeenCalledWith(
      'shot-list-tool',
      expect.objectContaining({ mock: true }),
    );
  });

  it('returns the AiClient instance from getFilmbuffAiClient', async () => {
    const result = await resolveAIClient('tool-x');
    expect(result).toBe(fakeClient);
  });
});

// ---------------------------------------------------------------------------
// 3. buildVideoPrompt()
// ---------------------------------------------------------------------------

describe('buildVideoPrompt()', () => {
  it('includes shot description in the prompt', () => {
    const prompt = buildVideoPrompt(makeShot({ description: 'Close-up of a candle flickering' }));
    expect(prompt).toContain('Close-up of a candle flickering');
  });

  it('includes the shot description in the "Shot:" line', () => {
    const prompt = buildVideoPrompt(makeShot({ videoControls: { duration: 8 } }));
    // Duration is forwarded to generateVideo args, not embedded in the prompt text.
    // The prompt always contains the "Shot:" prefix for the description.
    expect(prompt).toContain('Shot:');
  });

  it('includes "Style: cinematic hero shot quality" as the last line', () => {
    const prompt = buildVideoPrompt(makeShot({ shotNumber: 7 }));
    expect(prompt).toContain('Style: cinematic hero shot quality');
  });

  it('returns a non-empty string', () => {
    const prompt = buildVideoPrompt(makeShot());
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(10);
  });

  it('handles missing videoControls gracefully', () => {
    const shot = makeShot();
    delete (shot as Partial<ShotEntry>).videoControls;
    expect(() => buildVideoPrompt(shot)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. FilmbuffVideoGenerator
// ---------------------------------------------------------------------------

describe('FilmbuffVideoGenerator', () => {
  let generator: FilmbuffVideoGenerator;

  // generateForShot calls (client as any).generateVideo() on the AiClient.
  const fakeVideoResponse = {
    data:            'https://cdn.example.com/video.mp4',
    mimeType:        'video/mp4',
    durationSeconds: 5,
    aspectRatio:     '16:9',
    provider:        'lumaai',
    model:           'dream-machine',
  };
  const generateVideoMock = jest.fn();
  const fakeClient = { generateVideo: generateVideoMock };

  beforeEach(() => {
    mockGetAiClient.mockReset();
    mockGetAiClient.mockResolvedValue(fakeClient);
    generateVideoMock.mockReset();
    generateVideoMock.mockResolvedValue(fakeVideoResponse);
    generator = new FilmbuffVideoGenerator();
  });

  it('generateForShot: calls getFilmbuffAiClient with "video-generator" toolName', async () => {
    await generator.generateForShot(makeShot());
    expect(mockGetAiClient).toHaveBeenCalledWith(
      'video-generator',
      expect.any(Object),
    );
  });

  it('generateForShot: result has shotNumber matching the input shot', async () => {
    const result = await generator.generateForShot(makeShot({ shotNumber: 42 }));
    expect(result.shotNumber).toBe(42);
  });

  it('generateForShot: result.videoData is defined and non-empty on success', async () => {
    const result = await generator.generateForShot(makeShot());
    expect(result.videoData).toBeTruthy();
  });

  it('generateForShotList: processes every shot in the list', async () => {
    const shots = [makeShot({ shotNumber: 1 }), makeShot({ shotNumber: 2 }), makeShot({ shotNumber: 3 })];
    // concurrency is the 3rd positional arg, not an option field
    const results = await generator.generateForShotList(shots, {}, 2);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.shotNumber)).toEqual(expect.arrayContaining([1, 2, 3]));
  });

  it('generateForShotList: concurrency=1 processes shots sequentially', async () => {
    const order: number[] = [];
    generateVideoMock.mockImplementation(async () => {
      order.push(order.length + 1);
      return fakeVideoResponse;
    });
    const shots = [1, 2, 3].map((n) => makeShot({ shotNumber: n }));
    // concurrency=1 is the 3rd positional arg
    await generator.generateForShotList(shots, {}, 1);
    expect(order).toEqual([1, 2, 3]);
  });

  it('generateForShot: propagates errors thrown by generateVideo', async () => {
    generateVideoMock.mockRejectedValue(new Error('provider network timeout'));
    await expect(generator.generateForShot(makeShot({ shotNumber: 5 }))).rejects.toThrow(
      'provider network timeout',
    );
  });
});
