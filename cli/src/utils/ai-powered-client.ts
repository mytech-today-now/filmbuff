/**
 * AIPoweredClient — sole AI integration point for FilmBuff.
 *
 * Encapsulates HTTP communication with the user-managed `ai-powered`
 * local gateway (https://github.com/mytech-today-now/ai-powered).
 *
 * Public API:
 *   checkHealth()           — verify server reachability (3 attempts, exponential back-off)
 *   complete(prompt, opts?) — POST /v1/chat/completions; returns CompletionResult
 *
 * Spec: openspec/changes/replace-ai-with-ai-powered/
 * Beads: bd-98j4 (unit tests), bd-6sg7 (parent)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AIPoweredClientOptions {
  /** Base URL of the ai-powered server. Default: http://localhost:3001 */
  url: string;
  /** Model identifier forwarded to the server. Default: gpt-4 */
  model: string;
  /** Optional system-level prompt prepended to every request. */
  systemPrompt?: string;
  /** Sampling temperature (0–1). Default: 0.7 */
  temperature: number;
  /** Maximum tokens to generate. Default: 2048 */
  maxTokens: number;
  /** HTTP request timeout in milliseconds. Default: 30000 */
  timeoutMs: number;
}

export interface CompletionOptions {
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface CompletionResult {
  content: string;
  model?: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class AIPoweredConnectionError extends Error {
  /** Number of connection attempts made before giving up. Always 3 for checkHealth(). */
  readonly attemptCount: number;

  constructor(url: string, attemptCount: number, cause?: unknown) {
    super(
      `Cannot connect to ai-powered server at ${url} after ${attemptCount} attempt${attemptCount !== 1 ? 's' : ''}.\n` +
      'Please verify that ai-powered is running and accessible.\n' +
      'If using a non-loopback address, check firewall settings.'
    );
    this.name = 'AIPoweredConnectionError';
    this.attemptCount = attemptCount;
    if (cause instanceof Error) this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
  }
}

export class AIPoweredParseError extends Error {
  readonly rawBody: string;
  constructor(message: string, rawBody: string) {
    super(message);
    this.name = 'AIPoweredParseError';
    this.rawBody = rawBody;
  }
}

// ---------------------------------------------------------------------------
// Default option values
// ---------------------------------------------------------------------------

export const AI_POWERED_DEFAULT_URL   = 'http://localhost:3001';
export const AI_POWERED_DEFAULT_MODEL = 'gpt-4';

const DEFAULTS: AIPoweredClientOptions = {
  url:          AI_POWERED_DEFAULT_URL,
  model:        AI_POWERED_DEFAULT_MODEL,
  temperature:  0.7,
  maxTokens:    2048,
  timeoutMs:    30_000,
};

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class AIPoweredClient {
  private readonly opts: AIPoweredClientOptions;
  /** Cached healthy state — skip further health checks within the same process. */
  private healthy = false;

  constructor(options: Partial<AIPoweredClientOptions> = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------

  /**
   * Verify the ai-powered server is reachable.
   *
   * Algorithm (bd-vlrl spec):
   *   - Up to 3 total attempts with exponential back-off: 0 s / 1 s / 2 s between attempts.
   *   - Uses GET /health (HEAD is also acceptable per spec; GET gives a response body for debugging).
   *   - Caches healthy=true on first success; subsequent calls within the same process are free.
   *   - Throws AIPoweredConnectionError(attemptCount=3) when all three attempts fail.
   */
  async checkHealth(): Promise<void> {
    if (this.healthy) return;

    const MAX_ATTEMPTS = 3;
    const delays = [0, 1000, 2000]; // pre-attempt wait in ms (0s, 1s, 2s)
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (delays[attempt] > 0) {
        await sleep(delays[attempt]);
      }
      try {
        const response = await fetchWithTimeout(
          `${this.opts.url}/health`,
          { method: 'GET' },
          this.opts.timeoutMs
        );
        if (response.ok) {
          this.healthy = true;
          return;
        }
        lastError = new Error(`Health check returned HTTP ${response.status}`);
      } catch (err) {
        lastError = err;
      }
    }

    throw new AIPoweredConnectionError(this.opts.url, MAX_ATTEMPTS, lastError);
  }

  // -------------------------------------------------------------------------
  // Completions
  // -------------------------------------------------------------------------

  /**
   * POST /v1/chat/completions and return parsed CompletionResult.
   *
   * Throws:
   *   AIPoweredConnectionError — server unreachable (propagated from checkHealth)
   *   AIPoweredParseError      — response body is not valid JSON or missing choices[0]
   *   Error                    — 4xx / 5xx surfaced as-is (no retry)
   */
  async complete(prompt: string, options: CompletionOptions = {}): Promise<CompletionResult> {
    await this.checkHealth();

    const model       = options.model       ?? this.opts.model;
    const temperature = options.temperature ?? this.opts.temperature;
    const maxTokens   = options.maxTokens   ?? this.opts.maxTokens;
    const timeoutMs   = options.timeoutMs   ?? this.opts.timeoutMs;
    const systemPrompt = options.systemPrompt ?? this.opts.systemPrompt;

    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const body = JSON.stringify({ model, temperature, max_tokens: maxTokens, messages });

    let response: Response;
    try {
      response = await fetchWithTimeout(
        `${this.opts.url}/v1/chat/completions`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        },
        timeoutMs
      );
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(
          `AI request timed out after ${timeoutMs} ms. ` +
          `Increase timeoutMs via config or --timeout flag.`
        );
      }
      throw err;
    }

    const rawBody = await response.text();

    // Surface 4xx / 5xx without retry (server handles upstream retries)
    if (!response.ok) {
      const httpErr = new Error(`HTTP ${response.status}: ${rawBody}`);
      (httpErr as NodeJS.ErrnoException).code = String(response.status);
      throw httpErr;
    }

    // Parse JSON and validate structure
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new AIPoweredParseError(
        `Response body is not valid JSON: ${rawBody.slice(0, 200)}`,
        rawBody
      );
    }

    const content = extractContent(parsed);
    if (content === null) {
      throw new AIPoweredParseError(
        `Response missing choices[0].message.content`,
        rawBody
      );
    }

    const anyParsed = parsed as Record<string, unknown>;
    const usage = extractUsage(anyParsed.usage);

    return {
      content,
      model: (anyParsed.model as string | undefined) ?? model,
      usage,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractContent(parsed: unknown): string | null {
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'choices' in parsed &&
    Array.isArray((parsed as Record<string, unknown>).choices) &&
    ((parsed as Record<string, unknown>).choices as unknown[])[0] !== undefined
  ) {
    const first = ((parsed as Record<string, unknown>).choices as unknown[])[0];
    if (
      first !== null &&
      typeof first === 'object' &&
      'message' in first &&
      (first as Record<string, unknown>).message !== null &&
      typeof (first as Record<string, unknown>).message === 'object' &&
      'content' in ((first as Record<string, unknown>).message as object) &&
      typeof ((first as Record<string, unknown>).message as Record<string, unknown>).content === 'string'
    ) {
      return ((first as Record<string, unknown>).message as Record<string, unknown>).content as string;
    }
  }
  return null;
}

function extractUsage(raw: unknown): CompletionResult['usage'] {
  if (raw === null || typeof raw !== 'object') return undefined;
  const u = raw as Record<string, unknown>;
  return {
    promptTokens:     typeof u.prompt_tokens     === 'number' ? u.prompt_tokens     : undefined,
    completionTokens: typeof u.completion_tokens === 'number' ? u.completion_tokens : undefined,
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
