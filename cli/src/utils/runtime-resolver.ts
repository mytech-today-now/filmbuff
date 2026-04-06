/**
 * runtime-resolver.ts — Phase 4 rewrite
 *
 * Thin pass-through to getFilmbuffAiClient().  Downstream command handlers
 * that previously called resolveActiveProvider() or resolveProviderByProfile()
 * now call resolveAIClient() which delegates directly to the ai-powered
 * library via the single integration point in filmbuff-ai-client.ts.
 *
 * Legacy error classes (NoActiveProviderError, ProfileNotFoundError) and the
 * ResolvedProvider interface are preserved as named exports so that callers
 * compiled against the old API continue to typecheck without changes.  They
 * will be removed in a future cleanup pass once all callers have migrated.
 *
 * Phase 4 of ai-powered-not-local change (bd-6d52).
 * Spec: openspec/changes/ai-powered-not-local/design.md §2
 */

import { getFilmbuffAiClient } from './filmbuff-ai-client.js';
// AiClient and AiConfig are re-exported from filmbuff-ai-client.ts (the sole
// wrapper for the ai-powered library) so that this file stays clean.
import type { AiClient, AiConfig } from './filmbuff-ai-client.js';

// ---------------------------------------------------------------------------
// Public API — thin pass-through
// ---------------------------------------------------------------------------

/**
 * Resolve and return an AiClient for the given tool.
 *
 * This is the preferred entry point for command handlers.  It delegates to
 * getFilmbuffAiClient() so that FILMBUFF_DEFAULTS are always applied and the
 * sole import of 'ai-powered' stays in filmbuff-ai-client.ts.
 *
 * @param toolName  Identifies the calling feature (e.g. 'shot-list-generator').
 * @param overrides Optional per-call config overrides (no credential fields).
 */
export async function resolveAIClient(
  toolName: string,
  overrides?: Partial<Omit<AiConfig, 'apiKey'>>,
): Promise<AiClient> {
  return getFilmbuffAiClient(toolName, overrides);
}

// Re-export AiClient type for callers that type their cached reference.
export type { AiClient };

// ---------------------------------------------------------------------------
// Legacy error stubs — retained for backward-compat until callers migrate
// ---------------------------------------------------------------------------

/** @deprecated No longer thrown; retained for backward-compatibility. */
export class NoActiveProviderError extends Error {
  constructor() {
    super(
      'No active AI provider is configured. ' +
        "Run 'filmbuff provider activate <providerId> <profileName>' or " +
        "'filmbuff configure' to set one up."
    );
    this.name = 'NoActiveProviderError';
  }
}

/** @deprecated No longer thrown; retained for backward-compatibility. */
export class ProfileNotFoundError extends Error {
  constructor(providerId: string, profileName: string) {
    super(
      `Profile "${profileName}" for provider "${providerId}" not found. ` +
        "Run 'filmbuff provider list' to see available profiles."
    );
    this.name = 'ProfileNotFoundError';
  }
}


