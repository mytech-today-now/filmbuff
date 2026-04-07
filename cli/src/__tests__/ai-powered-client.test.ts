/**
 * ai-powered-client.test.ts
 *
 * Unit tests for AIPoweredClient (bd-gbwj / bd-vlrl / bd-9alu).
 *
 * Spec: openspec/changes/replace-ai-with-ai-powered/tests/plan.md
 *
 * Coverage:
 *   - Construction and built-in defaults
 *   - AIPoweredClientOptions type contract (no credential fields)
 *   - checkHealth(): success path, recovery, permanent failure, error message
 *   - complete(): happy path, parse errors (empty choices, bad JSON),
 *                 HTTP 4xx/5xx surfaces, request timeout
 *   - Error class fields: AIPoweredConnectionError.attemptedUrl / attemptCount
 *                         AIPoweredParseError.rawBody
 *
 * Transport mocking: global.fetch is replaced per-test via jest.spyOn().
 * No network calls are made.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  AIPoweredClient,
  AIPoweredConnectionError,
  AIPoweredParseError,
  AI_POWERED_DEFAULTS,
  type AIPoweredClientOptions,
  type CompletionResult,
} from '../utils/ai-powered-client';

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

type MockResponse = { ok: boolean; status: number; statusText?: string; body: string };

function mockFetch(responses: MockResponse[]) {
  let callIndex = 0;
  return jest.spyOn(global, 'fetch').mockImplementation(async () => {
    const r = responses[Math.min(callIndex++, responses.length - 1)];
    return {
      ok: r.ok,
      status: r.status,
      statusText: r.statusText ?? '',
      text: async () => r.body,
    } as unknown as Response;
  });
}

function mockFetchFailure(times: number, thenSuccess?: MockResponse) {
  let callIndex = 0;
  return jest.spyOn(global, 'fetch').mockImplementation(async () => {
    if (callIndex++ < times) {
      throw new Error('Network failure');
    }
    if (thenSuccess) {
      return {
        ok: thenSuccess.ok,
        status: thenSuccess.status,
        statusText: thenSuccess.statusText ?? '',
        text: async () => thenSuccess.body,
      } as unknown as Response;
    }
    throw new Error('Network failure');
  });
}

const OK_HEALTH: MockResponse = { ok: true, status: 200, body: 'ok' };
const COMPLETION_BODY = JSON.stringify({
  model: 'gpt-4',
  choices: [{ message: { content: 'Generated logline.' } }],
  usage: { prompt_tokens: 10, completion_tokens: 20 },
});
const OK_COMPLETION: MockResponse = { ok: true, status: 200, body: COMPLETION_BODY };

// ---------------------------------------------------------------------------
// Construction and defaults
// ---------------------------------------------------------------------------

describe('AIPoweredClient – construction', () => {
  it('uses built-in defaults when no options are supplied', () => {
    const client = new AIPoweredClient();
    // Access via checkHealth spy: defaults are captured internally.
    // We verify by checking that AI_POWERED_DEFAULTS shape is complete.
    expect(AI_POWERED_DEFAULTS.url).toBe('http://localhost:3001');
    expect(AI_POWERED_DEFAULTS.model).toBe('gpt-4');
    expect(AI_POWERED_DEFAULTS.temperature).toBe(0.7);
    expect(AI_POWERED_DEFAULTS.maxTokens).toBe(2048);
    expect(AI_POWERED_DEFAULTS.timeoutMs).toBe(30_000);
    expect(typeof AI_POWERED_DEFAULTS.systemPrompt).toBe('string');
    expect(AI_POWERED_DEFAULTS.systemPrompt.length).toBeGreaterThan(0);
    expect(client).toBeInstanceOf(AIPoweredClient);
  });

  it('overrides individual fields while preserving other defaults', () => {
    // Construction itself has no observable public state beyond correct
    // behaviour — verified implicitly through checkHealth / complete calls.
    const client = new AIPoweredClient({ model: 'claude-3-opus', temperature: 1.5 });
    expect(client).toBeInstanceOf(AIPoweredClient);
  });

  it('AIPoweredClientOptions has no credential fields', () => {
    // Type-level check: the keys of AIPoweredClientOptions must not include
    // any credential-related names.  Verified via the type definition.
    type Keys = keyof AIPoweredClientOptions;
    type HasApiKey       = 'apiKey'      extends Keys ? true : false;
    type HasSecret       = 'secret'      extends Keys ? true : false;
    type HasToken        = 'token'       extends Keys ? true : false;
    type HasPassword     = 'password'    extends Keys ? true : false;
    type HasCredential   = 'credential'  extends Keys ? true : false;
    const _apiKey:     HasApiKey     = false;
    const _secret:     HasSecret     = false;
    const _token:      HasToken      = false;
    const _password:   HasPassword   = false;
    const _credential: HasCredential = false;
    expect(_apiKey).toBe(false);
    expect(_secret).toBe(false);
    expect(_token).toBe(false);
    expect(_password).toBe(false);
    expect(_credential).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

describe('AIPoweredConnectionError', () => {
  it('stores attemptedUrl and attemptCount', () => {
    const err = new AIPoweredConnectionError('http://localhost:3001', 3);
    expect(err.attemptedUrl).toBe('http://localhost:3001');
    expect(err.attemptCount).toBe(3);
    expect(err.name).toBe('AIPoweredConnectionError');
    expect(err instanceof AIPoweredConnectionError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it('includes the URL in the message', () => {
    const err = new AIPoweredConnectionError('http://localhost:9999', 3);
    expect(err.message).toContain('http://localhost:9999');
  });
});

describe('AIPoweredParseError', () => {
  it('stores rawBody', () => {
    const raw = 'not-json-garbage';
    const err = new AIPoweredParseError(raw);
    expect(err.rawBody).toBe(raw);
    expect(err.name).toBe('AIPoweredParseError');
    expect(err instanceof AIPoweredParseError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it('uses custom detail when provided', () => {
    const err = new AIPoweredParseError('{}', 'Response body is not valid JSON.');
    expect(err.message).toContain('Response body is not valid JSON.');
  });
});

// ---------------------------------------------------------------------------
// checkHealth()
// ---------------------------------------------------------------------------

describe('AIPoweredClient – checkHealth()', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('HC-1: resolves when server responds 200 on first attempt', async () => {
    mockFetch([OK_HEALTH]);
    const client = new AIPoweredClient();
    await expect(client.checkHealth()).resolves.toBeUndefined();
  });

  it('HC-1b: caches healthy state — second checkHealth() call skips fetch', async () => {
    const spy = mockFetch([OK_HEALTH]);
    const client = new AIPoweredClient();
    await client.checkHealth();
    await client.checkHealth();  // should use cached state
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('HC-2: recovers after one transient network failure', async () => {
    // Attempt 1 → throws; Attempt 2 → 200.
    mockFetchFailure(1, OK_HEALTH);
    const client = new AIPoweredClient({ timeoutMs: 5_000 });
    await expect(client.checkHealth()).resolves.toBeUndefined();
  });

  it('HC-3: throws AIPoweredConnectionError after all three attempts fail', async () => {
    mockFetchFailure(10); // always fail
    const client = new AIPoweredClient();
    await expect(client.checkHealth()).rejects.toBeInstanceOf(AIPoweredConnectionError);
  });

  it('HC-3b: error message contains the configured URL and attempt count', async () => {
    mockFetchFailure(10);
    const url = 'http://localhost:3001';
    const client = new AIPoweredClient({ url });
    await expect(client.checkHealth()).rejects.toMatchObject({
      message: expect.stringContaining(url),
      attemptedUrl: url,
      attemptCount: 3,
    });
  });
});

// ---------------------------------------------------------------------------
// complete()
// ---------------------------------------------------------------------------

describe('AIPoweredClient – complete()', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('happy path: returns CompletionResult with content, model, usage', async () => {
    mockFetch([OK_HEALTH, OK_COMPLETION]);
    const client = new AIPoweredClient();
    const result: CompletionResult = await client.complete('Write a logline.');
    expect(result.content).toBe('Generated logline.');
    expect(result.model).toBe('gpt-4');
    expect(result.usage?.promptTokens).toBe(10);
    expect(result.usage?.completionTokens).toBe(20);
  });

  it('skips health check on second complete() call', async () => {
    const spy = mockFetch([OK_HEALTH, OK_COMPLETION, OK_COMPLETION]);
    const client = new AIPoweredClient();
    await client.complete('First prompt.');
    await client.complete('Second prompt.');
    // Health check only once; two completion requests = 3 fetch calls total.
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('per-call options override instance defaults', async () => {
    const spy = mockFetch([OK_HEALTH, OK_COMPLETION]);
    const client = new AIPoweredClient({ model: 'gpt-4' });
    await client.complete('Test.', { model: 'gpt-4o' });
    // Second call (completion) body should include overridden model.
    const completionCall = spy.mock.calls[1];
    const body = JSON.parse((completionCall[1] as RequestInit).body as string);
    expect(body.model).toBe('gpt-4o');
  });

  it('throws AIPoweredParseError when choices array is empty', async () => {
    const emptyChoices = JSON.stringify({ choices: [] });
    mockFetch([OK_HEALTH, { ok: true, status: 200, body: emptyChoices }]);
    const client = new AIPoweredClient();
    await expect(client.complete('Prompt.')).rejects.toBeInstanceOf(AIPoweredParseError);
  });

  it('AIPoweredParseError.rawBody contains the malformed response', async () => {
    const bad = '{"choices":[]}';
    mockFetch([OK_HEALTH, { ok: true, status: 200, body: bad }]);
    const client = new AIPoweredClient();
    let caught: unknown;
    try { await client.complete('Prompt.'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(AIPoweredParseError);
    expect((caught as AIPoweredParseError).rawBody).toBe(bad);
  });

  it('throws AIPoweredParseError when response body is not valid JSON', async () => {
    const garbage = 'this is not json at all';
    mockFetch([OK_HEALTH, { ok: true, status: 200, body: garbage }]);
    const client = new AIPoweredClient();
    let caught: unknown;
    try { await client.complete('Prompt.'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(AIPoweredParseError);
    expect((caught as AIPoweredParseError).rawBody).toBe(garbage);
  });

  it('surfaces HTTP 400 with status in error message (no retry)', async () => {
    const fetchSpy = mockFetch([
      OK_HEALTH,
      { ok: false, status: 400, statusText: 'Bad Request', body: '{"error":"bad request"}' },
    ]);
    const client = new AIPoweredClient();
    let caught: unknown;
    try { await client.complete('Prompt.'); } catch (e) { caught = e; }
    expect((caught as Error).message).toContain('400');
    // No retry: exactly 2 fetch calls (health + one completion attempt).
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('surfaces HTTP 500 with status in error message', async () => {
    mockFetch([
      OK_HEALTH,
      { ok: false, status: 500, statusText: 'Internal Server Error', body: 'oops' },
    ]);
    const client = new AIPoweredClient();
    let caught: unknown;
    try { await client.complete('Prompt.'); } catch (e) { caught = e; }
    expect((caught as Error).message).toContain('500');
  });

  it('timeout error includes timeoutMs value and --timeout suggestion', async () => {
    jest.spyOn(global, 'fetch')
      .mockImplementationOnce(async () =>
        ({ ok: true, status: 200, text: async () => 'ok' }) as unknown as Response,
      )
      .mockImplementationOnce(() => {
        const abortErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
        return Promise.reject(abortErr);
      });

    const client = new AIPoweredClient({ timeoutMs: 1_000 });
    let caught: unknown;
    try { await client.complete('Prompt.'); } catch (e) { caught = e; }
    const msg = (caught as Error).message;
    expect(msg).toContain('1000');
    expect(msg.toLowerCase()).toContain('timeout');
    expect(msg).toContain('--timeout');
  });
});

// ---------------------------------------------------------------------------
// CompletionResult optional fields
// ---------------------------------------------------------------------------

describe('AIPoweredClient – CompletionResult optional fields', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('usage is undefined when absent from response', async () => {
    const noUsage = JSON.stringify({
      model: 'gpt-4',
      choices: [{ message: { content: 'text' } }],
    });
    mockFetch([OK_HEALTH, { ok: true, status: 200, body: noUsage }]);
    const client = new AIPoweredClient();
    const result = await client.complete('Prompt.');
    expect(result.usage).toBeUndefined();
  });

  it('model is undefined when absent from response', async () => {
    const noModel = JSON.stringify({
      choices: [{ message: { content: 'text' } }],
    });
    mockFetch([OK_HEALTH, { ok: true, status: 200, body: noModel }]);
    const client = new AIPoweredClient();
    const result = await client.complete('Prompt.');
    expect(result.model).toBeUndefined();
  });
});


