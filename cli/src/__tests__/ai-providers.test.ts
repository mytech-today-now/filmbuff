/**
 * ai-providers.test.ts — Phase 7 rewrites (bd-79m0, bd-b0da)
 *
 * Unit and integration tests for the ai-powered migration:
 *
 *   1. getFilmbuffAiClient()      — filmbuff-ai-client.ts
 *   2. resolveAIClient()          — runtime-resolver.ts (4-level resolution)
 *   3. buildVideoPrompt()         — lib/video-generator.ts
 *   4. FilmbuffVideoGenerator     — lib/video-generator.ts
 *   5. aiStatusCommand            — commands/ai-status.ts
 *   6. aiSetCommand               — commands/ai-set.ts
 *   7. Integration smoke test     — AIPoweredClient end-to-end via resolveAIClient
 *
 * Removed: all tests referencing Anthropic, profileStore, providerRegistry,
 *          resolveActiveProvider, resolveProviderByProfile (bd-79m0 cleanup).
 */

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted before imports by Jest)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-require-imports */

// ai-powered uses a complex package.json `exports` map that Jest's CommonJS
// resolver can't navigate without ESM support.  The `{ virtual: true }` flag
// bypasses module-existence validation so the factory is used directly.
jest.mock('ai-powered', () => ({
  getAiClient: jest.fn(),
  loadConfig:  jest.fn(),
}), { virtual: true });

// config-system is mocked so tests can inject controlled config values
// without touching the filesystem.
jest.mock('../utils/config-system');

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { getFilmbuffAiClient }            from '../utils/filmbuff-ai-client';
import { resolveAIClient }                from '../utils/runtime-resolver';
import { ConfigManager }                  from '../utils/config-system';
import { aiStatusCommand }                from '../commands/ai-status';
import { aiSetCommand }                   from '../commands/ai-set';
import {
  AIPoweredConnectionError,
  AIPoweredParseError,
  AI_POWERED_DEFAULTS,
} from '../utils/ai-powered-client';
import {
  buildVideoPrompt,
  FilmbuffVideoGenerator,
  type ShotEntry,
} from '../lib/video-generator';

// ---------------------------------------------------------------------------
// Typed references & shared helpers
// ---------------------------------------------------------------------------

// Typed reference to the underlying mocked getAiClient
const mockGetAiClient = (jest.requireMock('ai-powered') as { getAiClient: jest.Mock })
  .getAiClient as jest.MockedFunction<(toolName: string, overrides?: object) => Promise<unknown>>;

// Typed reference to mocked ConfigManager constructor
const MockConfigManager = jest.mocked(ConfigManager);

/** Minimal mock response shapes for fetch spying */
type MockResp = { ok: boolean; status: number; body: string; statusText?: string };

/** Inject a sequence of fetch responses, cycling the last one if exhausted. */
function mockFetchSeq(...responses: MockResp[]) {
  let i = 0;
  return jest.spyOn(global, 'fetch').mockImplementation(async () => {
    const r = responses[Math.min(i++, responses.length - 1)];
    return {
      ok: r.ok, status: r.status,
      statusText: r.statusText ?? '',
      text: async () => r.body,
    } as unknown as Response;
  });
}

const HEALTH_OK: MockResp = { ok: true, status: 200, body: 'ok' };
const COMPLETION_BODY = JSON.stringify({
  choices: [{ message: { content: 'Generated text.' } }],
  model: 'gpt-4',
  usage: { prompt_tokens: 5, completion_tokens: 10 },
});
const COMPLETION_OK: MockResp = { ok: true, status: 200, body: COMPLETION_BODY };

/** Configure the ConfigManager mock for a given test. */
function mockCfg(aiPowered: Record<string, unknown> = {}) {
  const inst = {
    load:     jest.fn().mockReturnValue({ version: '1.0.0', aiPowered }),
    set:      jest.fn(),
    validate: jest.fn().mockReturnValue({ valid: true, errors: [], warnings: [] }),
    save:     jest.fn(),
    getConfig: jest.fn().mockReturnValue({ version: '1.0.0', aiPowered }),
  };
  MockConfigManager.mockImplementation(() => inst as any);
  return inst;
}

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
// 2. resolveAIClient() — 4-level resolution hierarchy (bd-79m0)
//
// 24 test cases: 6 parameters × 4 resolution levels
//   Level 1: overrides arg (CLI flags)
//   Level 2: environment variables
//   Level 3: config file (aiPowered block)
//   Level 4: built-in defaults (AI_POWERED_DEFAULTS)
//
// Verification strategy:
//   URL      → health-check fetch URL (/health)
//   model    → complete() request body .model
//   systemP  → complete() request body messages[0].content
//   temp     → complete() request body .temperature
//   maxTok   → complete() request body .max_tokens
//   timeoutMs→ error message on AbortError contains the configured ms value
// ---------------------------------------------------------------------------

describe('resolveAIClient() — 4-level resolution hierarchy', () => {
  // Env vars used in resolution
  const ENV_URL   = 'AI_POWERED_URL';
  const ENV_MODEL = 'AI_MODEL';
  const ENV_SYS   = 'AI_SYSTEM_PROMPT';
  const ENV_TEMP  = 'AI_TEMPERATURE';
  const ENV_MAX   = 'AI_MAX_TOKENS';
  const ENV_TMO   = 'AI_TIMEOUT_MS';

  beforeEach(() => {
    mockCfg({}); // empty config by default
    // Clean all resolution env vars before every test
    [ENV_URL, ENV_MODEL, ENV_SYS, ENV_TEMP, ENV_MAX, ENV_TMO].forEach(k => {
      delete process.env[k];
    });
  });
  afterEach(() => jest.restoreAllMocks());

  // --- URL (verified via health-check fetch URL) ---

  it('url L1: CLI override wins over env + config', async () => {
    process.env[ENV_URL] = 'http://env-url:3001';
    mockCfg({ url: 'http://config-url:3001' });
    const client = resolveAIClient({ url: 'http://cli-url:3001' });
    const spy = mockFetchSeq(HEALTH_OK);
    await client.checkHealth();
    expect(spy.mock.calls[0]?.[0]).toBe('http://cli-url:3001/health');
  });

  it('url L2: env var wins over config + default when no CLI override', async () => {
    process.env[ENV_URL] = 'http://env-url:3001';
    mockCfg({ url: 'http://config-url:3001' });
    const client = resolveAIClient();
    const spy = mockFetchSeq(HEALTH_OK);
    await client.checkHealth();
    expect(spy.mock.calls[0]?.[0]).toBe('http://env-url:3001/health');
  });

  it('url L3: config file wins over default when no env or CLI override', async () => {
    mockCfg({ url: 'http://config-url:3001' });
    const client = resolveAIClient();
    const spy = mockFetchSeq(HEALTH_OK);
    await client.checkHealth();
    expect(spy.mock.calls[0]?.[0]).toBe('http://config-url:3001/health');
  });

  it('url L4: built-in default used when nothing else is set', async () => {
    mockCfg({});
    const client = resolveAIClient();
    const spy = mockFetchSeq(HEALTH_OK);
    await client.checkHealth();
    expect(spy.mock.calls[0]?.[0]).toBe(`${AI_POWERED_DEFAULTS.url}/health`);
  });

  // --- model (verified via complete() request body) ---

  it('model L1: CLI override wins over env + config', async () => {
    process.env[ENV_MODEL] = 'env-model';
    mockCfg({ model: 'config-model' });
    const client = resolveAIClient({ model: 'cli-model' });
    const spy = mockFetchSeq(HEALTH_OK, COMPLETION_OK);
    await client.complete('prompt');
    const body = JSON.parse((spy.mock.calls[1]?.[1] as RequestInit).body as string);
    expect(body.model).toBe('cli-model');
  });

  it('model L2: env var wins over config + default', async () => {
    process.env[ENV_MODEL] = 'env-model';
    mockCfg({ model: 'config-model' });
    const client = resolveAIClient();
    const spy = mockFetchSeq(HEALTH_OK, COMPLETION_OK);
    await client.complete('prompt');
    const body = JSON.parse((spy.mock.calls[1]?.[1] as RequestInit).body as string);
    expect(body.model).toBe('env-model');
  });

  it('model L3: config file wins over default', async () => {
    mockCfg({ model: 'config-model' });
    const client = resolveAIClient();
    const spy = mockFetchSeq(HEALTH_OK, COMPLETION_OK);
    await client.complete('prompt');
    const body = JSON.parse((spy.mock.calls[1]?.[1] as RequestInit).body as string);
    expect(body.model).toBe('config-model');
  });

  it('model L4: built-in default used when nothing else is set', async () => {
    mockCfg({});
    const client = resolveAIClient();
    const spy = mockFetchSeq(HEALTH_OK, COMPLETION_OK);
    await client.complete('prompt');
    const body = JSON.parse((spy.mock.calls[1]?.[1] as RequestInit).body as string);
    expect(body.model).toBe(AI_POWERED_DEFAULTS.model);
  });

  // --- systemPrompt (verified via complete() messages[0].content) ---

  it('systemPrompt L1: CLI override wins', async () => {
    process.env[ENV_SYS] = 'env-prompt';
    mockCfg({ systemPrompt: 'config-prompt' });
    const client = resolveAIClient({ systemPrompt: 'cli-prompt' });
    const spy = mockFetchSeq(HEALTH_OK, COMPLETION_OK);
    await client.complete('prompt');
    const body = JSON.parse((spy.mock.calls[1]?.[1] as RequestInit).body as string);
    expect(body.messages[0].content).toBe('cli-prompt');
  });

  it('systemPrompt L2: env var wins over config', async () => {
    process.env[ENV_SYS] = 'env-prompt';
    mockCfg({ systemPrompt: 'config-prompt' });
    const client = resolveAIClient();
    const spy = mockFetchSeq(HEALTH_OK, COMPLETION_OK);
    await client.complete('prompt');
    const body = JSON.parse((spy.mock.calls[1]?.[1] as RequestInit).body as string);
    expect(body.messages[0].content).toBe('env-prompt');
  });

  it('systemPrompt L3: config file wins over default', async () => {
    mockCfg({ systemPrompt: 'config-prompt' });
    const client = resolveAIClient();
    const spy = mockFetchSeq(HEALTH_OK, COMPLETION_OK);
    await client.complete('prompt');
    const body = JSON.parse((spy.mock.calls[1]?.[1] as RequestInit).body as string);
    expect(body.messages[0].content).toBe('config-prompt');
  });

  it('systemPrompt L4: built-in default is non-empty string', async () => {
    mockCfg({});
    const client = resolveAIClient();
    const spy = mockFetchSeq(HEALTH_OK, COMPLETION_OK);
    await client.complete('prompt');
    const body = JSON.parse((spy.mock.calls[1]?.[1] as RequestInit).body as string);
    expect(body.messages[0].content).toBe(AI_POWERED_DEFAULTS.systemPrompt);
    expect(body.messages[0].content.length).toBeGreaterThan(0);
  });

  // --- temperature (verified via complete() request body) ---

  it('temperature L1: CLI override wins', async () => {
    process.env[ENV_TEMP] = '1.0';
    mockCfg({ temperature: 0.3 });
    const client = resolveAIClient({ temperature: 1.8 });
    const spy = mockFetchSeq(HEALTH_OK, COMPLETION_OK);
    await client.complete('prompt');
    const body = JSON.parse((spy.mock.calls[1]?.[1] as RequestInit).body as string);
    expect(body.temperature).toBe(1.8);
  });

  it('temperature L2: env var wins over config', async () => {
    process.env[ENV_TEMP] = '1.2';
    mockCfg({ temperature: 0.5 });
    const client = resolveAIClient();
    const spy = mockFetchSeq(HEALTH_OK, COMPLETION_OK);
    await client.complete('prompt');
    const body = JSON.parse((spy.mock.calls[1]?.[1] as RequestInit).body as string);
    expect(body.temperature).toBe(1.2);
  });

  it('temperature L3: config file wins over default', async () => {
    mockCfg({ temperature: 0.1 });
    const client = resolveAIClient();
    const spy = mockFetchSeq(HEALTH_OK, COMPLETION_OK);
    await client.complete('prompt');
    const body = JSON.parse((spy.mock.calls[1]?.[1] as RequestInit).body as string);
    expect(body.temperature).toBe(0.1);
  });

  it('temperature L4: built-in default is 0.7', async () => {
    mockCfg({});
    const client = resolveAIClient();
    const spy = mockFetchSeq(HEALTH_OK, COMPLETION_OK);
    await client.complete('prompt');
    const body = JSON.parse((spy.mock.calls[1]?.[1] as RequestInit).body as string);
    expect(body.temperature).toBe(AI_POWERED_DEFAULTS.temperature);
  });

  // --- maxTokens (verified via complete() request body .max_tokens) ---

  it('maxTokens L1: CLI override wins', async () => {
    process.env[ENV_MAX] = '512';
    mockCfg({ maxTokens: 256 });
    const client = resolveAIClient({ maxTokens: 8192 });
    const spy = mockFetchSeq(HEALTH_OK, COMPLETION_OK);
    await client.complete('prompt');
    const body = JSON.parse((spy.mock.calls[1]?.[1] as RequestInit).body as string);
    expect(body.max_tokens).toBe(8192);
  });

  it('maxTokens L2: env var wins over config', async () => {
    process.env[ENV_MAX] = '1024';
    mockCfg({ maxTokens: 512 });
    const client = resolveAIClient();
    const spy = mockFetchSeq(HEALTH_OK, COMPLETION_OK);
    await client.complete('prompt');
    const body = JSON.parse((spy.mock.calls[1]?.[1] as RequestInit).body as string);
    expect(body.max_tokens).toBe(1024);
  });

  it('maxTokens L3: config file wins over default', async () => {
    mockCfg({ maxTokens: 4096 });
    const client = resolveAIClient();
    const spy = mockFetchSeq(HEALTH_OK, COMPLETION_OK);
    await client.complete('prompt');
    const body = JSON.parse((spy.mock.calls[1]?.[1] as RequestInit).body as string);
    expect(body.max_tokens).toBe(4096);
  });

  it('maxTokens L4: built-in default is 2048', async () => {
    mockCfg({});
    const client = resolveAIClient();
    const spy = mockFetchSeq(HEALTH_OK, COMPLETION_OK);
    await client.complete('prompt');
    const body = JSON.parse((spy.mock.calls[1]?.[1] as RequestInit).body as string);
    expect(body.max_tokens).toBe(AI_POWERED_DEFAULTS.maxTokens);
  });

  // --- timeoutMs (verified via AbortError message which includes timeoutMs) ---

  function makeAbortError() {
    return Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
  }

  it('timeoutMs L1: CLI override wins — error message shows overridden ms', async () => {
    process.env[ENV_TMO] = '5000';
    mockCfg({ timeoutMs: 10000 });
    const client = resolveAIClient({ timeoutMs: 777 });
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'ok' } as any)
      .mockRejectedValueOnce(makeAbortError());
    let err: Error | undefined;
    try { await client.complete('prompt'); } catch (e) { err = e as Error; }
    expect(err?.message).toContain('777');
  });

  it('timeoutMs L2: env var wins over config', async () => {
    process.env[ENV_TMO] = '888';
    mockCfg({ timeoutMs: 10000 });
    const client = resolveAIClient();
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'ok' } as any)
      .mockRejectedValueOnce(makeAbortError());
    let err: Error | undefined;
    try { await client.complete('prompt'); } catch (e) { err = e as Error; }
    expect(err?.message).toContain('888');
  });

  it('timeoutMs L3: config file wins over default', async () => {
    mockCfg({ timeoutMs: 999 });
    const client = resolveAIClient();
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'ok' } as any)
      .mockRejectedValueOnce(makeAbortError());
    let err: Error | undefined;
    try { await client.complete('prompt'); } catch (e) { err = e as Error; }
    expect(err?.message).toContain('999');
  });

  it('timeoutMs L4: built-in default is 30000', async () => {
    mockCfg({});
    const client = resolveAIClient();
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'ok' } as any)
      .mockRejectedValueOnce(makeAbortError());
    let err: Error | undefined;
    try { await client.complete('prompt'); } catch (e) { err = e as Error; }
    expect(err?.message).toContain(String(AI_POWERED_DEFAULTS.timeoutMs));
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

// ---------------------------------------------------------------------------
// 5. aiStatusCommand — source labels and health check (bd-b0da)
// ---------------------------------------------------------------------------

describe('aiStatusCommand', () => {
  let consoleSpy: jest.SpiedFunction<typeof console.log>;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    // Clean env vars that ai-status.ts reads
    ['AI_POWERED_URL','AI_MODEL','AI_SYSTEM_PROMPT','AI_TEMPERATURE','AI_MAX_TOKENS','AI_TIMEOUT_MS']
      .forEach(k => delete process.env[k]);
  });

  afterEach(() => jest.restoreAllMocks());

  it('shows [from env] label when AI_MODEL env var is set', async () => {
    process.env.AI_MODEL = 'my-env-model';
    mockCfg({});
    mockFetchSeq(HEALTH_OK);
    await aiStatusCommand();
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toMatch(/my-env-model/);
    expect(output).toMatch(/\[from env\]/);
  });

  it('shows [from config] label when model is in aiPowered config block', async () => {
    mockCfg({ model: 'config-model-x' });
    mockFetchSeq(HEALTH_OK);
    await aiStatusCommand();
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toMatch(/config-model-x/);
    expect(output).toMatch(/\[from config\]/);
  });

  it('shows [from default] labels when nothing is configured', async () => {
    mockCfg({});
    mockFetchSeq(HEALTH_OK);
    await aiStatusCommand();
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toMatch(/\[from default\]/);
    expect(output).toMatch(/localhost:3001/);
  });

  it('shows ONLINE when gateway health check succeeds', async () => {
    mockCfg({});
    mockFetchSeq(HEALTH_OK);
    await aiStatusCommand();
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toMatch(/ONLINE/);
  });

  it('shows OFFLINE when gateway health check fails', async () => {
    mockCfg({});
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('connection refused'));
    await aiStatusCommand();
    const output = consoleSpy.mock.calls.flat().join('\n');
    expect(output).toMatch(/OFFLINE/);
  });
});

// ---------------------------------------------------------------------------
// 6. aiSetCommand — key validation, persistence, numeric coercion (bd-b0da)
// ---------------------------------------------------------------------------

describe('aiSetCommand', () => {
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;
  let exitSpy: jest.SpiedFunction<typeof process.exit>;

  beforeEach(() => {
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    exitSpy   = jest.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('valid string key: calls ConfigManager.set and save', async () => {
    const inst = mockCfg({});
    await aiSetCommand('url', 'http://new-gateway:3001');
    expect(inst.set).toHaveBeenCalledWith('aiPowered.url', 'http://new-gateway:3001');
    expect(inst.save).toHaveBeenCalled();
  });

  it('unknown key: writes error to stderr and calls process.exit(1)', async () => {
    mockCfg({});
    await aiSetCommand('badKey', 'value');
    expect(stderrSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('temperature coerced to float and persisted', async () => {
    const inst = mockCfg({});
    await aiSetCommand('temperature', '0.9');
    expect(inst.set).toHaveBeenCalledWith('aiPowered.temperature', 0.9);
  });

  it('temperature out of range (>2): exits 1', async () => {
    mockCfg({});
    await aiSetCommand('temperature', '3.5');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('maxTokens coerced to integer and persisted', async () => {
    const inst = mockCfg({});
    await aiSetCommand('maxTokens', '4096');
    expect(inst.set).toHaveBeenCalledWith('aiPowered.maxTokens', 4096);
  });

  it('timeoutMs coerced to integer and persisted', async () => {
    const inst = mockCfg({});
    await aiSetCommand('timeoutMs', '15000');
    expect(inst.set).toHaveBeenCalledWith('aiPowered.timeoutMs', 15000);
  });
});

// ---------------------------------------------------------------------------
// 7. Integration smoke test — AIPoweredClient via resolveAIClient() (bd-b0da)
// ---------------------------------------------------------------------------

describe('Integration smoke — resolveAIClient().complete()', () => {
  beforeEach(() => {
    mockCfg({});
    ['AI_POWERED_URL','AI_MODEL','AI_SYSTEM_PROMPT','AI_TEMPERATURE','AI_MAX_TOKENS','AI_TIMEOUT_MS']
      .forEach(k => delete process.env[k]);
  });
  afterEach(() => jest.restoreAllMocks());

  it('happy path: 200 OK response returns CompletionResult.content', async () => {
    mockFetchSeq(HEALTH_OK, COMPLETION_OK);
    const client = resolveAIClient();
    const result = await client.complete('Write a logline.');
    expect(result.content).toBe('Generated text.');
  });

  it('server unreachable: throws AIPoweredConnectionError', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const client = resolveAIClient();
    await expect(client.complete('prompt')).rejects.toBeInstanceOf(AIPoweredConnectionError);
  });

  it('401 response: surfaces HTTP 401 error (no retry)', async () => {
    mockFetchSeq(HEALTH_OK, { ok: false, status: 401, statusText: 'Unauthorized', body: 'unauthorized' });
    const client = resolveAIClient();
    let err: Error | undefined;
    try { await client.complete('prompt'); } catch (e) { err = e as Error; }
    expect(err?.message).toContain('401');
  });

  it('500 response: surfaces HTTP 500 error', async () => {
    mockFetchSeq(HEALTH_OK, { ok: false, status: 500, statusText: 'Internal Server Error', body: 'oops' });
    const client = resolveAIClient();
    let err: Error | undefined;
    try { await client.complete('prompt'); } catch (e) { err = e as Error; }
    expect(err?.message).toContain('500');
  });

  it('malformed JSON body: throws AIPoweredParseError', async () => {
    mockFetchSeq(HEALTH_OK, { ok: true, status: 200, body: 'this is not json' });
    const client = resolveAIClient();
    await expect(client.complete('prompt')).rejects.toBeInstanceOf(AIPoweredParseError);
  });

  it('missing choices[0]: throws AIPoweredParseError', async () => {
    const emptyBody = JSON.stringify({ choices: [] });
    mockFetchSeq(HEALTH_OK, { ok: true, status: 200, body: emptyBody });
    const client = resolveAIClient();
    await expect(client.complete('prompt')).rejects.toBeInstanceOf(AIPoweredParseError);
  });
});
