/**
 * ai-provider-config.ts
 *
 * AI provider configuration utilities for FilmBuff.
 *
 * Phase 7 (bd-e8ad): All URL/model constants and legacy provider types removed.
 * FilmBuff now delegates all AI inference to the `ai-powered` npm library via
 * getFilmbuffAiClient().  Provider, model, API keys, and server URL are managed
 * exclusively by ai-powered's own layered config system (env vars,
 * ~/.ai-powered/config.json, etc.) — FilmBuff reads none of these.
 *
 * Removed in this phase:
 *   AI_POWERED_DEFAULT_URL   — no local server URL needed
 *   AI_POWERED_DEFAULT_MODEL — model config owned by ai-powered
 *   AIProviderConfig         — legacy generator plumbing (Phase 6 cleaned callers)
 *
 * Kept:
 *   normalizeAIProvider() — validates --ai-provider CLI flag (backward-compat)
 *   normalizeAIModel()    — validates --ai-model CLI flag (backward-compat)
 *
 * Spec: openspec/changes/ai-powered-not-local/specs/config-schema/spec.md
 */

// ---------------------------------------------------------------------------
// Normalisation helpers (kept for backward-compatibility with CLI flag handling)
// ---------------------------------------------------------------------------

/**
 * Normalise a raw --ai-provider flag value.
 * Returns undefined when the value is absent or blank (signals "use default").
 */
export function normalizeAIProvider(provider?: string | null): string | undefined {
  if (typeof provider !== 'string') {
    return undefined;
  }
  const normalized = provider.trim().toLowerCase();
  return normalized === '' ? undefined : normalized;
}

/**
 * Normalise a raw --ai-model flag value.
 * Returns undefined when the value is absent or blank (signals "use default").
 */
export function normalizeAIModel(model?: string | null): string | undefined {
  if (typeof model !== 'string') {
    return undefined;
  }
  const normalized = model.trim();
  return normalized === '' ? undefined : normalized;
}