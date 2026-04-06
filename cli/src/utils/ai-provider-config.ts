/**
 * ai-provider-config.ts
 *
 * AI provider configuration utilities for FilmBuff.
 *
 * Phase 5 (bd-08b4): Legacy multi-provider registry constants removed.
 * FilmBuff now delegates all AI inference to the user-managed `ai-powered`
 * server.  The sole source of truth for defaults is AIPoweredClient.
 *
 * Constants kept:
 *   AI_POWERED_DEFAULT_URL   — default ai-powered server URL
 *   AI_POWERED_DEFAULT_MODEL — default model forwarded to the server
 *
 * Removed (were part of multi-provider abstraction, no longer relevant):
 *   DEFAULT_AI_PROVIDER      — was 'anthropic'; replaced by ai-powered
 *   DEFAULT_AI_MODEL         — was 'claude-sonnet-4-6'; replaced by ai-powered
 *   IMPLEMENTED_AI_PROVIDERS — registry tuple; no longer needed
 *   isImplementedAIProvider  — guard function; no longer needed
 *   ImplementedAIProvider    — union type derived from registry; no longer needed
 *
 * Note: normalizeAIProvider / normalizeAIModel are kept because the
 * generate-shot-list command still accepts legacy --ai-provider/--ai-model
 * flags for the AI (text) path and normalises them identically.
 */

// ---------------------------------------------------------------------------
// ai-powered defaults (replaces old multi-provider defaults)
// ---------------------------------------------------------------------------

/** Default base URL of the local ai-powered server. */
export const AI_POWERED_DEFAULT_URL = 'http://localhost:3001';

/** Default model identifier forwarded to the ai-powered server. */
export const AI_POWERED_DEFAULT_MODEL = 'gpt-4';

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

/**
 * Legacy AI provider config shape carried through the shot-list generator.
 * Still used to plumb --ai-provider / --ai-model CLI flags into generator
 * options until Phase 6 migration (bd-4g4l) completes.
 *
 * TODO (bd-4g4l): Remove AIProviderConfig and its usages once the generator
 * is fully wired to AIPoweredClient.
 */
export type AIProviderConfig = {
  aiProvider?: string;
  aiModel?: string;
};

// ---------------------------------------------------------------------------
// Normalisation helpers (kept for backward-compatibility with CLI flag handling)
// ---------------------------------------------------------------------------

export function normalizeAIProvider(provider?: string | null): string | undefined {
  if (typeof provider !== 'string') {
    return undefined;
  }
  const normalized = provider.trim().toLowerCase();
  return normalized === '' ? undefined : normalized;
}

export function normalizeAIModel(model?: string | null): string | undefined {
  if (typeof model !== 'string') {
    return undefined;
  }
  const normalized = model.trim();
  return normalized === '' ? undefined : normalized;
}