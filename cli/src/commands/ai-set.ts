/**
 * ai-set.ts — bd-6fw8 (Phase 6.3)
 *
 * `filmbuff ai set <key> <value>` — write a gateway parameter to the
 * `aiPowered` block in .augment/augment.json.
 *
 * Valid keys and their types:
 *   url          string  — gateway base URL
 *   model        string  — model identifier
 *   systemPrompt string  — system prompt injected into every completion
 *   temperature  number  — sampling temperature (0–2, parseFloat)
 *   maxTokens    integer — max response tokens (positive integer)
 *   timeoutMs    integer — request timeout in ms (positive integer)
 *
 * The written value becomes Level 3 in resolveAIClient()'s four-level chain:
 *   CLI overrides > env vars > config file (THIS) > built-in defaults
 *
 * Gate (bd-6fw8): `filmbuff ai set url http://localhost:3001` writes the
 * value and prints a confirmation; invalid key → exit 1 with usage hint;
 * npx tsc --noEmit clean.
 *
 * Spec: openspec/changes/ai-powered-not-local/specs/cli-surface/spec.md
 */

import chalk from 'chalk';
import { ConfigManager } from '../utils/config-system.js';

// ---------------------------------------------------------------------------
// Valid keys and their coercion rules
// ---------------------------------------------------------------------------

type NumericKey = 'temperature' | 'maxTokens' | 'timeoutMs';
type StringKey  = 'url' | 'model' | 'systemPrompt';
type ValidKey   = StringKey | NumericKey;

const NUMERIC_KEYS: ReadonlySet<string> = new Set<NumericKey>([
  'temperature',
  'maxTokens',
  'timeoutMs',
]);

const ALL_KEYS: ReadonlyArray<ValidKey> = [
  'url', 'model', 'systemPrompt', 'temperature', 'maxTokens', 'timeoutMs',
];

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

/** Parse and validate a numeric value for the given key. */
function coerceNumber(key: NumericKey, raw: string): number {
  if (key === 'temperature') {
    const n = parseFloat(raw);
    if (isNaN(n) || n < 0 || n > 2) {
      throw new RangeError(
        `temperature must be a number between 0 and 2 (got "${raw}").`,
      );
    }
    return n;
  }
  // maxTokens / timeoutMs — positive integer
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1 || String(n) !== raw.trim()) {
    throw new RangeError(
      `${key} must be a positive integer (got "${raw}").`,
    );
  }
  return n;
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

/**
 * `filmbuff ai set <key> <value>` handler.
 *
 * Loads .augment/augment.json (or uses defaults if absent), updates the
 * `aiPowered.<key>` field with a coerced value, persists to disk, and
 * prints a confirmation line.
 *
 * Exits non-zero on an invalid key or an out-of-range numeric value.
 */
export async function aiSetCommand(key: string, rawValue: string): Promise<void> {
  if (!ALL_KEYS.includes(key as ValidKey)) {
    process.stderr.write(
      chalk.red(`\nError: Unknown key "${key}".\n`) +
      chalk.gray(
        `  Valid keys: ${ALL_KEYS.join('  ')}\n` +
        `  Usage:      filmbuff ai set <key> <value>\n\n`,
      ),
    );
    process.exit(1);
  }

  // Coerce the value.
  let coerced: string | number;
  try {
    coerced = NUMERIC_KEYS.has(key)
      ? coerceNumber(key as NumericKey, rawValue)
      : rawValue;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(chalk.red(`\nError: ${msg}\n\n`));
    process.exit(1);
  }

  // Load existing config (creates default in-memory if file absent).
  const manager = new ConfigManager();
  manager.load();

  // Write into the aiPowered sub-tree.
  // ConfigManager.set() navigates/creates nested objects via dot-path.
  manager.set(`aiPowered.${key}`, coerced);

  // Validate the result before saving.
  const validation = manager.validate();
  if (!validation.valid) {
    process.stderr.write(
      chalk.red(`\nError: Resulting configuration is invalid:\n`) +
      validation.errors.map(e => `  • ${e}`).join('\n') + '\n\n',
    );
    process.exit(1);
  }

  manager.save();

  // Confirmation line — mirrors the display format of `filmbuff ai status`.
  const valueDisplay = typeof coerced === 'string' && coerced.length > 50
    ? coerced.slice(0, 47) + '…'
    : String(coerced);

  console.log(
    `${chalk.green('✓')} aiPowered.${chalk.white(key)} ` +
    `set to ${chalk.cyan(valueDisplay)} ` +
    chalk.gray('(written to .augment/augment.json)'),
  );
}
