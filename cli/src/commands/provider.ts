/**
 * Provider Command — Migration Stub
 *
 * The multi-provider AI abstraction has been removed as part of the
 * `replace-ai-with-ai-powered` migration (see openspec/changes/replace-ai-with-ai-powered/).
 *
 * Phase 2 (Deletion Pass) removed:
 *   - cli/src/utils/provider-registry.ts
 *   - cli/src/utils/profile-store.ts
 *   - cli/src/utils/custom-provider-store.ts
 *   - cli/src/utils/provider-validator.ts
 *   - cli/src/db/provider-repository.ts
 *
 * Phase 6 (CLI Changes) will replace these handlers with:
 *   - `filmbuff ai status`  — inspect resolved ai-powered configuration
 *   - `filmbuff ai set <key> <value>` — write to aiPowered config block
 *
 * Until Phase 6 is complete all provider / configure commands print a
 * human-readable deprecation notice and exit non-zero so that callers get
 * a clear signal that the command has been removed.
 *
 * OpenSpec: openspec/changes/replace-ai-with-ai-powered/
 */

import chalk from 'chalk';

// ---------------------------------------------------------------------------
// Deprecation helper
// ---------------------------------------------------------------------------

/**
 * Print a standard deprecation banner and exit non-zero.
 *
 * All provider / configure commands delegate here during the migration
 * period between Phase 2 (Deletion) and Phase 6 (CLI replacement).
 *
 * @param removedCommand  The command name the user attempted (for context).
 */
function deprecatedCommand(removedCommand: string): void {
  console.error(
    chalk.red(`\n✗ Command removed: filmbuff ${removedCommand}\n`)
  );
  console.error(
    chalk.yellow(
      '  The multi-provider AI abstraction has been removed.\n' +
      '  Use the ai-powered integration instead:\n\n' +
      '    filmbuff ai status           – inspect resolved configuration\n' +
      '    filmbuff ai set <key> <val>  – update ai-powered settings\n'
    )
  );
  console.error(
    chalk.gray(
      '  See: openspec/changes/replace-ai-with-ai-powered/\n'
    )
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Exported command stubs
//
// Each function below was a full implementation that depended on the five
// deleted source modules.  They are retained as typed stubs that:
//   1. Satisfy the TypeScript import in cli.ts (no type errors).
//   2. Inform callers that the command has been removed.
//   3. Exit non-zero to prevent silent failure.
//
// Phase 6 (CLI Changes) will delete these stubs and add `filmbuff ai status`
// and `filmbuff ai set` in their place.
// ---------------------------------------------------------------------------

// provider list
export function providerListCommand(_options: { json?: boolean; profiles?: boolean }): void {
  deprecatedCommand('provider list');
}



// provider show
export function providerShowCommand(
  _providerId: string,
  _profileName: string,
  _options: { json?: boolean }
): void {
  deprecatedCommand('provider show');
}

// provider validate
export function providerValidateCommand(_providerId: string, _profileName: string): void {
  deprecatedCommand('provider validate');
}

// provider activate
export function providerActivateCommand(_providerId: string, _profileName: string): void {
  deprecatedCommand('provider activate');
}

// provider delete
export function providerDeleteCommand(_providerId: string, _profileName: string): void {
  deprecatedCommand('provider delete');
}

// ---------------------------------------------------------------------------
// provider add  (supports --key-env and --key-encrypt)
// ---------------------------------------------------------------------------

/** @deprecated Removed in replace-ai-with-ai-powered migration Phase 2. */
export interface ProviderAddOptions {
  keyEnv?: string;
  keyEncrypt?: boolean;
  model?: string;
  endpoint?: string;
  json?: boolean;
}

/** @deprecated Removed in replace-ai-with-ai-powered migration Phase 2. */
export async function providerAddCommand(
  _providerId: string,
  _profileName: string,
  _options: ProviderAddOptions
): Promise<void> {
  deprecatedCommand('provider add');
}

// provider set (alias for activate)
export function providerSetCommand(_providerId: string, _profileName: string): void {
  deprecatedCommand('provider set');
}

// provider create
export async function providerCreateCommand(
  _providerId: string,
  _profileName: string,
  _options: { model?: string; endpoint?: string; json?: boolean }
): Promise<void> {
  deprecatedCommand('provider create');
}

// provider edit
export async function providerEditCommand(
  _providerId: string,
  _profileName: string,
  _options: { model?: string; endpoint?: string }
): Promise<void> {
  deprecatedCommand('provider edit');
}

// ---------------------------------------------------------------------------
// configure (Phase 6 replacement: filmbuff ai status / filmbuff ai set)
// ---------------------------------------------------------------------------

/**
 * Options accepted by the `filmbuff configure` command.
 *
 * @deprecated Removed in replace-ai-with-ai-powered Phase 2.
 *             Retained so cli.ts compiles without changes until Phase 6.
 */
export interface ConfigureOptions {
  listProviders?: boolean;
  listProfiles?: boolean;
  listProfilesForProvider?: string;
  createProfile?: string;
  editProfile?: string;
  deleteProfile?: string;
  activateProfile?: string;
}

export async function configureCommand(_options: ConfigureOptions = {}): Promise<void> {
  deprecatedCommand('configure');
}

// provider status
export function providerStatusCommand(_options: { json?: boolean } = {}): void {
  deprecatedCommand('provider status');
}
