/**
 * runtime-resolver.ts — Phase 4.1 rewrite (bd-g2tp)
 *
 * Exports resolveAIClient(overrides?) — the single factory for AIPoweredClient.
 * Command handlers call this instead of any AI vendor SDK or ai-powered library.
 *
 * Four-level parameter resolution (per parameter, first defined value wins):
 *   1. overrides arg      — CLI flag values passed by the command handler
 *   2. Environment vars   — AI_POWERED_URL, AI_MODEL, AI_SYSTEM_PROMPT,
 *                           AI_TEMPERATURE, AI_MAX_TOKENS, AI_TIMEOUT_MS
 *   3. Config file        — aiPowered block from .augment/augment.json
 *   4. Built-in defaults  — AI_POWERED_DEFAULTS from ai-powered-client.ts
 *
 * Spec: openspec/changes/replace-ai-with-ai-powered/design.md §4
 * Implements: bd-g2tp  Phase 4.1 – Factory & Resolution Chain
 */

import { AIPoweredClient, AI_POWERED_DEFAULTS } from './ai-powered-client.js';
import type { AIPoweredClientOptions } from './ai-powered-client.js';
import { ConfigManager } from './config-system.js';

// ---------------------------------------------------------------------------
// Environment-variable key map
// ---------------------------------------------------------------------------

const ENV_MAP: Record<keyof AIPoweredClientOptions, string> = {
  url:          'AI_POWERED_URL',
  model:        'AI_MODEL',
  systemPrompt: 'AI_SYSTEM_PROMPT',
  temperature:  'AI_TEMPERATURE',
  maxTokens:    'AI_MAX_TOKENS',
  timeoutMs:    'AI_TIMEOUT_MS',
};

// ---------------------------------------------------------------------------
// resolveAIClient() — public factory
// ---------------------------------------------------------------------------

/**
 * Create an AIPoweredClient with per-parameter four-level resolution.
 *
 * Each of the six parameters (url, model, systemPrompt, temperature,
 * maxTokens, timeoutMs) is resolved independently so that, for example,
 * a user can pin `model` via an env var while relying on config for
 * `temperature` and built-in defaults for everything else.
 *
 * @param overrides  Optional per-invocation overrides (e.g. from CLI flags
 *                   --ai-model, --temperature, --max-tokens).  Any field
 *                   present here wins over all other sources.
 */
export function resolveAIClient(
  overrides?: Partial<AIPoweredClientOptions>,
): AIPoweredClient {
  // Level 3: config file — aiPowered block.
  // AugmentConfig.aiPowered now includes all six AIPoweredClientOptions fields
  // (Phase 5 bd-08b4 / Phase 6 bd-zdru) — no type assertion needed.
  const manager = new ConfigManager();
  const config = manager.load();
  const cfgBlock = config.aiPowered ?? {};

  const fromConfig: Partial<AIPoweredClientOptions> = {};
  if (typeof cfgBlock.url          === 'string') fromConfig.url          = cfgBlock.url;
  if (typeof cfgBlock.model        === 'string') fromConfig.model        = cfgBlock.model;
  if (typeof cfgBlock.systemPrompt === 'string') fromConfig.systemPrompt = cfgBlock.systemPrompt;
  if (typeof cfgBlock.temperature  === 'number') fromConfig.temperature  = cfgBlock.temperature;
  if (typeof cfgBlock.maxTokens    === 'number') fromConfig.maxTokens    = cfgBlock.maxTokens;
  if (typeof cfgBlock.timeoutMs    === 'number') fromConfig.timeoutMs    = cfgBlock.timeoutMs;

  // Level 2: environment variables
  const fromEnv: Partial<AIPoweredClientOptions> = {};

  const rawUrl = process.env[ENV_MAP.url];
  if (rawUrl !== undefined) fromEnv.url = rawUrl;

  const rawModel = process.env[ENV_MAP.model];
  if (rawModel !== undefined) fromEnv.model = rawModel;

  const rawSystemPrompt = process.env[ENV_MAP.systemPrompt];
  if (rawSystemPrompt !== undefined) fromEnv.systemPrompt = rawSystemPrompt;

  const rawTemperature = process.env[ENV_MAP.temperature];
  if (rawTemperature !== undefined) {
    const parsed = parseFloat(rawTemperature);
    if (!isNaN(parsed)) fromEnv.temperature = parsed;
  }

  const rawMaxTokens = process.env[ENV_MAP.maxTokens];
  if (rawMaxTokens !== undefined) {
    const parsed = parseInt(rawMaxTokens, 10);
    if (!isNaN(parsed)) fromEnv.maxTokens = parsed;
  }

  const rawTimeoutMs = process.env[ENV_MAP.timeoutMs];
  if (rawTimeoutMs !== undefined) {
    const parsed = parseInt(rawTimeoutMs, 10);
    if (!isNaN(parsed)) fromEnv.timeoutMs = parsed;
  }

  // Merge: defaults (L4) < config (L3) < env (L2) < overrides (L1)
  const resolved: Partial<AIPoweredClientOptions> = {
    ...AI_POWERED_DEFAULTS,  // Level 4: built-in defaults
    ...fromConfig,           // Level 3: config file
    ...fromEnv,              // Level 2: env vars
    ...overrides,            // Level 1: CLI overrides
  };

  return new AIPoweredClient(resolved);
}

// ---------------------------------------------------------------------------
// Legacy error stubs — retained for backward-compat until callers migrate
// ---------------------------------------------------------------------------

/** @deprecated No longer thrown; retained for backward-compatibility. */
export class NoActiveProviderError extends Error {
  constructor() {
    super(
      'No active AI provider is configured. ' +
        "Run 'filmbuff ai status' to check the ai-powered server, or " +
        "'filmbuff ai set url <url>' to configure it.",
    );
    this.name = 'NoActiveProviderError';
  }
}

/** @deprecated No longer thrown; retained for backward-compatibility. */
export class ProfileNotFoundError extends Error {
  constructor(providerId: string, profileName: string) {
    super(
      `Profile "${profileName}" for provider "${providerId}" not found. ` +
        "Run 'filmbuff ai status' to view current configuration.",
    );
    this.name = 'ProfileNotFoundError';
  }
}
