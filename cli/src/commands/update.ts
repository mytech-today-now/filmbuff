import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { compareSemanticVersions, findModule, findProjectRoot, type Module } from '../utils/module-system';

interface UpdateOptions {
  module?: string;
  cli?: boolean;
  all?: boolean;
}

interface LinkedModule {
  name?: string;
  id?: string;
  version?: string;
  type?: string;
  description?: string;
}

interface ResolvedLinkedModule {
  index: number;
  entry: LinkedModule | string;
  storedName: string;
  canonicalName: string;
  sourceModule: Module | null;
}

export async function updateCommand(options: UpdateOptions): Promise<void> {
  try {
    // If --cli flag is set, update the CLI itself
    if (options.cli || options.all) {
      await updateCLI();
      if (options.cli && !options.all) {
        return; // Only update CLI, not modules
      }
    }

    // Update modules
    console.log(chalk.blue('\n🔄 Updating modules...\n'));

    // Load extensions config
    const projectRoot = findProjectRoot() ?? process.cwd();
    const configPath = path.join(projectRoot, '.augment', 'extensions.json');

    if (!fs.existsSync(configPath)) {
      console.error(chalk.red('Filmbuff not initialized. Run: filmbuff init'));
      process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    if (!config.modules || config.modules.length === 0) {
      console.log(chalk.yellow('No modules linked. Use "filmbuff link <module>" to link modules.'));
      return;
    }

    const requestedModuleName = options.module?.trim();
    const requestedModule = requestedModuleName ? findModule(requestedModuleName) : null;
    const requestedCanonicalName = requestedModule?.fullName ?? requestedModuleName;
    const linkedModules = config.modules as Array<LinkedModule | string>;
    const resolvedModules: ResolvedLinkedModule[] = linkedModules
      .map((entry, index) => resolveLinkedModule(entry, index))
      .filter((entry): entry is ResolvedLinkedModule => entry !== null);

    const modulesToUpdate = requestedCanonicalName
      ? resolvedModules.filter((module) =>
          module.canonicalName === requestedCanonicalName ||
          module.storedName === requestedCanonicalName
        )
      : resolvedModules;

    if (modulesToUpdate.length === 0) {
      console.error(chalk.red(`Module not found: ${options.module}`));
      process.exit(1);
    }

    let updatedCount = 0;
    let upToDateCount = 0;
    let errorCount = 0;

    for (const linkedModule of modulesToUpdate) {
      const result = await updateModule(linkedModule, config);

      if (result === 'updated') {
        updatedCount++;
      } else if (result === 'up-to-date') {
        upToDateCount++;
      } else {
        errorCount++;
      }
    }

    // Save updated config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log(chalk.bold.green('\n✨ Update complete!\n'));
    console.log(chalk.gray(`Updated: ${updatedCount}`));
    console.log(chalk.gray(`Up to date: ${upToDateCount}`));
    if (errorCount > 0) {
      console.log(chalk.red(`Errors: ${errorCount}`));
    }
    console.log();

  } catch (error) {
    console.error(chalk.red('Error updating:'), error);
    process.exit(1);
  }
}

async function updateCLI(): Promise<void> {
  try {
    console.log(chalk.blue('\n🔄 Updating CLI...\n'));

    // Get current version from package.json
    const packageJsonPath = path.join(__dirname, '../../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const currentVersion = packageJson.version;

    console.log(chalk.gray(`Current version: ${currentVersion}`));

    // Check npm registry for latest version
    console.log(chalk.gray('Checking npm registry for latest version...'));

    let latestVersion: string;
    try {
      const npmViewOutput = execSync('npm view @mytechtoday/filmbuff version', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      latestVersion = npmViewOutput;
    } catch (error) {
      console.error(chalk.red('✗ Failed to check npm registry'));
      console.error(chalk.gray('Make sure you have internet connection and npm is configured correctly'));
      throw error;
    }

    console.log(chalk.gray(`Latest version: ${latestVersion}`));

    // Compare versions
    if (compareSemanticVersions(currentVersion, latestVersion) === 0) {
      console.log(chalk.green(`\n✓ CLI is already up to date (v${currentVersion})\n`));
      return;
    }

    if (compareSemanticVersions(currentVersion, latestVersion) > 0) {
      console.log(chalk.yellow(`\n⚠ Current version (${currentVersion}) is newer than npm registry (${latestVersion})\n`));
      return;
    }

    // Update available
    console.log(chalk.cyan(`\n📦 Update available: ${currentVersion} → ${latestVersion}\n`));
    console.log(chalk.gray('Installing update...'));

    try {
      execSync('npm install -g @mytechtoday/filmbuff@latest', {
        encoding: 'utf-8',
        stdio: 'inherit'
      });

      console.log(chalk.bold.green(`\n✨ CLI updated successfully to v${latestVersion}!\n`));
      console.log(chalk.gray('You may need to restart your terminal for changes to take effect.\n'));
    } catch (error) {
      console.error(chalk.red('\n✗ Failed to update CLI'));
      console.error(chalk.gray('You may need to run with elevated permissions (sudo/administrator)'));
      console.error(chalk.gray('Or try: npm install -g @mytechtoday/filmbuff@latest'));
      throw error;
    }

  } catch (error) {
    console.error(chalk.red('Error updating CLI:'), error);
    process.exit(1);
  }
}

async function updateModule(linkedModule: ResolvedLinkedModule, config: any): Promise<'updated' | 'up-to-date' | 'error'> {
  try {
    const modulePath = linkedModule.sourceModule?.path;
    if (!modulePath) {
      console.log(chalk.gray(`○ ${linkedModule.storedName}: No local source (externally managed, skipping)`));
      return 'up-to-date';
    }

    const moduleJsonPath = path.join(modulePath, 'module.json');

    if (!fs.existsSync(moduleJsonPath)) {
      // Module has no local source — it was linked externally. Treat as up-to-date.
      console.log(chalk.gray(`○ ${linkedModule.storedName}: No local source (externally managed, skipping)`));
      return 'up-to-date';
    }

    const moduleData = JSON.parse(fs.readFileSync(moduleJsonPath, 'utf-8'));
    const latestVersion = moduleData.version;
    const currentVersion = linkedModule.entry && typeof linkedModule.entry === 'object' &&
      typeof linkedModule.entry.version === 'string' &&
      linkedModule.entry.version.trim()
      ? linkedModule.entry.version.trim()
      : '0.0.0';

    if (latestVersion === currentVersion) {
      console.log(chalk.gray(`○ ${linkedModule.canonicalName}: Already up to date (v${currentVersion})`));
      return 'up-to-date';
    }

    // Check if it's a newer version
    if (compareSemanticVersions(latestVersion, currentVersion) > 0) {
      // Update in config
      const moduleIndex = linkedModule.index;
      if (moduleIndex >= 0 && moduleIndex < config.modules.length) {
        const existingEntry = config.modules[moduleIndex];
        const existingObject = existingEntry && typeof existingEntry === 'object' ? existingEntry : {};
        config.modules[moduleIndex] = {
          ...existingObject,
          name: linkedModule.canonicalName,
          version: latestVersion,
          description: moduleData.description
        };
      }

      console.log(chalk.green(`✓ ${linkedModule.canonicalName}: Updated ${currentVersion} → ${latestVersion}`));
      return 'updated';
    } else {
      console.log(chalk.yellow(`⚠ ${linkedModule.canonicalName}: Current version (${currentVersion}) is newer than available (${latestVersion})`));
      return 'up-to-date';
    }

  } catch (error) {
    console.log(chalk.red(`✗ ${linkedModule.canonicalName}: Error updating - ${error}`));
    return 'error';
  }
}

function getLinkedModuleName(entry: unknown): string | null {
  if (typeof entry === 'string') {
    return entry.trim() || null;
  }

  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const value = (entry as LinkedModule).name ?? (entry as LinkedModule).id;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveLinkedModule(entry: unknown, index: number): ResolvedLinkedModule | null {
  const storedName = getLinkedModuleName(entry);
  if (!storedName) {
    return null;
  }

  const sourceModule = findModule(storedName);
  return {
    index,
    entry: entry as LinkedModule | string,
    storedName,
    canonicalName: sourceModule?.fullName ?? storedName,
    sourceModule
  };
}

