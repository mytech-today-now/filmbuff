import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { ModuleLoader } from '../core/module-loader';
import { VersionManager } from '../core/version-manager';
import { CompatibilityChecker } from '../core/compatibility-checker';
import { compareSemanticVersions, discoverModules, findModule, findProjectRoot } from '../utils/module-system';

export interface UpgradeCommandOptions {
  force?: boolean;
  json?: boolean;
  dryRun?: boolean;
}

export async function upgradeCommand(moduleName: string, options: UpgradeCommandOptions = {}): Promise<void> {
  try {
    const { force = false, json = false, dryRun = false } = options;
    const module = findModule(moduleName);

    if (!module) {
      if (!json) {
        const modules = discoverModules();
        console.error(chalk.red(`✗ Module not found: ${moduleName}`));
        console.log(chalk.gray('\nAvailable modules:'));
        modules.forEach(m => console.log(chalk.gray(`  - ${m.fullName}`)));
      } else {
        console.log(JSON.stringify({ error: `Module not found: ${moduleName}` }, null, 2));
      }
      process.exit(1);
    }

    const versionManager = new VersionManager();
    const currentMetadata = versionManager.getVersion(module.path);
    if (!currentMetadata) {
      if (json) {
        console.log(JSON.stringify({ error: 'Unable to determine current version' }, null, 2));
      } else {
        console.error(chalk.red('✗ Unable to determine current version'));
      }
      process.exit(1);
    }

    const currentVersion = currentMetadata.version;
    const loader = new ModuleLoader();
    const latestResult = loader.load(module.path, { version: 'latest' });
    if (!latestResult) {
      if (json) {
        console.log(JSON.stringify({ error: 'Unable to load latest version' }, null, 2));
      } else {
        console.error(chalk.red('✗ Unable to load latest version'));
      }
      process.exit(1);
    }

    const latestVersion = latestResult.version;
    const comparison = compareSemanticVersions(latestVersion, currentVersion);

    if (comparison === 0) {
      if (json) {
        console.log(JSON.stringify({
          success: true,
          message: 'Already at latest version',
          module: moduleName,
          version: currentVersion
        }, null, 2));
      } else {
        console.log(chalk.green(`✓ ${moduleName} is already at the latest version (${currentVersion})`));
      }
      return;
    }

    if (comparison < 0) {
      if (json) {
        console.log(JSON.stringify({
          warning: 'Current version is newer than latest',
          current: currentVersion,
          latest: latestVersion
        }, null, 2));
      } else {
        console.log(chalk.yellow(`⚠ Current version (${currentVersion}) is newer than latest (${latestVersion})`));
      }
      return;
    }

    const compatChecker = new CompatibilityChecker();
    const compatResult = compatChecker.checkCompatibility(module.path);

    if (!json) {
      console.log(chalk.bold.blue(`\n📦 Upgrade Available for ${moduleName}\n`));
      console.log(`  ${chalk.gray('Current version:')} ${chalk.yellow(currentVersion)}`);
      console.log(`  ${chalk.gray('Latest version:')}  ${chalk.green(latestVersion)}`);

      if (latestResult.metadata.breaking) {
        console.log(chalk.red('\n  ⚠ WARNING: This version contains breaking changes!'));
      }

      if (latestResult.metadata.deprecated) {
        console.log(chalk.yellow('\n  ⚠ This version is deprecated'));
        if (latestResult.metadata.deprecationMessage) {
          console.log(chalk.yellow(`    ${latestResult.metadata.deprecationMessage}`));
        }
      }

      if (compatResult.details.augment) {
        const augment = compatResult.details.augment;
        console.log(`  ${chalk.gray('Augment:')} ${augment.current} ${augment.compatible ? chalk.green('✓') : chalk.red('✗')} (requires ${augment.required}+)`);
      }

      if (compatResult.warnings.length > 0) {
        console.log(chalk.yellow('\n  Compatibility Warnings:'));
        compatResult.warnings.forEach(w => console.log(chalk.yellow(`    - ${w}`)));
      }

      if (compatResult.errors.length > 0) {
        console.log(chalk.red('\n  Compatibility Errors:'));
        compatResult.errors.forEach(e => console.log(chalk.red(`    - ${e}`)));

        if (!force) {
          console.log(chalk.red('\n  Use --force to upgrade anyway'));
          process.exit(1);
        }
      }
    }

    if (dryRun) {
      if (json) {
        console.log(JSON.stringify({
          dryRun: true,
          module: moduleName,
          currentVersion,
          latestVersion,
          breaking: latestResult.metadata.breaking,
          deprecated: latestResult.metadata.deprecated,
          compatibility: compatResult
        }, null, 2));
      } else {
        console.log(chalk.cyan('\n  [DRY RUN] No changes made'));
      }
      return;
    }

    const projectRoot = findProjectRoot() ?? process.cwd();
    const configPath = path.join(projectRoot, '.augment', 'extensions.json');
    let upgraded = false;
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (!Array.isArray(config.modules)) {
          throw new Error('Invalid config format: expected .augment/extensions.json to contain a modules array');
        }

        const moduleIndex = config.modules.findIndex((entry: unknown) => resolveConfiguredModuleName(entry) === module.fullName);
        if (moduleIndex >= 0) {
          const existingEntry = config.modules[moduleIndex];
          const existingObject = existingEntry && typeof existingEntry === 'object' ? existingEntry : {};
          config.modules[moduleIndex] = {
            ...existingObject,
            name: module.fullName,
            version: latestVersion,
            upgradedAt: new Date().toISOString()
          };
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
          upgraded = true;
        }
      } catch (error) {
        const configSyncFailureMessage = 'Upgrade completed, but .augment/extensions.json could not be updated. Fix the config and rerun the command.';

        if (json) {
          console.log(JSON.stringify({
            success: false,
            error: configSyncFailureMessage,
            details: error instanceof Error ? error.message : String(error),
            module: moduleName,
            previousVersion: currentVersion,
            newVersion: latestVersion,
            breaking: latestResult.metadata.breaking,
            deprecated: latestResult.metadata.deprecated,
            configUpdated: false
          }, null, 2));
        } else {
          console.error(chalk.red(`✗ ${configSyncFailureMessage}`));
          console.error(chalk.gray(`  ${error instanceof Error ? error.message : String(error)}`));
        }

        process.exit(1);
        return;
      }
    }

    if (json) {
      console.log(JSON.stringify({
        success: true,
        module: moduleName,
        previousVersion: currentVersion,
        newVersion: latestVersion,
        breaking: latestResult.metadata.breaking,
        deprecated: latestResult.metadata.deprecated,
        configUpdated: upgraded
      }, null, 2));
      return;
    }

    console.log(chalk.green(`\n✓ Successfully upgraded ${moduleName}`));
    console.log(chalk.gray(`  ${currentVersion} → ${latestVersion}`));
    if (upgraded) {
      console.log(chalk.cyan('  📌 Config updated'));
    }
    console.log(chalk.gray('\nNext steps:'));
    console.log(chalk.gray('  - Review breaking changes if any'));
    console.log(chalk.gray('  - Test your project with the new version'));
    console.log(chalk.gray(`  - Run: filmbuff show ${moduleName} to see details`));
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ error: String(error) }, null, 2));
    } else {
      console.error(chalk.red('Error upgrading module:'), error);
    }
    process.exit(1);
  }
}

function resolveConfiguredModuleName(entry: unknown): string | null {
  const storedName = getConfiguredModuleName(entry);
  if (!storedName) {
    return null;
  }

  return findModule(storedName)?.fullName ?? null;
}

function getConfiguredModuleName(entry: unknown): string | null {
  if (typeof entry === 'string') {
    return entry.trim() || null;
  }

  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const candidate = (entry as { name?: unknown; id?: unknown }).name ?? (entry as { id?: unknown }).id;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}
