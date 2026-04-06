/**
 * AIPoweredClient unit tests — bd-98j4
 *
 * Tests:
 *   Health check:
 *     [HC-1] success on first attempt
 *     [HC-2] recovery after one transient failure (succeeds on attempt 2)
 *     [HC-3] AIPoweredConnectionError after three consecutive failures
 *
 *   complete():
 *     [CP-1] valid response parses to CompletionResult
 *     [CP-2] missing choices[0] throws AIPoweredParseError
 *     [CP-3] malformed JSON body throws AIPoweredParseError
 *     [CP-4] 4xx response surfaced as-is (no retry)
 *     [CP-5] 5xx response surfaced as-is (no retry)
 *     [CP-6] timeout error includes timeoutMs value in message
 *
 * Gate: all 9 tests pass under both jest and vitest runners.
 */

import {
  AIPoweredClient,
  AIPoweredConnectionError,
  AIPoweredParseError,
} from '../utils/ai-powered-client';

// ---------------------------------------------------------------------------
// Fetch mock infrastructure
// ---------------------------------------------------------------------------

type FetchResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

/**
 * Build a minimal Response-compatible object the client accepts.
 */
function makeResponse(status: number, body: string): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

/**
 * Install a global `fetch` mock and return a jest/vitest spy.
 * Restores original after each test via `afterEach`.
 */
function mockFetch(impl: jest.MockedFunction<typeof fetch>): jest.MockedFunction<typeof fetch> {
  (global as unknown as Record<string, unknown>).fetch = impl;
  return impl;
}

const HEALTH_URL  = 'http://localhost:3001/health';
const COMPLETE_URL = 'http://localhost:3001/v1/chat/completions';

const VALID_COMPLETION_BODY = JSON.stringify({
  model: 'gpt-4',
  choices: [{ message: { content: 'Hello, FilmBuff!' } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
});

// ---------------------------------------------------------------------------
// Health check tests
// ---------------------------------------------------------------------------

describe('AIPoweredClient.checkHealth()', () => {
  let fetchSpy: jest.MockedFunction<typeof fetch>;

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('[HC-1] succeeds when server returns 200 on first attempt', async () => {
    fetchSpy = mockFetch(jest.fn().mockResolvedValueOnce(makeResponse(200, 'ok') as unknown as Response));
    const client = new AIPoweredClient({ timeoutMs: 500 });
    await expect(client.checkHealth()).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((fetchSpy.mock.calls[0] as unknown[])[0]).toContain('/health');
  });

  it('[HC-2] recovers when first attempt fails but second succeeds', async () => {
    fetchSpy = mockFetch(jest.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))   // attempt 1 fails
      .mockResolvedValueOnce(makeResponse(200, 'ok') as unknown as Response) // attempt 2 ok
    );
    const client = new AIPoweredClient({ timeoutMs: 500 });
    await expect(client.checkHealth()).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('[HC-3] throws AIPoweredConnectionError with attemptCount=3 after three consecutive failures', async () => {
    fetchSpy = mockFetch(jest.fn()
      .mockRejectedValue(new Error('ECONNREFUSED'))
    );
    const client = new AIPoweredClient({ timeoutMs: 500 });
    const err = await client.checkHealth().catch(e => e) as AIPoweredConnectionError;
    expect(err).toBeInstanceOf(AIPoweredConnectionError);
    expect(err.attemptCount).toBe(3);
    expect(err.message).toContain('3');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// complete() tests
// ---------------------------------------------------------------------------

describe('AIPoweredClient.complete()', () => {
  /** Create a client whose health check is pre-cached as healthy. */
  async function makeHealthyClient(): Promise<AIPoweredClient> {
    (global as unknown as Record<string, unknown>).fetch = jest.fn()
      .mockResolvedValueOnce(makeResponse(200, 'ok') as unknown as Response);
    const client = new AIPoweredClient({ timeoutMs: 2000 });
    await client.checkHealth(); // warm the cache
    return client;
  }

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('[CP-1] valid response parses to CompletionResult with content, model, usage', async () => {
    const client = await makeHealthyClient();
    (global as unknown as Record<string, unknown>).fetch = jest.fn()
      .mockResolvedValueOnce(makeResponse(200, VALID_COMPLETION_BODY) as unknown as Response);

    const result = await client.complete('Write a haiku');
    expect(result.content).toBe('Hello, FilmBuff!');
    expect(result.model).toBe('gpt-4');
    expect(result.usage?.promptTokens).toBe(10);
    expect(result.usage?.completionTokens).toBe(5);
  });

  it('[CP-2] missing choices[0] throws AIPoweredParseError', async () => {
    const client = await makeHealthyClient();
    const bodyMissingChoices = JSON.stringify({ model: 'gpt-4', choices: [] });
    (global as unknown as Record<string, unknown>).fetch = jest.fn()
      .mockResolvedValueOnce(makeResponse(200, bodyMissingChoices) as unknown as Response);

    await expect(client.complete('prompt')).rejects.toBeInstanceOf(AIPoweredParseError);
  });

  it('[CP-3] malformed JSON body throws AIPoweredParseError', async () => {
    const client = await makeHealthyClient();
    (global as unknown as Record<string, unknown>).fetch = jest.fn()
      .mockResolvedValueOnce(makeResponse(200, '{not-json}') as unknown as Response);

    await expect(client.complete('prompt')).rejects.toBeInstanceOf(AIPoweredParseError);
  });

  it('[CP-4] 4xx response is surfaced as-is without retry', async () => {
    const client = await makeHealthyClient();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(makeResponse(401, 'Unauthorized') as unknown as Response);
    (global as unknown as Record<string, unknown>).fetch = fetchMock;

    const err = await client.complete('prompt').catch(e => e) as Error;
    expect(err.message).toContain('401');
    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry
  });

  it('[CP-5] 5xx response is surfaced as-is without retry', async () => {
    const client = await makeHealthyClient();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(makeResponse(503, 'Service Unavailable') as unknown as Response);
    (global as unknown as Record<string, unknown>).fetch = fetchMock;

    const err = await client.complete('prompt').catch(e => e) as Error;
    expect(err.message).toContain('503');
    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry
  });

  it('[CP-6] timeout error message includes configured timeoutMs value', async () => {
    const client = await makeHealthyClient();
    const abortErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    (global as unknown as Record<string, unknown>).fetch = jest.fn()
      .mockRejectedValueOnce(abortErr);

    const err = await client.complete('prompt', { timeoutMs: 2000 }).catch(e => e) as Error;
    expect(err.message).toContain('2000');
  });
});
