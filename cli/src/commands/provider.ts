/**
 * provider.ts — Phase 9 (bd-99b2)
 *
 * All individual `filmbuff provider *` and `filmbuff configure` sub-commands
 * have been removed as part of the ai-powered-not-local migration.
 *
 * Provider configuration is now managed exclusively by the `ai-powered`
 * npm library — FilmBuff owns neither credentials nor provider registrations.
 *
 * Any invocation of a formerly-supported command prints the spec-mandated
 * migration guidance (deltas.md Delta 4) and exits non-zero.
 *
 * OpenSpec: openspec/changes/ai-powered-not-local/
 */

import chalk from 'chalk';

/**
 * Print the spec-mandated migration guidance message and exit non-zero.
 *
 * Called by every route that used to handle a `provider *` or `configure`
 * invocation.
 *
 * @param removedCommand  Full command the user attempted (e.g. "provider list").
 */
export function unknownProviderCommand(removedCommand: string): never {
  process.stderr.write(
    chalk.red(`\nError: Unknown command "${removedCommand}". Provider configuration is now managed by ai-powered.\n`) +
    `  Run: ai-powered config set provider <name>\n` +
    `       ai-powered config set apiKey <key>\n` +
    `  See: filmbuff ai status\n\n`,
  );
  process.exit(1);
}
