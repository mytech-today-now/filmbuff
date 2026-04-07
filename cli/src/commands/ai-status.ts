/**
 * ai-status.ts — bd-n0l1 (Phase 6.2)
 *
 * `filmbuff ai status` — show the resolved ai-powered gateway configuration
 * with a source label for every parameter, then probe gateway health.
 *
 * Resolution mirrors resolveAIClient() four-level chain:
 *   1. (CLI flag overrides — not applicable for the status command itself)
 *   2. Environment variables — AI_POWERED_URL, AI_MODEL, AI_SYSTEM_PROMPT,
 *                              AI_TEMPERATURE, AI_MAX_TOKENS, AI_TIMEOUT_MS
 *   3. Config file            — aiPowered block in .augment/augment.json
 *   4. Built-in defaults      — AI_POWERED_DEFAULTS from ai-powered-client.ts
 *
 * Output format:
 *   ai-powered Gateway Status
 *     url:          http://localhost:3001   [from default]
 *     model:        gpt-4                  [from env]
 *     systemPrompt: (FilmBuff default)     [from default]
 *     temperature:  0.7                    [from config]
 *     maxTokens:    2048                   [from default]
 *     timeoutMs:    30000                  [from default]
 *   Gateway health: ✓ ONLINE  (http://localhost:3001/health)
 *
 * Gate (bd-n0l1): source labels appear; health check result shown.
 * Spec: openspec/changes/ai-powered-not-local/specs/cli-surface/spec.md
 */

import chalk from 'chalk';
import { AIPoweredClient, AI_POWERED_DEFAULTS } from '../utils/ai-powered-client.js';
import type { AIPoweredClientOptions } from '../utils/ai-powered-client.js';
import { ConfigManager } from '../utils/config-system.js';

// ---------------------------------------------------------------------------
// Source-tracking types
// ---------------------------------------------------------------------------

type ParamSource = 'env' | 'config' | 'default';

interface Resolved<T> {
  value: T;
  source: ParamSource;
}

// Environment variable names (mirrors runtime-resolver.ts ENV_MAP)
const ENV = {
  url:          'AI_POWERED_URL',
  model:        'AI_MODEL',
  systemPrompt: 'AI_SYSTEM_PROMPT',
  temperature:  'AI_TEMPERATURE',
  maxTokens:    'AI_MAX_TOKENS',
  timeoutMs:    'AI_TIMEOUT_MS',
} as const satisfies Record<keyof AIPoweredClientOptions, string>;

// ---------------------------------------------------------------------------
// Resolution with source tracking
// ---------------------------------------------------------------------------

/** Resolve a string parameter through env → config → default. */
function resolveStr(
  envKey: string,
  configVal: string | undefined,
  defaultVal: string,
): Resolved<string> {
  const envVal = process.env[envKey];
  if (envVal !== undefined) return { value: envVal, source: 'env' };
  if (configVal !== undefined) return { value: configVal, source: 'config' };
  return { value: defaultVal, source: 'default' };
}

/** Resolve a numeric parameter through env → config → default. */
function resolveNum(
  envKey: string,
  parse: (s: string) => number,
  configVal: number | undefined,
  defaultVal: number,
): Resolved<number> {
  const envStr = process.env[envKey];
  if (envStr !== undefined) {
    const n = parse(envStr);
    if (!isNaN(n)) return { value: n, source: 'env' };
  }
  if (configVal !== undefined) return { value: configVal, source: 'config' };
  return { value: defaultVal, source: 'default' };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const LABEL_WIDTH   = 14;   // left column width for parameter names
const VALUE_WIDTH   = 26;   // value column width

function sourceTag(source: ParamSource): string {
  if (source === 'env')    return chalk.yellow('[from env]');
  if (source === 'config') return chalk.blue('[from config]');
  return chalk.gray('[from default]');
}

function paramRow(name: string, value: string | number, source: ParamSource): string {
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
 * Resolves the six AIPoweredClientOptions with per-parameter source tracking,
 * prints the results in a table, then calls checkHealth() on the resolved URL
 * and prints a PASS / FAIL result.
 *
 * The command exits 0 regardless of gateway health so that `filmbuff ai status`
 * can always be used as a diagnostic even when the gateway is offline.
 */
export async function aiStatusCommand(): Promise<void> {
  // Level 3: read config file
  const manager   = new ConfigManager();
  const config    = manager.load();
  const cfgBlock  = config.aiPowered ?? {};

  // Resolve each parameter independently (levels 2-4; level 1 / CLI flags
  // are not available to the status command itself).
  const rUrl   = resolveStr(ENV.url,          cfgBlock.url,          AI_POWERED_DEFAULTS.url);
  const rModel = resolveStr(ENV.model,        cfgBlock.model,        AI_POWERED_DEFAULTS.model);
  const rSysP  = resolveStr(ENV.systemPrompt, cfgBlock.systemPrompt, AI_POWERED_DEFAULTS.systemPrompt);
  const rTemp  = resolveNum(ENV.temperature,  parseFloat, cfgBlock.temperature, AI_POWERED_DEFAULTS.temperature);
  const rMax   = resolveNum(ENV.maxTokens,    (s) => parseInt(s, 10), cfgBlock.maxTokens,  AI_POWERED_DEFAULTS.maxTokens);
  const rTmo   = resolveNum(ENV.timeoutMs,    (s) => parseInt(s, 10), cfgBlock.timeoutMs,  AI_POWERED_DEFAULTS.timeoutMs);

  // Shorten the system prompt for display (first 40 chars)
  const sysPDisplay = rSysP.value.length > 40
    ? rSysP.value.slice(0, 37) + '…'
    : rSysP.value;

  console.log(chalk.bold('\nai-powered Gateway Status'));
  console.log(paramRow('url',          rUrl.value,       rUrl.source));
  console.log(paramRow('model',        rModel.value,     rModel.source));
  console.log(paramRow('systemPrompt', sysPDisplay,      rSysP.source));
  console.log(paramRow('temperature',  rTemp.value,      rTemp.source));
  console.log(paramRow('maxTokens',    rMax.value,       rMax.source));
  console.log(paramRow('timeoutMs',    rTmo.value,       rTmo.source));

  // Health check — create a client from the resolved parameters and probe.
  console.log('');
  const client = new AIPoweredClient({
    url:          rUrl.value,
    model:        rModel.value,
    systemPrompt: rSysP.value,
    temperature:  rTemp.value,
    maxTokens:    rMax.value,
    timeoutMs:    rTmo.value,
  });

  const healthUrl = `${rUrl.value}/health`;
  try {
    await client.checkHealth();
    console.log(
      `  Gateway health: ${chalk.green('✓ ONLINE')}  ${chalk.gray(`(${healthUrl})`)}`,
    );
  } catch {
    console.log(
      `  Gateway health: ${chalk.red('✗ OFFLINE')} ${chalk.gray(`(${healthUrl})`)}`,
    );
    console.log(
      chalk.gray(
        `  Start the ai-powered gateway or set a different URL:\n` +
        `    filmbuff ai set url <url>`,
      ),
    );
  }

  // Hint for making changes.
  console.log('');
  console.log(chalk.gray('  To change a setting: filmbuff ai set <key> <value>'));
  console.log(chalk.gray('  Keys: url  model  systemPrompt  temperature  maxTokens  timeoutMs'));
  console.log('');
}
