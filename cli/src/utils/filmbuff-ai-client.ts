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

// Type-only imports are erased at compile time — safe in CJS output.
import type { AiClient, AiConfig } from 'ai-powered';

// ---------------------------------------------------------------------------
// Lazy ESM loader
// ---------------------------------------------------------------------------
// ai-powered is ESM-only ("type":"module", no "require" export condition).
// TypeScript with "module":"commonjs" compiles `import()` calls into
// `Promise.resolve().then(() => require(...))`, which fails for ESM-only
// packages because require() cannot load ES modules.
//
// Fix: wrap the import() call in `new Function(...)` so TypeScript cannot
// detect and transform it.  At runtime, Node.js ≥14 executes this as a true
// native dynamic import() and correctly resolves the "import" export condition.
//
// The cached _aiPowered reference means the module is resolved at most once.

type AiPoweredModule = typeof import('ai-powered');
let _aiPowered: AiPoweredModule | undefined;

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const _dynamicImport: (specifier: string) => Promise<AiPoweredModule> =
  new Function('specifier', 'return import(specifier)') as (s: string) => Promise<AiPoweredModule>;

async function _load(): Promise<AiPoweredModule> {
  if (!_aiPowered) {
    _aiPowered = await _dynamicImport('ai-powered');
  }
  return _aiPowered;
}

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
  const { getAiClient } = await _load();
  return getAiClient(toolName, { ...FILMBUFF_DEFAULTS, ...overrides });
}

/**
 * Async wrapper around ai-powered's loadConfig().
 *
 * Exposed here so ai-status.ts can read the resolved config without importing
 * from 'ai-powered' directly (sole-importer rule: only this file may import
 * from 'ai-powered').  The function is async because the ESM module must be
 * dynamically imported before loadConfig() can be called.
 */
export async function loadConfig(): Promise<AiConfig> {
  const { loadConfig: _loadConfig } = await _load();
  return _loadConfig();
}

// Re-export library types so downstream modules can type their references
// without importing from 'ai-powered' directly.
// (Only this file may import from 'ai-powered' — spec requirement.)
export type { AiClient, AiConfig };
