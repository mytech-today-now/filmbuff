/**
 * filmbuff-ai-client.ts — sole integration point with the ai-powered library.
 *
 * IMPORTANT: This is the ONLY file in cli/src that may import from 'ai-powered'.
 * All other modules obtain an AiClient by calling getFilmbuffAiClient().
 *
 * Design (from openspec/changes/ai-powered-not-local/design.md §1 and
 * specs/filmbuff-ai-client/spec.md):
 *
 *   FILMBUFF_DEFAULTS is merged into every call so that FilmBuff-wide defaults
 *   (e.g. the audit-log plugin) are applied consistently without callers needing
 *   to know about them.  Caller-supplied overrides take precedence because they
 *   are spread AFTER the defaults:
 *
 *     getAiClient(toolName, { ...FILMBUFF_DEFAULTS, ...overrides })
 *
 *   toolName — every caller MUST supply a meaningful, non-empty string that
 *   identifies the feature area (e.g. 'blocking-extractor', 'entity-extractor').
 *   This label is included in audit-log records and surfaces in ai-powered
 *   diagnostics, making it easy to attribute AI spend to specific callers.
 *
 * Security: the overrides parameter intentionally does NOT accept apiKey,
 * credential, secret, token, or password.  Credentials are sourced exclusively
 * from the ai-powered config layers (env vars, ~/.ai-powered/config.json, etc.)
 * so that no secret ever flows through FilmBuff application code.
 *
 * Mock / test usage:
 *   Set AI_MOCK=true in the environment, or pass { mock: true } in overrides,
 *   to activate the ai-powered in-process MockProvider.  No network calls are
 *   made when mock mode is active.
 *
 * Phase 4 of ai-powered-not-local change (bd-6d52).
 * Spec: openspec/changes/ai-powered-not-local/specs/filmbuff-ai-client/spec.md
 */

import { getAiClient } from 'ai-powered';
import type { AiClient, AiConfig } from 'ai-powered';

// Re-export loadConfig so that ai-status.ts can read the resolved config without
// importing from 'ai-powered' directly (sole-importer rule: only this file may
// import from 'ai-powered').
export { loadConfig } from 'ai-powered';

// ---------------------------------------------------------------------------
// FilmBuff-wide defaults
// ---------------------------------------------------------------------------

/**
 * Defaults applied to every getFilmbuffAiClient() call unless overridden.
 *
 * plugins: ['audit-log'] — ensures every AI call is logged to the audit trail
 * so usage can be traced per toolName, provider, and token count.
 */
const FILMBUFF_DEFAULTS: Partial<AiConfig> = {
  plugins: ['audit-log'],
};

// ---------------------------------------------------------------------------
// Public API — named export only (no default export per spec)
// ---------------------------------------------------------------------------

/**
 * Create and return a fully configured AiClient for use within FilmBuff.
 *
 * Config layering (lowest → highest precedence):
 *   ai-powered global config → local config → named profile → AI_* env vars
 *   → FILMBUFF_DEFAULTS → caller overrides
 *
 * @param toolName  Identifies the calling feature (e.g. 'blocking-extractor').
 *                  Included in audit-log records. Must be non-empty.
 * @param overrides Optional per-call config that takes precedence over
 *                  FILMBUFF_DEFAULTS.  Must NOT contain credential fields
 *                  (apiKey, token, secret, password, credential).
 *
 * @throws ConfigError  if the merged config fails Zod validation.
 * @throws Error        if the resolved provider is not registered.
 */
export async function getFilmbuffAiClient(
  toolName: string,
  overrides?: Partial<Omit<AiConfig, 'apiKey'>>,
): Promise<AiClient> {
  return getAiClient(toolName, { ...FILMBUFF_DEFAULTS, ...overrides });
}

// Re-export library types so downstream modules can type their references
// without importing from 'ai-powered' directly.
// (Only this file may import from 'ai-powered' — spec requirement.)
export type { AiClient, AiConfig };
