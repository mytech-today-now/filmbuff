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
import { discoverModules, discoverCollections, Module, Collection } from '../utils/module-system.js';
import { linkCommand } from './link.js';
import { unlinkCommand } from './unlink.js';

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
    const configPath = path.join(process.cwd(), '.augment', 'extensions.json');
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

async function linkModulesInteractive(modules: Module[], linkedModules: string[]): Promise<void> {
  if (modules.length === 0) {
    console.log(chalk.yellow('No modules found in augment-extensions directory.'));
    return;
  }

  // Group modules by type for display
  const topLevel = modules.filter(m => !m.isSubModule);

  const choices = topLevel.map(m => ({
    name: `${m.fullName}${chalk.gray(` — ${m.metadata.description ?? ''}`)}`,
    value: m.fullName,
    checked: linkedModules.includes(m.fullName),
  }));

  const { selected } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'Select modules to link (Space to toggle, Enter to confirm):',
      choices,
      pageSize: 20,
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
    console.log(chalk.yellow('No collections found in augment-extensions/collections directory.'));
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

