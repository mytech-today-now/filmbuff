/**
 * GUI Command — Interactive Terminal Module Manager
 *
 * Modeled after the `augx gui` command. Provides an inquirer-based
 * interactive menu for linking/unlinking extension modules.
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';
import { discoverModules, discoverCollections, findProjectRoot, getModulesDir, Module, Collection } from '../utils/module-system.js';
import { linkCommand } from './link.js';
import { unlinkCommand } from './unlink.js';
import { aiStatusCommand } from './ai-status.js';

// ──────────────────────────────────────────────────────────────────────────────
// Keyboard shortcuts help
// ──────────────────────────────────────────────────────────────────────────────

function displayKeyboardHelp(): void {
  console.log(chalk.bold.blue('\n⌨️  Keyboard Shortcuts\n'));
  console.log(chalk.cyan('Navigation:'));
  console.log(chalk.gray('  ↑/↓ or j/k    - Move up/down'));
  console.log(chalk.gray('  Space         - Toggle selection (checkbox lists)'));
  console.log(chalk.gray('  Enter         - Confirm selection'));
  console.log(chalk.gray('  Esc or Ctrl+C - Cancel/Exit'));
  console.log();
  console.log(chalk.cyan('Actions:'));
  console.log(chalk.gray('  Ctrl+A        - Select all (checkbox lists)'));
  console.log(chalk.gray('  Ctrl+D        - Deselect all (checkbox lists)'));
  console.log(chalk.gray('  Ctrl+S        - Quick search'));
  console.log(chalk.gray('  Ctrl+H or ?   - Show this help'));
  console.log();
  console.log(chalk.cyan('Accessibility:'));
  console.log(chalk.gray('  Screen reader compatible'));
  console.log(chalk.gray('  High contrast mode supported'));
  console.log(chalk.gray('  Keyboard-only navigation'));
  console.log();
}

// ──────────────────────────────────────────────────────────────────────────────
// Main entry point
// ──────────────────────────────────────────────────────────────────────────────

export async function guiCommand(options: Record<string, unknown> = {}): Promise<void> {
  try {
    console.log(chalk.blue('\n🎬 FilmBuff Module Manager\n'));
    console.log(chalk.gray('Press Ctrl+H or ? for keyboard shortcuts\n'));

    // Require project to be initialized
    const projectRoot = findProjectRoot() ?? process.cwd();
    const configPath = path.join(projectRoot, '.augment', 'extensions.json');
    if (!fs.existsSync(configPath)) {
      console.error(chalk.red('FilmBuff not initialized in this directory. Run: filmbuff init'));
      process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const linkedModules: string[] = (config.modules ?? []).map((m: { name: string }) => m.name);

    // Discover available modules and collections
    const modules = discoverModules();
    const collections = discoverCollections();

    // Main menu
    const { action } = await inquirer.prompt([
      {
        type: 'select',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: '📦 Link Modules', value: 'link-modules' },
          { name: '📚 Link Collection', value: 'link-collection' },
          { name: '🔍 Search Modules', value: 'search' },
          new inquirer.Separator('-- Screenplay ------------------------'),
          { name: '🎬 Genres', value: 'genres' },
          { name: '🎨 Styles', value: 'styles' },
          { name: '🎭 Themes', value: 'themes' },
          { name: '🎥 Directors', value: 'directors' },
          { name: '🏛 Franchises', value: 'franchises' },
          new inquirer.Separator('-------------------------------------'),
          { name: '🤖 AI Providers', value: 'providers' },
          { name: '❓ Keyboard Shortcuts', value: 'help' },
          { name: '❌ Exit', value: 'exit' },
        ],
      },
    ]);

    if (action === 'exit') {
      console.log(chalk.gray('Goodbye!'));
      return;
    }

    if (action === 'help') {
      displayKeyboardHelp();
      return await guiCommand(options);
    } else if (action === 'link-modules') {
      await linkModulesInteractive(modules, linkedModules);
    } else if (action === 'link-collection') {
      await linkCollectionInteractive(collections, linkedModules);
    } else if (action === 'search') {
      await searchModulesInteractive(modules);
    } else if (action === 'genres') {
      await listSubmodulesInteractive(
        'writing-standards/screenplay/genres',
        '🎬 Genres',
        linkedModules,
      );
    } else if (action === 'styles') {
      await listSubmodulesInteractive(
        'writing-standards/screenplay/styles',
        '🎨 Styles',
        linkedModules,
      );
    } else if (action === 'themes') {
      await listSubmodulesInteractive(
        'writing-standards/screenplay/themes',
        '🎭 Themes',
        linkedModules,
      );
    } else if (action === 'directors') {
      await listSubmodulesInteractive(
        'writing-standards/screenplay/cinematic-styles/directors',
        '🎥 Directors',
        linkedModules,
      );
    } else if (action === 'franchises') {
      await listSubmodulesInteractive(
        'writing-standards/screenplay/cinematic-styles/franchises',
        '🏛️  Franchises',
        linkedModules,
      );
    } else if (action === 'providers') {
      await providerMenuInteractive();
    }
  } catch (error: any) {
    // Gracefully handle Ctrl+C (prompt cancelled)
    if (error?.name === 'ExitPromptError' || error?.message?.includes('User force closed')) {
      console.log(chalk.gray('\nExiting FilmBuff Module Manager.'));
      return;
    }
    console.error(chalk.red(`Error: ${error?.message ?? error}`));
    process.exit(1);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Interactive helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Returns the short alias (last path segment) of a module fullName.
 * e.g. "writing-standards/screenplay/genres/action" → "action"
 */
function moduleAlias(fullName: string): string {
  const parts = fullName.split('/');
  return parts[parts.length - 1];
}

/**
 * Returns a human-readable group label for a module's full path.
 * Screenplay sub-categories (Genres, Styles, Themes, Directors, Franchises)
 * get dedicated labels; everything else uses the top-level category.
 */
function getGroupLabel(fullName: string): string {
  const p = fullName.split('/');
  if (p[0] === 'writing-standards' && p[1] === 'screenplay') {
    if (p[2] === 'genres')           return 'Screenplay > Genres';
    if (p[2] === 'styles')           return 'Screenplay > Styles';
    if (p[2] === 'themes')           return 'Screenplay > Themes';
    if (p[2] === 'cinematic-styles') {
      if (p[3] === 'directors')      return 'Screenplay > Directors';
      if (p[3] === 'franchises')     return 'Screenplay > Franchises';
      return 'Screenplay > Cinematic Styles';
    }
    return 'Screenplay';
  }
  return p[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Groups modules by smart category label.
 */
function groupModulesByCategory(modules: Module[]): Map<string, Module[]> {
  const grouped = new Map<string, Module[]>();
  for (const m of modules) {
    const cat = getGroupLabel(m.fullName);
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(m);
  }
  return grouped;
}

async function linkModulesInteractive(modules: Module[], linkedModules: string[]): Promise<void> {
  if (modules.length === 0) {
    console.log(chalk.yellow('No modules found in filmbuff directory.'));
    return;
  }

  // Group by smart category and insert separators for clarity
  const grouped = groupModulesByCategory(modules);
  const choices: any[] = [];

  for (const [category, mods] of grouped) {
    choices.push(new inquirer.Separator(`-- ${category} `));
    for (const m of mods) {
      const alias = moduleAlias(m.fullName);
      const desc = m.metadata.description ?? m.metadata.displayName ?? '';
      const short = desc.length > 55 ? desc.slice(0, 52) + '...' : desc;
      choices.push({
        name: `${chalk.cyan(alias.padEnd(28))}${chalk.gray(short)}`,
        value: m.fullName,
        checked: linkedModules.includes(m.fullName),
      });
    }
  }

  const { selected } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'Select modules to link (Space to toggle, Enter to confirm):',
      choices,
      pageSize: 25,
    },
  ]);

  // Determine what to link and unlink
  const toLink: string[] = selected.filter((n: string) => !linkedModules.includes(n));
  const toUnlink: string[] = linkedModules.filter(n => !selected.includes(n));

  for (const name of toLink) {
    await linkCommand(name, {});
  }
  for (const name of toUnlink) {
    await unlinkCommand(name, {});
  }

  if (toLink.length === 0 && toUnlink.length === 0) {
    console.log(chalk.gray('No changes made.'));
  }
}

async function linkCollectionInteractive(collections: Collection[], linkedModules: string[]): Promise<void> {
  if (collections.length === 0) {
    console.log(chalk.yellow('No collections found in filmbuff/collections directory.'));
    return;
  }

  const choices = collections.map(c => ({
    name: `${c.fullName}${chalk.gray(` — ${c.metadata.description ?? ''}`)}`,
    value: c.fullName,
  }));

  const { collectionName } = await inquirer.prompt([
    {
      type: 'select',
      name: 'collectionName',
      message: 'Select a collection to link:',
      choices,
      pageSize: 15,
    },
  ]);

  await linkCommand(collectionName, {});
}

async function searchModulesInteractive(modules: Module[]): Promise<void> {
  const { query } = await inquirer.prompt([
    {
      type: 'input',
      name: 'query',
      message: 'Search modules (name, description, or tags):',
    },
  ]);

  const q = query.toLowerCase().trim();
  const results = modules.filter(m => {
    const meta = m.metadata;
    return (
      m.fullName.toLowerCase().includes(q) ||
      (meta.description ?? '').toLowerCase().includes(q) ||
      (meta.tags ?? []).some((k: string) => k.toLowerCase().includes(q))
    );
  });

  if (results.length === 0) {
    console.log(chalk.yellow(`No modules matched "${query}".`));
    return;
  }

  console.log(chalk.green(`\nFound ${results.length} module(s):\n`));
  for (const m of results) {
    console.log(`  ${chalk.cyan(m.fullName)} — ${chalk.gray(m.metadata.description ?? '')}`);
  }
  console.log();

  const { linkNow } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'linkNow',
      message: 'Would you like to link any of these modules?',
      default: false,
    },
  ]);

  if (linkNow) {
    const choices = results.map(m => ({
      name: m.fullName,
      value: m.fullName,
    }));

    const { toLink } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'toLink',
        message: 'Select modules to link:',
        choices,
      },
    ]);

    for (const name of toLink) {
      await linkCommand(name, {});
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Generic submodule browser (Genres, Styles, Themes, Directors, Franchises)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the filmbuff root directory (same logic as other commands:
 * prefer the project's local copy, fall back to the bundled package copy).
 */
function resolveModulesDir(): string {
  return getModulesDir();
}

/**
 * Browse and link/unlink submodules in any container directory.
 *
 * @param relPath  Path relative to the filmbuff root, e.g.
 *                 "writing-standards/screenplay/genres"
 * @param label    Display label for the menu header
 * @param linkedModules  Currently-linked module names
 */
async function listSubmodulesInteractive(
  relPath: string,
  label: string,
  linkedModules: string[],
): Promise<void> {
  const modulesDir = resolveModulesDir();
  const containerPath = path.join(modulesDir, ...relPath.split('/'));

  if (!fs.existsSync(containerPath)) {
    console.log(chalk.yellow(`\nDirectory not found:\n  ${containerPath}\n`));
    return;
  }

  // Each subdirectory that contains a module.json is a selectable item
  const entries = fs.readdirSync(containerPath, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(d => {
      const fullName = `${relPath}/${d.name}`;
      const moduleJsonPath = path.join(containerPath, d.name, 'module.json');
      let description = '';
      try {
        const meta = JSON.parse(fs.readFileSync(moduleJsonPath, 'utf-8'));
        description = meta.description ?? meta.displayName ?? '';
      } catch {
        // ignore missing/malformed module.json
      }
      return { name: d.name, fullName, description };
    });

  if (entries.length === 0) {
    console.log(chalk.yellow(`No items found in ${relPath}.`));
    return;
  }

  console.log(chalk.bold.cyan(`\n${label} (${entries.length} available)\n`));

  const choices = entries.map(e => {
    const alias = chalk.cyan(e.name.padEnd(26));
    const desc = e.description.length > 50 ? e.description.slice(0, 47) + '...' : e.description;
    return {
      name: `${alias}${chalk.gray(desc)}`,
      value: e.fullName,
      checked: linkedModules.includes(e.fullName),
    };
  });

  const { selected } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: `Select items to link (Space to toggle, Enter to confirm):`,
      choices,
      pageSize: 25,
    },
  ]);

  const toLink: string[] = selected.filter((n: string) => !linkedModules.includes(n));
  const toUnlink: string[] = linkedModules.filter(n =>
    entries.some(e => e.fullName === n) && !selected.includes(n)
  );

  for (const name of toLink) {
    await linkCommand(name, {});
  }
  for (const name of toUnlink) {
    await unlinkCommand(name, {});
  }

  if (toLink.length === 0 && toUnlink.length === 0) {
    console.log(chalk.gray('No changes made.'));
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// AI Provider menu
// ──────────────────────────────────────────────────────────────────────────────

async function providerMenuInteractive(): Promise<void> {
  console.log(chalk.bold.cyan('\n🤖 AI Integration (ai-powered)\n'));

  // Show current ai-powered status (Phase 9 — bd-99b2: replaces providerStatusCommand).
  await aiStatusCommand();

  const { providerAction } = await inquirer.prompt([
    {
      type: 'select',
      name: 'providerAction',
      message: 'AI provider action:',
      choices: [
        {
          name: '🔑 Configure provider (run: ai-powered config set provider <name>)',
          value: 'instructions',
        },
        { name: '↩  Back to main menu', value: 'back' },
      ],
    },
  ]);

  if (providerAction === 'instructions') {
    console.log(chalk.yellow('\n  Provider configuration is managed by ai-powered:'));
    console.log('    ai-powered config set provider <name>');
    console.log('    ai-powered config set apiKey <key>');
    console.log(chalk.gray('\n  See: filmbuff ai status\n'));
  }
}
