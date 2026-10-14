/**
 * ai-powered-client.ts
 *
 * Single AI integration point for FilmBuff.
 * Communicates with a configured ai-powered gateway via Node built-in fetch.
 * Remote gateways must use HTTPS; HTTP is restricted to loopback development.
 * No AI vendor SDK is imported anywhere in this file.
 *
 * Implements:
 *   bd-gbwj  Phase 3.1 – Types, Interfaces & Error Classes
 *   bd-vlrl  Phase 3.2 – checkHealth() with Exponential Backoff
 *   bd-9alu  Phase 3.3 – complete() POST + Response Parsing
 *
 * Spec: openspec/changes/replace-ai-with-ai-powered/specs/ai-powered-client/spec.md
 * Design: openspec/changes/replace-ai-with-ai-powered/design.md
 *
 * Security: AIPoweredClientOptions intentionally contains NO credential fields
 * (apiKey, token, secret, password, credential).  Upstream auth is managed
 * exclusively by the ai-powered gateway.  An optional gateway bearer token may
 * be supplied via the AI_POWERED_AUTH_TOKEN environment variable; it is read
 * directly and is never stored in application state.
 *
 * Transport: Node.js built-in `fetch` (requires Node ≥ 18).
 */

import { isIP } from 'node:net';

// ---------------------------------------------------------------------------
// Types & Interfaces  (bd-gbwj)
// ---------------------------------------------------------------------------

/**
 * Configuration options accepted by AIPoweredClient.
 * All fields are optional at the call site; defaults are applied at
 * construction time from AI_POWERED_DEFAULTS.
 *
 * NOTE: This interface MUST NOT contain any field named apiKey, credential,
 * secret, token, or password.  See spec requirement "No Secrets Stored".
 */
export interface AIPoweredClientOptions {
  /** Gateway URL. Remote hosts require HTTPS; loopback HTTP is allowed. */
  url: string;
  /** Model identifier forwarded to the gateway. Default: gpt-4 */
  model: string;
  /** System prompt injected into every completion request. */
  systemPrompt: string;
  /** Sampling temperature (0–2). Default: 0.7 */
  temperature: number;
  /** Maximum tokens per response. Default: 2048 */
  maxTokens: number;
  /** Request timeout in milliseconds. Default: 30 000 */
  timeoutMs: number;
}

/**
 * Structured result returned by AIPoweredClient.complete().
 */
export interface CompletionResult {
  /** The generated text extracted from choices[0].message.content. */
  content: string;
  /** Model name as reported by the gateway response, if present. */
  model?: string;
  /** Token-usage counters from the gateway response, when provided. */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
  };
}

// ---------------------------------------------------------------------------
// Error Classes  (bd-gbwj)
// ---------------------------------------------------------------------------

/**
 * Thrown when the ai-powered gateway cannot be reached after all retry
 * attempts are exhausted.
 */
export class AIPoweredConnectionError extends Error {
  /** Sanitized origin that was contacted during each health-check attempt. */
  readonly attemptedUrl: string;
  /** Total number of attempts made before giving up. */
  readonly attemptCount: number;

  constructor(url: string, attemptCount: number) {
    const safeOrigin = getSafeOrigin(url);
    super(
      `Cannot reach ai-powered server at ${safeOrigin} after ${attemptCount} attempt(s). ` +
        `Verify that the configured gateway is running and accessible.`,
    );
    this.name = 'AIPoweredConnectionError';
    this.attemptedUrl = safeOrigin;
    this.attemptCount = attemptCount;
    // Restore prototype chain for instanceof checks in transpiled output.
    Object.setPrototypeOf(this, AIPoweredConnectionError.prototype);
  }
}

/** Thrown when an AI gateway URL violates the transport or URL policy. */
export class AIPoweredEndpointError extends Error {
  constructor(detail: string) {
    super(
      `Remote AI gateways require HTTPS; HTTP is allowed only for loopback development. ${detail}`,
    );
    this.name = 'AIPoweredEndpointError';
    Object.setPrototypeOf(this, AIPoweredEndpointError.prototype);
  }
}

/**
 * Parse and validate an AI gateway endpoint without including the supplied
 * value in an error. The returned URL is the normalized endpoint used for
 * health and completion requests.
 */
export function parseAIPoweredEndpoint(value: string): URL {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new AIPoweredEndpointError(
      'Provide an absolute URL with an http:// or https:// scheme.',
    );
  }

  const authorityMatch = /^https?:\/\/([^/?#]*)/i.exec(value);
  if (!authorityMatch) {
    throw new AIPoweredEndpointError(
      'The URL must be an absolute http:// or https:// URL.',
    );
  }

  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new AIPoweredEndpointError('The URL is malformed.');
  }

  if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') {
    throw new AIPoweredEndpointError(
      'The URL must use HTTPS, or HTTP for a loopback development host.',
    );
  }

  if (authorityMatch[1].includes('@') || endpoint.username || endpoint.password) {
    throw new AIPoweredEndpointError('Embedded URL credentials are not permitted.');
  }

  if (!endpoint.hostname) {
    throw new AIPoweredEndpointError('The URL must include a hostname.');
  }

  if (value.includes('#') || endpoint.hash) {
    throw new AIPoweredEndpointError('The URL must not include a fragment.');
  }

  if (endpoint.protocol === 'http:' && !isLoopbackHostname(endpoint.hostname)) {
    throw new AIPoweredEndpointError(
      'Use HTTPS for any AI gateway that is not a loopback development host.',
    );
  }

  return endpoint;
}

function isLoopbackHostname(hostname: string): boolean {
  const unbracketed = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  const normalized = unbracketed.toLowerCase().replace(/\.$/, '');

  if (normalized === 'localhost') return true;

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) return normalized.split('.')[0] === '127';
  return ipVersion === 6 && normalized === '::1';
}

function getSafeOrigin(value: string | URL): string {
  try {
    const endpoint = value instanceof URL ? value : new URL(value);
    return endpoint.origin === 'null' ? 'ai-powered gateway' : endpoint.origin;
  } catch {
    return 'ai-powered gateway';
  }
}

function buildRequestUrl(endpoint: URL, route: 'health' | 'v1/chat/completions'): string {
  const requestUrl = new URL(endpoint.toString());
  const basePath = requestUrl.pathname.replace(/\/+$/, '');
  requestUrl.pathname = `${basePath}/${route}`;
  return requestUrl.toString();
}

/**
 * Thrown when the gateway response does not contain the expected
 * choices[0].message.content field, or the body is not valid JSON.
 */
export class AIPoweredParseError extends Error {
  /** The raw response body that could not be parsed. */
  readonly rawBody: string;

  constructor(rawBody: string, detail?: string) {
    super(
      detail
        ? `Failed to parse ai-powered response: ${detail}`
        : 'Failed to parse ai-powered response: choices[0].message.content is missing or malformed.',
    );
    this.name = 'AIPoweredParseError';
    this.rawBody = rawBody;
    Object.setPrototypeOf(this, AIPoweredParseError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Built-in defaults
// ---------------------------------------------------------------------------

const BUILT_IN_SYSTEM_PROMPT =
  'You are FilmBuff, an expert AI assistant for film production. ' +
  'Provide structured, professional screenplay and production analysis. ' +
  'Format your responses clearly and concisely.';

/** Built-in defaults applied when no override is supplied. */
export const AI_POWERED_DEFAULTS: Required<AIPoweredClientOptions> = {
  url: 'http://localhost:3001',
  model: 'gpt-4',
  systemPrompt: BUILT_IN_SYSTEM_PROMPT,
  temperature: 0.7,
  maxTokens: 2048,
  timeoutMs: 30_000,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Pause for the given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Delays between health-check attempts (ms).
 * Attempt 1: immediate (0 ms).
 * Attempt 2: after 1 000 ms.
 * Attempt 3: after 2 000 ms.
 */
const HEALTH_CHECK_DELAYS = [0, 1_000, 2_000] as const;

// ---------------------------------------------------------------------------
// AIPoweredClient  (bd-vlrl, bd-9alu)
// ---------------------------------------------------------------------------

/**
 * The single AI integration point for FilmBuff.
 *
 * Usage:
 *   const client = new AIPoweredClient({ model: 'gpt-4o' });
 *   const result = await client.complete('Write a logline for...');
 *
 * Command handlers MUST NOT import any AI vendor SDK or contact an AI
 * endpoint directly; they MUST obtain an instance via resolveAIClient()
 * (runtime-resolver.ts) or construct AIPoweredClient directly.
 */
export class AIPoweredClient {
  private readonly options: Required<AIPoweredClientOptions>;
  private readonly endpoint: URL;
  /** Endpoint whose health check most recently succeeded. */
  private healthyEndpoint: string | undefined;

  constructor(options?: Partial<AIPoweredClientOptions>) {
    this.options = { ...AI_POWERED_DEFAULTS, ...options };
    this.endpoint = parseAIPoweredEndpoint(this.options.url);
  }

  // -------------------------------------------------------------------------
  // checkHealth()  — bd-vlrl  (Phase 3.2)
  // -------------------------------------------------------------------------

  /**
   * Verify that the ai-powered gateway is reachable.
   *
   * Makes up to three attempts with delays of 0 ms / 1 000 ms / 2 000 ms.
   * Caches a successful result — subsequent complete() calls in the same process
   * skip this check.
   *
   * @throws AIPoweredConnectionError if all three attempts fail.
   */
  async checkHealth(): Promise<void> {
    await this.checkHealthAt(this.endpoint);
  }

  private async checkHealthAt(endpoint: URL): Promise<void> {
    const endpointKey = endpoint.toString();
    if (this.healthyEndpoint === endpointKey) return;

    const { timeoutMs } = this.options;
    const healthUrl = buildRequestUrl(endpoint, 'health');

    for (let attempt = 0; attempt < HEALTH_CHECK_DELAYS.length; attempt++) {
      const delay = HEALTH_CHECK_DELAYS[attempt];
      if (delay > 0) {
        await sleep(delay);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(healthUrl, {
          method: 'GET',
          signal: controller.signal,
        });
      } catch {
        // Keep the underlying fetch error private: runtimes may include the
        // request URL or other sensitive data in its message.
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (response.ok) {
        this.healthyEndpoint = endpointKey;
        return;
      }
    }

    // All attempts exhausted.
    throw new AIPoweredConnectionError(endpoint.origin, HEALTH_CHECK_DELAYS.length);
  }

  // -------------------------------------------------------------------------
  // complete()  — bd-9alu  (Phase 3.3)
  // -------------------------------------------------------------------------

  /**
   * Send a completion request to the ai-powered gateway.
   *
   * Builds an OpenAI-compatible request body and POSTs it to
   * `{url}/v1/chat/completions`.  Parses `choices[0].message.content`
   * from the response.
   *
   * Per-call overrides (options) are merged over the instance defaults;
   * they follow the same rules as constructor options (no credential fields).
   *
   * @param prompt    The user-facing prompt text.
   * @param options   Optional per-call overrides (url, model, temperature, etc.).
   *
   * @throws AIPoweredConnectionError if the server is unreachable.
   * @throws AIPoweredParseError      if the response body is malformed.
   * @throws Error                    on HTTP 4xx/5xx or request timeout.
   */
  async complete(
    prompt: string,
    options?: Partial<AIPoweredClientOptions>,
  ): Promise<CompletionResult> {
    // Merge per-call overrides (do NOT mutate instance options).
    const resolved: Required<AIPoweredClientOptions> = {
      ...this.options,
      ...options,
    };
    const { url, model, systemPrompt, temperature, maxTokens, timeoutMs } = resolved;
    const endpoint = url === this.options.url
      ? this.endpoint
      : parseAIPoweredEndpoint(url);

    // Ensure the gateway is healthy before sending any completion request.
    await this.checkHealthAt(endpoint);

    // Optional gateway bearer token — read from env, never stored in options.
    const authToken = process.env['AI_POWERED_AUTH_TOKEN'];
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const requestBody = {
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(buildRequestUrl(endpoint, 'v1/chat/completions'), {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(
          `Request to ai-powered timed out after ${timeoutMs} ms. ` +
            `Increase the limit with --timeout or run: filmbuff ai set timeoutMs <value>`,
        );
      }
      throw new Error(
        'ai-powered request failed. Verify that the configured gateway is available and retry.',
      );
    } finally {
      clearTimeout(timer);
    }

    // Surface status only. Response bodies and status text can echo sensitive
    // request details supplied by a gateway.
    if (!response.ok) {
      throw new Error(`ai-powered returned HTTP ${response.status}.`);
    }

    // Parse response body.
    const rawBody = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new AIPoweredParseError(rawBody, 'Response body is not valid JSON.');
    }

    // Extract choices[0].message.content.
    const content = (parsed as any)?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new AIPoweredParseError(rawBody);
    }

    // Extract optional metadata.
    const responseData = parsed as any;
    const responseModel: unknown = responseData?.model;
    const usage: unknown = responseData?.usage;

    return {
      content,
      model: typeof responseModel === 'string' ? responseModel : undefined,
      usage:
        usage && typeof usage === 'object'
          ? {
              promptTokens:
                typeof (usage as Record<string, unknown>)['prompt_tokens'] === 'number'
                  ? ((usage as Record<string, unknown>)['prompt_tokens'] as number)
                  : undefined,
              completionTokens:
                typeof (usage as Record<string, unknown>)['completion_tokens'] === 'number'
                  ? ((usage as Record<string, unknown>)['completion_tokens'] as number)
                  : undefined,
            }
          : undefined,
    };
  }
}

