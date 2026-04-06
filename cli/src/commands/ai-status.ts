/**
 * ai-status.ts — Phase 9 (bd-99b2)
 *
 * `filmbuff ai status` — display ai-powered library integration status.
 *
 * All information is read from loadConfig() (disk + env vars) and a static
 * provider → model catalogue.  No HTTP requests are made — the command
 * succeeds even when no AI server is running.
 *
 * Output format (spec: openspec/changes/ai-powered-not-local/specs/cli-surface/spec.md):
 *   ai-powered Library Integration
 *     Provider:  <name>           [from ~/.ai-powered/config.json]
 *     Model:     <name>           [from ~/.ai-powered/config.json]
 *     Mock Mode: <true/false>     [AI_MOCK env]
 *     Plugins:   <list>           [from filmbuff config]
 *   Available Models: <list for current provider>
 *   Video Providers:  <list of video-capable providers>
 *
 * Phase 9 of ai-powered-not-local change (bd-99b2).
 */

import chalk from 'chalk';
import { loadConfig } from '../utils/filmbuff-ai-client.js';

// ---------------------------------------------------------------------------
// Static provider → known-model catalogue (no network call required)
// ---------------------------------------------------------------------------

/** Known text-generation models per provider. */
const PROVIDER_MODELS: Record<string, string[]> = {
  openai:    ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4', 'claude-haiku-3-5'],
  xai:       ['grok-2', 'grok-2-mini'],
  venice:    ['llama-3.3-70b', 'dolphin-2.9-llama3-8b'],
  lumaai:    ['dream-machine', 'photon-flash-2'],
  custom:    ['(configured in ~/.ai-powered/config.json)'],
  mock:      ['mock-model'],
};

/** Providers that support the video generation modality. */
const VIDEO_PROVIDERS = ['lumaai'];

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

/**
 * `filmbuff ai status` handler.
 *
 * Reads the resolved ai-powered config (loadConfig merges global config,
 * local config, env vars, and schema defaults) then displays a status table.
 * When AI_MOCK=true the provider is reported as "mock" regardless of config.
 */
export async function aiStatusCommand(): Promise<void> {
  const mockMode = process.env['AI_MOCK'] === 'true';

  let provider  = 'openai';
  let model: string | undefined;
  let plugins: string[] = ['audit-log'];

  try {
    const config = await loadConfig();
    provider = mockMode ? 'mock' : (config.provider ?? 'openai');
    model    = config.model;
    plugins  = Array.isArray(config.plugins) ? config.plugins : ['audit-log'];
  } catch {
    // loadConfig() throws ConfigError when no config file exists or validation
    // fails — continue with defaults so the command never exits non-zero.
    if (mockMode) provider = 'mock';
  }

  const modelDisplay   = model ?? '(provider default)';
  const pluginsDisplay = plugins.length > 0 ? plugins.join(', ') : '(none)';

  console.log(chalk.bold('\nai-powered Library Integration'));
  console.log(`  Provider:  ${chalk.cyan(provider.padEnd(14))} ${chalk.gray('[from ~/.ai-powered/config.json]')}`);
  console.log(`  Model:     ${chalk.cyan(modelDisplay.padEnd(14))} ${chalk.gray('[from ~/.ai-powered/config.json]')}`);
  console.log(`  Mock Mode: ${chalk.cyan(String(mockMode).padEnd(14))} ${chalk.gray('[AI_MOCK env]')}`);
  console.log(`  Plugins:   ${chalk.cyan(pluginsDisplay)} ${chalk.gray('[from filmbuff config]')}`);

  const knownModels = PROVIDER_MODELS[provider] ?? [];
  const modelsDisplay = knownModels.length > 0 ? knownModels.join(', ') : '(unknown provider)';
  console.log(chalk.bold('\nAvailable Models: ') + modelsDisplay);
  console.log(chalk.bold('Video Providers:  ') + VIDEO_PROVIDERS.join(', '));
  console.log();
}
