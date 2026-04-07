/**
 * provider.ts — bd-xvwm (Phase 6.1)
 *
 * All `filmbuff provider *` and `filmbuff configure` sub-commands were removed
 * as part of the ai-powered-not-local migration (bd-zdru / bd-99b2).
 *
 * The ai-powered gateway now owns all provider/credential configuration.
 * FilmBuff's own settings (gateway URL, model, temperature, etc.) are managed
 * through `filmbuff ai set <key> <value>` and displayed via `filmbuff ai status`.
 *
 * Any invocation of a formerly-supported command prints a concise one-line
 * migration hint pointing to `filmbuff ai status` and exits non-zero.
 *
 * Gate (bd-xvwm): `filmbuff provider list` → fallback message + exit 1.
 * OpenSpec: openspec/changes/ai-powered-not-local/
 */

import chalk from 'chalk';

/**
 * Print a concise migration hint and exit non-zero.
 *
 * Called for every `filmbuff provider <subcmd>` and `filmbuff configure`
 * invocation so users know exactly where to look for the replacement workflow.
 *
 * @param removedCommand  Full command the user attempted (e.g. "provider list").
 */
export function unknownProviderCommand(removedCommand: string): never {
  process.stderr.write(
    chalk.red(`\nfilmbuff ${removedCommand}: command removed.\n`) +
    chalk.gray(
      `  Provider configuration is now handled by the ai-powered gateway.\n` +
      `  → Show current settings:  filmbuff ai status\n` +
      `  → Change a setting:       filmbuff ai set <key> <value>\n` +
      `  → Available keys:         url  model  systemPrompt  temperature  maxTokens  timeoutMs\n\n`,
    ),
  );
  process.exit(1);
}
