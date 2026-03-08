#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { initCommand } from './commands/init';
import { listCommand } from './commands/list';
import { showCommand, showModuleCommand, showLinkedCommand, showAllCommand } from './commands/show';
import { showCompletedCommand } from './commands/showCompleted';
import { linkCommand } from './commands/link';
import { updateCommand } from './commands/update';
import { searchCommand } from './commands/search';
import { upgradeCommand } from './commands/upgrade';
import { versionInfoCommand } from './commands/version-info';
import { syncBeadsCommand, syncOpenSpecCommand, syncAllCommand, syncWatchCommand } from './commands/sync';
import { migrateExistingData } from './utils/migrate';
import { validateCommand } from './commands/validate';
import { catalogCommand, catalogHookCommand } from './commands/catalog';
import { unlinkCommand } from './commands/unlink';
import { generateShotListCommand } from './commands/generate-shot-list';

// Read version from package.json
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf-8')
);

const program = new Command();

program
  .name('filmbuff')
  .description('CLI tool for managing writing, prose, and screenplay extension modules')
  .version(packageJson.version);

// Init command with subcommands
const initCmd = program
  .command('init')
  .description('Initialize Augment Extensions in current project (includes Beads integration if .beads/ exists)')
  .option('--from-submodule', 'Initialize from existing submodule')
  .action(initCommand);

// Init beads subcommand
initCmd
  .command('beads')
  .description('Initialize Beads task tracking in current project')
  .action(() => {
    const fs = require('fs');
    const path = require('path');
    const chalk = require('chalk');

    console.log(chalk.blue('\nðŸ“‹ Initializing Beads task tracking...\n'));

    const beadsDir = path.join(process.cwd(), '.beads');
    const beadsIssuesPath = path.join(beadsDir, 'issues.jsonl');
    const beadsConfigPath = path.join(beadsDir, 'config.json');
    const scriptsDir = path.join(process.cwd(), 'scripts');
    const completedPath = path.join(scriptsDir, 'completed.jsonl');

    // Create .beads directory
    if (!fs.existsSync(beadsDir)) {
      fs.mkdirSync(beadsDir, { recursive: true });
      console.log(chalk.green('âœ“ Created .beads directory'));
    } else {
      console.log(chalk.gray('â€¢ .beads directory already exists'));
    }

    // Create issues.jsonl
    if (!fs.existsSync(beadsIssuesPath)) {
      fs.writeFileSync(beadsIssuesPath, '', 'utf-8');
      console.log(chalk.green('âœ“ Created .beads/issues.jsonl'));
    } else {
      console.log(chalk.gray('â€¢ .beads/issues.jsonl already exists'));
    }

    // Create config.json
    if (!fs.existsSync(beadsConfigPath)) {
      const beadsConfig = {
        version: '1.0.0',
        project: path.basename(process.cwd()),
        created: new Date().toISOString()
      };
      fs.writeFileSync(beadsConfigPath, JSON.stringify(beadsConfig, null, 2), 'utf-8');
      console.log(chalk.green('âœ“ Created .beads/config.json'));
    } else {
      console.log(chalk.gray('â€¢ .beads/config.json already exists'));
    }

    // Create scripts directory
    if (!fs.existsSync(scriptsDir)) {
      fs.mkdirSync(scriptsDir, { recursive: true });
      console.log(chalk.green('âœ“ Created scripts directory'));
    } else {
      console.log(chalk.gray('â€¢ scripts directory already exists'));
    }

    // Create completed.jsonl
    if (!fs.existsSync(completedPath)) {
      fs.writeFileSync(completedPath, '', 'utf-8');
      console.log(chalk.green('âœ“ Created scripts/completed.jsonl'));
    } else {
      console.log(chalk.gray('â€¢ scripts/completed.jsonl already exists'));
    }

    console.log(chalk.green('\nâœ“ Beads initialization complete!\n'));
    console.log(chalk.gray('Next steps:'));
    console.log(chalk.cyan('  â€¢ Create tasks: bd create "Task title" -p 1'));
    console.log(chalk.cyan('  â€¢ List tasks: bd list'));
    console.log(chalk.cyan('  â€¢ Close tasks: bd close <task-id>'));
    console.log(chalk.cyan('  â€¢ View completed: filmbuff show completed\n'));
  });


program
  .command('list')
  .description('List available or linked extension modules')
  .option('--linked', 'Show only linked modules')
  .option('--json', 'Output as JSON')
  .option('--versions', 'Show available versions for each module')
  .action(listCommand);

// Generic show command (register FIRST as the default)
program
  .command('show <module> [file-path]')
  .description('Display detailed information about a module (use "completed" to show Beads completed tasks, "linked" for linked modules, "all" for all modules)')
  .option('--json', 'Output as JSON')
  .option('--content', 'Display aggregated content from all module files')
  .option('--format <format>', 'Output format: json, markdown, text', 'text')
  .option('--depth <number>', 'Recursion depth for submodules (max 5)', '1')
  .option('--filter <pattern>', 'Filter files by glob pattern (e.g., "*.md")')
  .option('--search <term>', 'Search within module content')
  .option('--page <number>', 'Page number for paginated output', parseInt)
  .option('--page-size <number>', 'Number of items per page (default: 10)', parseInt)
  .option('--secure', 'Redact sensitive data (API keys, secrets, tokens, passwords)')
  .option('--no-cache', 'Disable caching for this inspection')
  .option('--open', 'Open file in VS Code editor')
  .option('--preview', 'Open file in VS Code preview pane')
  .option('--since <date>', 'Filter completed tasks since date (ISO 8601 format, e.g., 2026-01-01)')
  .option('--until <date>', 'Filter completed tasks until date (ISO 8601 format, e.g., 2026-12-31)')
  .option('--limit <number>', 'Limit number of completed tasks shown', parseInt)
  .option('--search <term>', 'Search completed tasks by title, description, or close reason')
  .option('--labels <labels>', 'Filter completed tasks by labels (comma-separated)')
  .option('--type <type>', 'Filter completed tasks by issue type (e.g., task, epic, bug)')
  .option('--priority <number>', 'Filter completed tasks by priority (0-3)', parseInt)
  .option('--assignee <email>', 'Filter completed tasks by assignee/owner')
  .option('--sort <field>', 'Sort completed tasks by: date, title, priority (default: date)')
  .option('--order <order>', 'Sort order: asc, desc (default: desc)')
  .option('--verbose', 'Show detailed information for completed tasks')
  .option('--quiet', 'Only output task IDs (one per line)')
  .action((moduleName: string, filePath: string | undefined, options: any) => {
    // Handle special subcommands
    if (moduleName === 'completed') {
      showCompletedCommand(options);
      return;
    }
    if (moduleName === 'linked') {
      showLinkedCommand(options);
      return;
    }
    if (moduleName === 'all') {
      showAllCommand(options);
      return;
    }

    // If file-path is provided, use showModuleCommand for detailed inspection
    if (filePath) {
      showModuleCommand(moduleName, filePath, options);
    } else {
      // Otherwise use the basic showCommand
      showCommand(moduleName, options);
    }
  });


program
  .command('upgrade <module>')
  .description('Upgrade module to latest version')
  .option('--force', 'Force upgrade even with compatibility errors')
  .option('--dry-run', 'Show what would be upgraded without making changes')
  .option('--json', 'Output as JSON')
  .action(upgradeCommand);

program
  .command('version-info <module>')
  .description('Show detailed version information')
  .option('--json', 'Output as JSON')
  .option('--no-changelog', 'Skip changelog display')
  .option('--no-compatibility', 'Skip compatibility check')
  .action(versionInfoCommand);

program
  .command('link <module>')
  .description('Link an extension module to current project')
  .option('--version <version>', 'Specific version to link')
  .action(linkCommand);

program
  .command('unlink <module>')
  .description('Unlink an extension module or collection from current project')
  .option('--force', 'Force unlink even if other modules depend on it')
  .action(unlinkCommand);

program
  .command('update')
  .description('Update CLI and/or linked modules to latest versions')
  .option('--module <name>', 'Update specific module only')
  .option('--cli', 'Update the CLI itself to the latest version')
  .option('--all', 'Update both CLI and all linked modules')
  .action(updateCommand);

program
  .command('search <keyword>')
  .description('Search for extension modules')
  .option('--type <type>', 'Filter by module type')
  .action(searchCommand);

program
  .command('create <name>')
  .description('Create a new extension module')
  .option('--type <type>', 'Module type (coding-standards, domain-rules, workflows, examples, marketing-standards, writing-standards, themes)')
  .action((name: string, options: any) => {
    console.log(chalk.green(`Creating new module: ${name}`));
    console.log(chalk.gray(`Type: ${options.type || 'coding-standards'}`));
    // Implementation
  });

program
  .command('validate <module>')
  .description('Validate module structure and metadata')
  .option('--verbose', 'Show detailed validation information')
  .action(validateCommand);

program
  .command('pin <module> <version>')
  .description('Pin module to specific version')
  .action((module: string, version: string) => {
    console.log(chalk.cyan(`Pinning ${module} to version ${version}`));
    // Implementation
  });

program
  .command('check-updates')
  .description('Check for available module updates')
  .action(() => {
    console.log(chalk.blue('Checking for updates...'));
    // Implementation
  });


program
  .command('diff <module>')
  .description('Show differences between current and latest version')
  .action((module: string) => {
    console.log(chalk.magenta(`Showing diff for: ${module}`));
    // Implementation
  });

program
  .command('catalog')
  .description('Update MODULES.md catalog with all available modules')
  .option('--output <path>', 'Output path for catalog file')
  .option('--check', 'Check if catalog is out of date (exit 1 if outdated)')
  .option('--auto', 'Auto-update only if out of date')
  .action(catalogCommand);

program
  .command('catalog-hook')
  .description('Setup git hook for automatic catalog updates')
  .option('--remove', 'Remove catalog auto-update from git hook')
  .option('--type <type>', 'Hook type: pre-commit or post-commit (default: pre-commit)')
  .action(catalogHookCommand);



// Sync commands
const syncCommand = program
  .command('sync')
  .description('Sync Beads and OpenSpec with coordination manifest');

syncCommand
  .command('beads')
  .description('Sync Beads tasks to coordination manifest')
  .action(syncBeadsCommand);

syncCommand
  .command('openspec')
  .description('Sync OpenSpec specs to coordination manifest')
  .action(syncOpenSpecCommand);

syncCommand
  .command('all')
  .description('Sync both Beads and OpenSpec')
  .action(syncAllCommand);

syncCommand
  .command('watch')
  .description('Watch for changes and auto-sync')
  .action(syncWatchCommand);

program
  .command('migrate')
  .description('Migrate existing Beads and OpenSpec data to coordination system')
  .action(() => {
    try {
      console.log(chalk.blue('Migrating existing data to coordination system...\n'));
      const result = migrateExistingData();

      console.log(chalk.green.bold('\nâœ“ Migration complete!'));
      console.log(chalk.gray(`Backup created at: ${result.backup}`));
      console.log(chalk.gray(`\nBeads: ${result.beads.added} added, ${result.beads.updated} updated, ${result.beads.removed} removed`));
      console.log(chalk.gray(`OpenSpec: ${result.openspec.added} added, ${result.openspec.updated} updated, ${result.openspec.removed} removed`));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });




// Generate Shot List command
program
  .command('generate-shot-list')
  .description('Generate AI-optimized shot lists from screenplays')
  .requiredOption('--path <file>', 'Path to screenplay file')
  .option('--format <format>', 'Output format: md, json, jsonl, csv, txt, html', 'md')
  .option('--output <filename>', 'Custom output filename')
  .option('--max-characters <number>', 'Maximum characters per shot description', '4000')
  .option('--max-shot-length <seconds>', 'Maximum shot duration in seconds', '12')
  .option('--logging', 'Enable comprehensive error logging to JSONL file')
  .action((options) => {
    generateShotListCommand({
      path: options.path,
      format: options.format,
      output: options.output,
      maxCharacters: parseInt(options.maxCharacters, 10),
      maxShotLength: parseInt(options.maxShotLength, 10),
      logging: options.logging
    });
  });

program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

