/**
 * ai-env.ts
 *
 * `filmbuff ai env` — show AI-related environment variables and their sources.
 *
 * For each recognised AI variable, reports:
 *   • Its current value (API keys are masked: first 8 chars + "…" + last 4)
 *   • Its source: [from .env] | [from shell] | (nothing if not set)
 *
 * Variables inspected:
 *   Provider/model   AI_PROVIDER, AI_MODEL, AI_PROFILE, AI_MOCK
 *   API keys         OPENAI_API_KEY, ANTHROPIC_API_KEY, LUMAAI_API_KEY,
 *                    RUNWAYML_API_SECRET, XAI_API_KEY, VENICE_API_KEY
 *   Custom endpoint  VENICE_BASE_URL, AI_POWERED_URL
 *   Gateway params   AI_SYSTEM_PROMPT, AI_TEMPERATURE, AI_MAX_TOKENS,
 *                    AI_TIMEOUT_MS
 *   Budget           AI_BUDGET_SESSION, AI_WARN_BUDGET
 */

import chalk from 'chalk';
import { getDotEnvResult } from '../utils/env-loader.js';

// ---------------------------------------------------------------------------
// Variable definitions
// ---------------------------------------------------------------------------

interface VarDef {
  name: string;
  label: string;
  /** When true the value is masked in output */
  sensitive: boolean;
}

const AI_VARS: VarDef[] = [
  // Provider & model selection
  { name: 'AI_PROVIDER',        label: 'Provider',        sensitive: false },
  { name: 'AI_MODEL',           label: 'Model',           sensitive: false },
  { name: 'AI_PROFILE',         label: 'Profile',         sensitive: false },
  { name: 'AI_MOCK',            label: 'Mock Mode',       sensitive: false },
  // API keys (sensitive)
  { name: 'OPENAI_API_KEY',     label: 'OpenAI Key',      sensitive: true  },
  { name: 'ANTHROPIC_API_KEY',  label: 'Anthropic Key',   sensitive: true  },
  { name: 'LUMAAI_API_KEY',     label: 'Luma AI Key',     sensitive: true  },
  { name: 'RUNWAYML_API_SECRET',label: 'Runway Secret',   sensitive: true  },
  { name: 'XAI_API_KEY',        label: 'xAI Key',         sensitive: true  },
  { name: 'VENICE_API_KEY',     label: 'Venice Key',      sensitive: true  },
  // Base URLs / custom endpoints
  { name: 'VENICE_BASE_URL',    label: 'Venice URL',      sensitive: false },
  { name: 'AI_POWERED_URL',     label: 'Gateway URL',     sensitive: false },
  // AIPoweredClient gateway params
  { name: 'AI_SYSTEM_PROMPT',   label: 'System Prompt',   sensitive: false },
  { name: 'AI_TEMPERATURE',     label: 'Temperature',     sensitive: false },
  { name: 'AI_MAX_TOKENS',      label: 'Max Tokens',      sensitive: false },
  { name: 'AI_TIMEOUT_MS',      label: 'Timeout (ms)',    sensitive: false },
  // Budget
  { name: 'AI_BUDGET_SESSION',  label: 'Session Budget',  sensitive: false },
  { name: 'AI_WARN_BUDGET',     label: 'Warn Threshold',  sensitive: false },
];

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const LABEL_W = 18;
const VALUE_W = 34;

function maskValue(val: string): string {
  if (val.length <= 12) return '***';
  return val.slice(0, 8) + '…' + val.slice(-4);
}

function sourceTag(varName: string, fromDotEnv: Set<string>): string {
  return fromDotEnv.has(varName)
    ? chalk.yellow('[from .env]')
    : chalk.blue('[from shell]');
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export async function aiEnvCommand(): Promise<void> {
  console.log(chalk.bold('\nFilmBuff — AI Environment Variables\n'));

  const result = getDotEnvResult();

  // Report .env load status
  if (!result) {
    console.log(chalk.gray('  (env-loader not initialised — run via filmbuff CLI)\n'));
  } else if (result.loaded) {
    console.log(chalk.green(`  ✓ .env loaded: ${result.filePath}`));
  } else {
    console.log(chalk.gray(`  ○ No .env file found at: ${result.filePath}`));
    console.log(chalk.gray('    Create a .env file in this directory to configure AI keys.\n'));
  }
  console.log('');

  const fromDotEnv = result?.fromDotEnv ?? new Set<string>();
  let anySet = false;

  for (const { name, label, sensitive } of AI_VARS) {
    const raw = process.env[name];
    if (!raw) continue;
    anySet = true;

    const displayed = sensitive ? maskValue(raw) : raw;
    const lbl = (label + ':').padEnd(LABEL_W);
    const val = displayed.length > VALUE_W - 2
      ? displayed.slice(0, VALUE_W - 3) + '…'
      : displayed;

    console.log(
      `  ${chalk.white(lbl)} ${chalk.cyan(val.padEnd(VALUE_W))} ${sourceTag(name, fromDotEnv)}`,
    );
  }

  if (!anySet) {
    console.log(chalk.yellow('  ⚠ No AI-related environment variables are set.'));
    console.log(chalk.gray('    Add API keys to your .env file, e.g.:'));
    console.log(chalk.gray('      OPENAI_API_KEY=sk-…'));
    console.log(chalk.gray('      AI_PROVIDER=openai'));
    console.log(chalk.gray('      AI_MODEL=gpt-4o'));
  }

  console.log('');
  console.log(chalk.gray('  Run `filmbuff ai status` to see the fully-resolved AI configuration.'));
  console.log('');
}
