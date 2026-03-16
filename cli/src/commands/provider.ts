/**
 * Provider Command
 *
 * CLI workflows to list, create, show, validate, delete, and activate
 * named provider profiles. Also implements "filmbuff configure" as a
 * guided setup flow that shares the provider domain model.
 *
 * Satisfies: bd-ai-providers.7 – Phase 4: Add CLI provider management
 *            and guided configure flow
 * OpenSpec: openspec/changes/configurable-ai-providers/specs/provider-management/spec.md
 */

import chalk from 'chalk';
import * as readline from 'readline';
import type { ProviderProfile } from '../types/ai-providers.js';
import { providerRegistry } from '../utils/provider-registry.js';
import { customProviderStore } from '../utils/custom-provider-store.js';
import { profileStore } from '../utils/profile-store.js';
import { validateProfile } from '../utils/provider-validator.js';
import { redactProfile } from '../utils/redaction.js';
import {
  DEFAULT_PROVIDER_PANEL_STATE,
  loadProviderPanelState,
  saveProviderPanelState,
  selectProviderProfile,
  setProviderPanelView,
} from '../gui/state/provider-state.js';


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureProviders(): void {
  customProviderStore.loadIntoRegistry();
}

function printSeparator(): void {
  console.log(chalk.gray('─'.repeat(60)));
}

function printValidation(providerId: string, profileName: string): void {
  const profile = profileStore.load(providerId, profileName);
  if (!profile) {
    console.log(chalk.red('  ✗ Profile not found'));
    return;
  }
  const result = validateProfile(profile);
  if (result.valid) {
    console.log(chalk.green('  ✓ Validation passed'));
  } else {
    console.log(chalk.red('  ✗ Validation failed:'));
    result.errors.forEach((e) => console.log(chalk.red(`    • ${e}`)));
  }
}

// ---------------------------------------------------------------------------
// provider list
// ---------------------------------------------------------------------------

export function providerListCommand(options: { json?: boolean; profiles?: boolean }): void {
  ensureProviders();
  const active = profileStore.getActive();

  if (options.profiles) {
    // List all saved profiles across all providers
    const profiles = profileStore.listAll().map((p) => redactProfile(p));
    if (options.json) {
      console.log(JSON.stringify({ active, profiles }, null, 2));
      return;
    }
    console.log(chalk.bold.blue('\nSaved Profiles:\n'));
    if (profiles.length === 0) {
      console.log(chalk.yellow('  No profiles configured. Run: filmbuff configure'));
      return;
    }
    profiles.forEach((p) => {
      const isActive = active?.providerId === p.providerId && active?.profileName === p.profileName;
      const marker = isActive ? chalk.green(' ★ ACTIVE') : '';
      console.log(`  ${chalk.bold(p.profileName)}${marker}`);
      console.log(`    Provider: ${p.providerId}`);
      console.log(`    Settings: ${JSON.stringify(p.settings)}`);
      console.log(`    Secrets:  ${JSON.stringify((p as any).secretRefs)}`);
      printValidation(p.providerId, p.profileName);
      console.log();
    });
    return;
  }

  // List registered providers
  const providers = providerRegistry.list();
  if (options.json) {
    console.log(JSON.stringify(providers.map((p) => ({
      id: p.id, type: p.type, displayName: p.displayName,
      description: p.description, capabilities: p.capabilities,
    })), null, 2));
    return;
  }
  console.log(chalk.bold.blue('\nRegistered AI Providers:\n'));
  providers.forEach((p) => {
    console.log(`  ${chalk.bold(p.id)} ${chalk.gray(`(${p.type})`)}`);
    console.log(`    ${p.displayName} – ${p.description}`);
    console.log(`    Capabilities: ${p.capabilities.join(', ')}`);
    console.log();
  });
  if (active) {
    console.log(chalk.green(`Active: ${active.providerId} / ${active.profileName}`));
  } else {
    console.log(chalk.yellow('No active provider set. Run: filmbuff configure'));
  }
  console.log();
}



// ---------------------------------------------------------------------------
// provider show
// ---------------------------------------------------------------------------

export function providerShowCommand(
  providerId: string,
  profileName: string,
  options: { json?: boolean }
): void {
  ensureProviders();
  const profile = profileStore.load(providerId, profileName);
  if (!profile) {
    console.error(chalk.red(`Profile "${profileName}" not found for provider "${providerId}".`));
    process.exit(1);
  }
  const safe = redactProfile(profile);
  if (options.json) {
    console.log(JSON.stringify(safe, null, 2));
    return;
  }
  printSeparator();
  console.log(chalk.bold(`Profile: ${profile.profileName}`));
  console.log(`  Provider: ${profile.providerId}`);
  console.log(`  Settings: ${JSON.stringify(profile.settings)}`);
  console.log(`  Secrets:  ${JSON.stringify((safe as any).secretRefs)}`);
  if (profile.model) console.log(`  Model:    ${profile.model}`);
  if (profile.endpoint) console.log(`  Endpoint: ${profile.endpoint}`);
  printValidation(providerId, profileName);
  printSeparator();
}

// ---------------------------------------------------------------------------
// provider validate
// ---------------------------------------------------------------------------

export function providerValidateCommand(
  providerId: string,
  profileName: string
): void {
  ensureProviders();
  const profile = profileStore.load(providerId, profileName);
  if (!profile) {
    console.error(chalk.red(`Profile "${profileName}" not found for provider "${providerId}".`));
    process.exit(1);
  }
  const result = validateProfile(profile);
  if (result.valid) {
    console.log(chalk.green(`✓ Profile "${profileName}" is valid.`));
  } else {
    console.error(chalk.red(`✗ Profile "${profileName}" has errors:`));
    result.errors.forEach((e) => console.error(chalk.red(`  • ${e}`)));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// provider activate
// ---------------------------------------------------------------------------

export function providerActivateCommand(
  providerId: string,
  profileName: string
): void {
  ensureProviders();
  const profile = profileStore.load(providerId, profileName);
  if (!profile) {
    console.error(chalk.red(`Profile "${profileName}" not found for provider "${providerId}".`));
    process.exit(1);
  }
  const result = validateProfile(profile);
  if (!result.valid) {
    console.error(chalk.red('Cannot activate invalid profile:'));
    result.errors.forEach((e) => console.error(chalk.red(`  • ${e}`)));
    process.exit(1);
  }
  profileStore.setActive({ providerId, profileName });
  console.log(chalk.green(`✓ Activated provider "${providerId}" with profile "${profileName}".`));
}

// ---------------------------------------------------------------------------
// provider delete
// ---------------------------------------------------------------------------

export function providerDeleteCommand(
  providerId: string,
  profileName: string
): void {
  const deleted = profileStore.delete(providerId, profileName);
  if (!deleted) {
    console.error(chalk.red(`Profile "${profileName}" not found for provider "${providerId}".`));
    process.exit(1);
  }
  // Clear active selection if it pointed to the deleted profile
  const active = profileStore.getActive();
  if (active?.providerId === providerId && active?.profileName === profileName) {
    profileStore.clearActive();
    console.log(chalk.yellow('Active provider selection cleared.'));
  }
  console.log(chalk.green(`✓ Deleted profile "${profileName}" for provider "${providerId}".`));
}


// ---------------------------------------------------------------------------
// Readline prompt helper
// ---------------------------------------------------------------------------

async function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function promptSecret(rl: readline.Interface, label: string): Promise<string> {
  return prompt(rl, chalk.yellow(`  ${label} (env ref recommended, e.g. env:MY_API_KEY): `));
}

// ---------------------------------------------------------------------------
// provider create
// ---------------------------------------------------------------------------

export async function providerCreateCommand(
  providerId: string,
  profileName: string,
  options: { model?: string; endpoint?: string; json?: boolean }
): Promise<void> {
  ensureProviders();

  if (!providerRegistry.has(providerId)) {
    console.error(chalk.red(`Provider "${providerId}" is not registered. Run: filmbuff provider list`));
    process.exit(1);
  }

  const provider = providerRegistry.get(providerId)!;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log(chalk.bold.blue(`\nCreate profile "${profileName}" for ${provider.displayName}\n`));

    // Gather settings
    const settings: Record<string, string> = {};
    for (const field of provider.settingsSchema) {
      const def = field.defaultValue ? ` [${field.defaultValue}]` : '';
      const val = await prompt(rl, chalk.cyan(`  ${field.label}${def}: `));
      settings[field.key] = val || field.defaultValue || '';
      if (!settings[field.key]) delete settings[field.key];
    }

    // Gather secrets as env refs
    const secretRefs: Record<string, string> = {};
    for (const field of provider.credentialSchema) {
      const val = await promptSecret(rl, field.label);
      secretRefs[field.key] = val || '';
      if (!secretRefs[field.key]) delete secretRefs[field.key];
    }

    const now = new Date().toISOString();
    const profile: ProviderProfile = {
      providerId,
      profileName,
      settings,
      secretRefs,
      model: options.model,
      endpoint: options.endpoint,
      createdAt: now,
      updatedAt: now,
    };

    const result = validateProfile(profile);
    if (!result.valid) {
      console.error(chalk.red('\nValidation errors:'));
      result.errors.forEach((e) => console.error(chalk.red(`  • ${e}`)));
      const cont = await prompt(rl, chalk.yellow('Save anyway? (y/N): '));
      if (cont.trim().toLowerCase() !== 'y') {
        console.log(chalk.gray('Aborted.'));
        rl.close();
        return;
      }
    }

    profileStore.save(profile);
    console.log(chalk.green(`\n✓ Profile "${profileName}" created for "${providerId}".`));
    console.log(chalk.gray(`  Run: filmbuff provider activate ${providerId} ${profileName}`));
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// provider edit
// ---------------------------------------------------------------------------

export async function providerEditCommand(
  providerId: string,
  profileName: string,
  options: { model?: string; endpoint?: string }
): Promise<void> {
  ensureProviders();

  const existing = profileStore.load(providerId, profileName);
  if (!existing) {
    console.error(chalk.red(`Profile "${profileName}" not found for provider "${providerId}".`));
    process.exit(1);
  }

  const provider = providerRegistry.get(providerId);
  if (!provider) {
    console.error(chalk.red(`Provider "${providerId}" is not registered.`));
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log(chalk.bold.blue(`\nEdit profile "${profileName}" for ${provider.displayName}\n`));
    console.log(chalk.gray('  Press Enter to keep the current value.\n'));

    const settings: Record<string, string> = { ...existing.settings };
    for (const field of provider.settingsSchema) {
      const cur = settings[field.key] || field.defaultValue || '';
      const val = await prompt(rl, chalk.cyan(`  ${field.label} [${cur}]: `));
      if (val.trim()) settings[field.key] = val.trim();
    }

    const secretRefs: Record<string, string> = { ...existing.secretRefs };
    for (const field of provider.credentialSchema) {
      const cur = secretRefs[field.key] ? '[set]' : '[empty]';
      const val = await promptSecret(rl, `${field.label} (current: ${cur})`);
      if (val.trim()) secretRefs[field.key] = val.trim();
    }

    const updated: ProviderProfile = {
      ...existing,
      settings,
      secretRefs,
      model: options.model ?? existing.model,
      endpoint: options.endpoint ?? existing.endpoint,
      updatedAt: new Date().toISOString(),
    };

    profileStore.save(updated);
    console.log(chalk.green(`\n✓ Profile "${profileName}" updated.`));
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// configure (guided setup flow)
// ---------------------------------------------------------------------------

export async function configureCommand(): Promise<void> {
  ensureProviders();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log(chalk.bold.blue('\n🔧 FilmBuff AI Provider Setup\n'));

    const providers = providerRegistry.list();
    console.log(chalk.bold('Available providers:'));
    providers.forEach((p, i) => {
      console.log(`  ${chalk.cyan(String(i + 1))}. ${chalk.bold(p.id)} – ${p.displayName}`);
    });
    console.log();

    const choice = await prompt(rl, chalk.cyan('Select provider number: '));
    const idx = parseInt(choice.trim(), 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= providers.length) {
      console.error(chalk.red('Invalid selection.'));
      rl.close();
      return;
    }
    const provider = providers[idx];

    const profileName = await prompt(rl, chalk.cyan('Profile name [default]: '));
    const name = profileName.trim() || 'default';

    rl.close();

    // Re-use create flow with interactive prompts
    await providerCreateCommand(provider.id, name, {});

    // Offer to activate immediately
    const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const activate = await prompt(rl2, chalk.cyan('\nActivate this profile now? (Y/n): '));
      if (activate.trim().toLowerCase() !== 'n') {
        providerActivateCommand(provider.id, name);
      }
    } finally {
      rl2.close();
    }
  } catch {
    rl.close();
  }
}


// ---------------------------------------------------------------------------
// provider status  (GUI panel — bd-ai-providers.8)
// ---------------------------------------------------------------------------

/**
 * Render a rich provider management panel to the terminal.
 * This is the "GUI view" for the provider system: a structured, colour-coded
 * overview of all registered providers, saved profiles, and the active
 * selection.  The GUI state module (provider-state.ts) is updated so that the
 * webview / VS Code panel can restore the last-viewed selection on next open.
 */
export function providerStatusCommand(options: { json?: boolean } = {}): void {
  ensureProviders();

  const active = profileStore.getActive();
  const allProfiles = profileStore.listAll();
  const allProviders = providerRegistry.list();

  // Persist GUI panel state so the webview can restore to this view
  let panelState = loadProviderPanelState();
  panelState = setProviderPanelView(panelState, 'list');
  if (active) {
    panelState = selectProviderProfile(panelState, active.providerId, active.profileName);
  }
  saveProviderPanelState(panelState);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          active: active ?? null,
          providers: allProviders.map((p) => ({
            id: p.id,
            type: p.type,
            displayName: p.displayName,
            capabilities: p.capabilities,
          })),
          profiles: allProfiles.map((p) => redactProfile(p)),
        },
        null,
        2
      )
    );
    return;
  }

  // ── Header ────────────────────────────────────────────────────────────────
  console.log();
  console.log(chalk.bold.blue('╔══════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.blue('║          FilmBuff AI Provider Management Panel           ║'));
  console.log(chalk.bold.blue('╚══════════════════════════════════════════════════════════╝'));
  console.log();

  // ── Active provider ───────────────────────────────────────────────────────
  if (active) {
    const profile = profileStore.load(active.providerId, active.profileName);
    const validation = profile ? validateProfile(profile) : { valid: false, errors: ['Profile missing'] };
    const statusIcon = validation.valid ? chalk.green('● ACTIVE') : chalk.red('● INVALID');
    console.log(chalk.bold('Active Provider'));
    printSeparator();
    console.log(`  Provider : ${chalk.bold(active.providerId)}`);
    console.log(`  Profile  : ${chalk.bold(active.profileName)}`);
    if (profile?.model) console.log(`  Model    : ${profile.model}`);
    console.log(`  Status   : ${statusIcon}`);
    if (!validation.valid) {
      validation.errors.forEach((e) => console.log(chalk.red(`    • ${e}`)));
    }
    console.log();
  } else {
    console.log(chalk.yellow('  No active provider configured.'));
    console.log(chalk.gray('  Run: filmbuff configure'));
    console.log();
  }

  // ── Registered providers ──────────────────────────────────────────────────
  console.log(chalk.bold(`Registered Providers (${allProviders.length})`));
  printSeparator();
  allProviders.forEach((p) => {
    const tag = p.type === 'built-in' ? chalk.cyan('[built-in]') : chalk.magenta('[custom]');
    console.log(`  ${chalk.bold(p.id)} ${tag}`);
    console.log(`    ${p.displayName} – ${p.description}`);
    console.log(`    Capabilities: ${p.capabilities.join(', ')}`);
  });
  console.log();

  // ── Saved profiles ────────────────────────────────────────────────────────
  console.log(chalk.bold(`Saved Profiles (${allProfiles.length})`));
  printSeparator();
  if (allProfiles.length === 0) {
    console.log(chalk.yellow('  No profiles saved. Run: filmbuff configure'));
  } else {
    allProfiles.forEach((p) => {
      const isActive =
        active?.providerId === p.providerId && active?.profileName === p.profileName;
      const marker = isActive ? chalk.green(' ★') : '';
      const result = validateProfile(p);
      const validBadge = result.valid ? chalk.green('✓') : chalk.red('✗');
      console.log(`  ${validBadge} ${chalk.bold(p.profileName)}${marker}  ${chalk.gray(`(${p.providerId})`)}`);
    });
  }
  console.log();

  // ── Quick commands ────────────────────────────────────────────────────────
  console.log(chalk.bold('Quick Commands'));
  printSeparator();
  console.log(chalk.gray('  filmbuff configure                          – guided setup'));
  console.log(chalk.gray('  filmbuff provider list --profiles           – list profiles'));
  console.log(chalk.gray('  filmbuff provider create <id> <name>        – create profile'));
  console.log(chalk.gray('  filmbuff provider activate <id> <name>      – set active'));
  console.log(chalk.gray('  filmbuff provider validate <id> <name>      – validate'));
  console.log();
}
