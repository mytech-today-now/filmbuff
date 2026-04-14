/**
 * ai-status.ts — Phase 9 (bd-99b2)
 *
 * `filmbuff ai status` — show ai-powered library integration status.
 *
 * NEW (Phase 9): Uses ai-powered library in-process (no HTTP calls).
 * Shows Provider, Model, Mock Mode, Plugins, Available Models, Video Providers.
 * Command always exits 0 — works even with no server running.
 *
 * Output format:
 *   ai-powered Library Integration
 *     Provider:   anthropic              [from ~/.ai-powered/config.json]
 *     Model:      claude-3-5-sonnet      [from ~/.ai-powered/config.json]
 *     Mock Mode:  false                  [default]
 *     Plugins:    audit-log              [from filmbuff config]
 *
 *   Available Models:
 *     • claude-3-5-sonnet
 *     • claude-3-opus
 *
 *   Video Providers:
 *     • lumaai: dream-machine-v2, dream-machine-v1
 *
 * Spec: openspec/changes/ai-powered-not-local/specs/cli-surface/spec.md
 */

import chalk from 'chalk';
import { loadConfig } from '../utils/filmbuff-ai-client.js';
import { getDotEnvResult } from '../utils/env-loader.js';

// ---------------------------------------------------------------------------
// Static provider / model tables for display
// ---------------------------------------------------------------------------

/** Video-capable providers and their available models. */
const VIDEO_PROVIDERS: Array<{ id: string; models: string[] }> = [
  { id: 'lumaai',           models: ['dream-machine-v2', 'dream-machine-v1'] },
  { id: 'runway',           models: ['gen-3-alpha', 'gen-3-turbo'] },
  { id: 'stable-diffusion', models: ['sd-3-medium', 'sdxl-turbo'] },
];

/** Text-generation providers and their model lists. */
const TEXT_PROVIDER_MODELS: Record<string, string[]> = {
  anthropic:        ['claude-3-5-sonnet', 'claude-3-opus', 'claude-3-haiku'],
  openai:           ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  google:           ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-ultra'],
  xai:              ['grok-2', 'grok-2-mini'],
  venice:           ['venice-uncensored'],
  lumaai:           ['dream-machine-v2', 'dream-machine-v1'],
  runway:           ['gen-3-alpha', 'gen-3-turbo'],
  mock:             ['mock-model-fast', 'mock-model-accurate'],
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const LABEL_WIDTH = 14;
const VALUE_WIDTH = 28;

function sourceTag(source: string): string {
  if (source === 'dotenv')   return chalk.yellow('[from .env]');
  if (source === 'env')      return chalk.blue('[from shell env]');
  if (source === 'config')   return chalk.blue('[from ~/.ai-powered/config.json]');
  if (source === 'filmbuff') return chalk.cyan('[from filmbuff config]');
  return chalk.gray('[default]');
}

function row(name: string, value: string | boolean, source: string): string {
  const label = (name + ':').padEnd(LABEL_WIDTH);
  const val   = String(value).padEnd(VALUE_WIDTH);
  return `  ${chalk.white(label)} ${chalk.cyan(val)} ${sourceTag(source)}`;
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

/**
 * `filmbuff ai status` handler.
 *
 * Phase 9 (bd-99b2): Uses ai-powered library in-process — no HTTP request is
 * made. The command always exits 0, even when no server is running.
 */
export async function aiStatusCommand(): Promise<void> {
  console.log(chalk.bold('\nai-powered Library Integration'));

  // Resolve provider and model via loadConfig() — in-process, no network call.
  let provider  = 'unknown';
  let model     = 'unknown';
  let cfgSource = 'default';

  try {
    const cfg = await loadConfig() as Record<string, unknown>;
    if (typeof cfg['provider'] === 'string' && cfg['provider']) {
      provider  = cfg['provider'];
      cfgSource = 'config';
    }
    if (typeof cfg['model'] === 'string' && cfg['model']) {
      model = cfg['model'];
    }
  } catch {
    // If loadConfig fails (e.g. no config file), keep defaults — no HTTP fallback.
  }

  // Determine .env-awareness for env var source labelling.
  const dotEnvVars = getDotEnvResult()?.fromDotEnv ?? new Set<string>();

  // Override provider/model from AI_PROVIDER / AI_MODEL env vars (with .env awareness).
  const aiProviderEnv = process.env['AI_PROVIDER'];
  if (aiProviderEnv) {
    provider  = aiProviderEnv;
    cfgSource = dotEnvVars.has('AI_PROVIDER') ? 'dotenv' : 'env';
  }
  const aiModelEnv = process.env['AI_MODEL'];
  if (aiModelEnv) {
    model = aiModelEnv;
    // Keep cfgSource updated if model has a more specific source
    if (cfgSource === 'default') {
      cfgSource = dotEnvVars.has('AI_MODEL') ? 'dotenv' : 'env';
    }
  }

  // Mock mode: AI_MOCK env var overrides the provider display entirely.
  const mockEnvVal = process.env['AI_MOCK'];
  const mockMode   = mockEnvVal === 'true' || mockEnvVal === '1';
  const mockSource = mockEnvVal !== undefined
    ? (dotEnvVars.has('AI_MOCK') ? 'dotenv' : 'env')
    : 'default';

  if (mockMode) {
    provider  = 'mock';
    model     = 'mock-model-fast';
    cfgSource = 'env';
  }

  // Plugins: always from FILMBUFF_DEFAULTS (audit-log).
  const plugins = ['audit-log'];

  // Print status table.
  console.log(row('Provider',  provider, cfgSource));
  console.log(row('Model',     model,    cfgSource));
  console.log(row('Mock Mode', mockMode, mockSource));
  console.log(row('Plugins',   plugins.join(', '), 'filmbuff'));
  console.log('');

  // Available models for the active provider.
  const availModels = TEXT_PROVIDER_MODELS[provider] ?? [];
  console.log(chalk.bold('  Available Models:'));
  if (availModels.length === 0) {
    console.log(chalk.gray('    (no model list available for this provider)'));
  } else {
    for (const m of availModels) {
      console.log(`    • ${chalk.cyan(m)}`);
    }
  }
  console.log('');

  // Video providers.
  console.log(chalk.bold('  Video Providers:'));
  for (const vp of VIDEO_PROVIDERS) {
    console.log(`    • ${chalk.cyan(vp.id)}: ${vp.models.join(', ')}`);
  }
  console.log('');

  console.log(chalk.gray('  Configure provider: ai-powered config set provider <name>'));
  console.log(chalk.gray('  Configure API key:  ai-powered config set apiKey <key>'));
  console.log('');
}
