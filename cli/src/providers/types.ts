/**
 * Provider Adapter Types
 *
 * Lightweight adapter contract used by built-in and custom AI provider
 * implementations in cli/src/providers/. Decouples command handlers from
 * SDK-specific call shapes.
 *
 * Satisfies: bd-prov-b1, bd-prov-b2
 */

// ---------------------------------------------------------------------------
// Generate contract
// ---------------------------------------------------------------------------

/** Options forwarded to the provider when generating a response. */
export interface GenerateOptions {
  /** Override the default model for this request. */
  model?: string;
  /**
   * Base URL override for OpenAI-compatible endpoints (Ollama, LocalAI, etc.)
   * Only respected by adapters that support it.
   */
  baseUrl?: string;
  /** Maximum tokens in the generated response. */
  maxTokens?: number;
  /** Sampling temperature (0 = deterministic, 1 = creative). */
  temperature?: number;
  /** Optional system prompt to prepend. */
  systemPrompt?: string;
  /** Pass-through options specific to a provider. */
  extra?: Record<string, unknown>;
}

/** Normalised result returned by every provider adapter. */
export interface GenerateResult {
  /** The generated text content. */
  content: string;
  /** Model actually used (if returned by the API). */
  model?: string;
  /** Token usage counters (if returned by the API). */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  /** Raw response from the underlying API (may be omitted in production). */
  raw?: unknown;
}

/**
 * Minimal adapter contract every built-in and custom provider must satisfy.
 * Command handlers call generate() and never import provider SDKs directly.
 */
export interface ProviderAdapter {
  generate(prompt: string, options?: GenerateOptions): Promise<GenerateResult>;
}

// ---------------------------------------------------------------------------
// Registry types
// ---------------------------------------------------------------------------

/** Metadata stored alongside each adapter in the registry. */
export interface AdapterEntry {
  /** Unique provider ID, e.g. "anthropic", "openai", "google-ai". */
  id: string;
  /** Human-readable display name. */
  displayName: string;
  /** True for adapters shipped with filmbuff; false for user-registered ones. */
  builtin: boolean;
  /** The adapter instance. */
  adapter: ProviderAdapter;
}

