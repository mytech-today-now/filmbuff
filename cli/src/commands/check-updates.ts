import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import {
  compareSemanticVersions,
  findModule,
  findProjectRoot,
  isValidSemanticVersion,
  validateModuleMetadata,
  type Module
} from '../utils/module-system';

export interface CheckUpdatesOptions {
  json?: boolean;
}

type UpdateStatus = 'current' | 'outdated' | 'ahead' | 'unsupported' | 'missing-version';

interface LinkedModuleEntry {
  name?: string;
  id?: string;
  version?: string;
  type?: string;
  description?: string;
}

interface UpdateCheckResult {
  name: string;
  status: UpdateStatus;
  linkedVersion?: string;
  availableVersion?: string;
  message?: string;
}

interface UpdateSummary {
  current: number;
  outdated: number;
  ahead: number;
  unsupported: number;
  missingVersion: number;
}

function fail(message: string): never {
  console.error(chalk.red(message));
  process.exit(1);
}

function getLinkedModuleName(entry: unknown): string | undefined {
  if (typeof entry === 'string') {
    return entry;
  }

  if (entry && typeof entry === 'object') {
    const record = entry as LinkedModuleEntry;
    return record.name ?? record.id;
  }

  return undefined;
}

function getLinkedModuleVersion(entry: unknown): string | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }

  const record = entry as LinkedModuleEntry;
  return typeof record.version === 'string' ? record.version : undefined;
}

function getModuleMetadataIssue(module: Module): string | null {
  const validation = validateModuleMetadata(module.metadata);

  if (!validation.valid) {
    return validation.errors.join('; ');
  }

  if (!isValidSemanticVersion(module.metadata.version)) {
    return `Invalid version format: ${module.metadata.version}`;
  }

  return null;
}

function getLinkedModuleIssue(version: string | undefined, moduleName: string): string | null {
  if (version === undefined || version.trim() === '') {
    return `Missing version for linked module: ${moduleName}`;
  }

  if (!isValidSemanticVersion(version)) {
    return `Invalid linked version for ${moduleName}: ${version}`;
  }

  return null;
}

function evaluateModuleUpdate(entry: unknown): UpdateCheckResult {
  const name = getLinkedModuleName(entry);

  if (!name) {
    return {
      name: '<unknown>',
      status: 'unsupported',
      message: 'Missing module name in .augment/extensions.json'
    };
  }

  const linkedVersion = getLinkedModuleVersion(entry);
  const linkedVersionIssue = getLinkedModuleIssue(linkedVersion, name);

  if (linkedVersionIssue) {
    return {
      name,
      status: 'missing-version',
      linkedVersion,
      message: linkedVersionIssue
    };
  }

  const module = findModule(name);

  if (!module) {
    return {
      name,
      status: 'unsupported',
      linkedVersion,
      message: `Module not found: ${name}`
    };
  }

  const metadataIssue = getModuleMetadataIssue(module);

  if (metadataIssue) {
    return {
      name: module.fullName,
      status: 'unsupported',
      linkedVersion,
      message: `Unsupported module metadata for ${module.fullName}: ${metadataIssue}`
    };
  }

  const availableVersion = module.metadata.version.trim();
  const comparison = compareSemanticVersions(availableVersion, linkedVersion as string);

  if (comparison > 0) {
    return {
      name: module.fullName,
      status: 'outdated',
      linkedVersion,
      availableVersion
    };
  }

  if (comparison < 0) {
    return {
      name: module.fullName,
      status: 'ahead',
      linkedVersion,
      availableVersion,
      message: `Linked version is newer than the local module source`
    };
  }

  return {
    name: module.fullName,
    status: 'current',
    linkedVersion,
    availableVersion
  };
}

function summarizeResults(results: UpdateCheckResult[]): UpdateSummary {
  return results.reduce<UpdateSummary>(
    (summary, result) => {
      switch (result.status) {
        case 'current':
          summary.current++;
          break;
        case 'outdated':
          summary.outdated++;
          break;
        case 'ahead':
          summary.ahead++;
          break;
        case 'unsupported':
          summary.unsupported++;
          break;
        case 'missing-version':
          summary.missingVersion++;
          break;
      }
      return summary;
    },
    {
      current: 0,
      outdated: 0,
      ahead: 0,
      unsupported: 0,
      missingVersion: 0
    }
  );
}

function hasBlockingIssues(summary: UpdateSummary): boolean {
  return summary.outdated > 0 || summary.ahead > 0 || summary.unsupported > 0 || summary.missingVersion > 0;
}

function formatVersion(version: string): string {
  return `v${version}`;
}

function printHumanResults(results: UpdateCheckResult[], summary: UpdateSummary): void {
  console.log(chalk.blue('\n🔎 Checking for updates...\n'));

  if (results.length === 0) {
    console.log(chalk.yellow('No modules linked. Use "filmbuff link <module>" to link modules.'));
    return;
  }

  for (const result of results) {
    switch (result.status) {
      case 'current':
        console.log(chalk.green(`✓ ${result.name} is up to date (${formatVersion(result.availableVersion!)})`));
        break;
      case 'outdated':
        console.log(
          chalk.yellow(
            `⚠ ${result.name} is outdated: ${formatVersion(result.linkedVersion!)} → ${formatVersion(result.availableVersion!)}`
          )
        );
        break;
      case 'ahead':
        console.log(
          chalk.yellow(
            `⚠ ${result.name} is newer than the local module source: ${formatVersion(result.linkedVersion!)} → ${formatVersion(result.availableVersion!)}`
          )
        );
        break;
      case 'unsupported':
      case 'missing-version':
        console.log(chalk.red(`✗ ${result.name}: ${result.message}`));
        break;
    }
  }

  console.log(
    chalk.gray(
      `\nSummary: ${summary.current} current, ${summary.outdated} outdated, ${summary.ahead} newer-than-source, ${summary.unsupported} unsupported, ${summary.missingVersion} missing-version`
    )
  );

  if (summary.outdated > 0 || summary.ahead > 0) {
    console.log(chalk.cyan('Use "filmbuff update" to sync linked modules.'));
  }
}

export async function checkUpdatesCommand(options: CheckUpdatesOptions = {}): Promise<void> {
  try {
    const projectRoot = findProjectRoot() ?? process.cwd();
    const configPath = path.join(projectRoot, '.augment', 'extensions.json');

    if (!fs.existsSync(configPath)) {
      fail('Filmbuff not initialized. Run: filmbuff init');
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const linkedModules: unknown[] = Array.isArray(config.modules) ? config.modules : [];
    const results = linkedModules.map(evaluateModuleUpdate);
    const summary = summarizeResults(results);
    const shouldExitNonZero = hasBlockingIssues(summary);

    if (options.json) {
      console.log(JSON.stringify({
        success: !shouldExitNonZero,
        summary,
        modules: results
      }, null, 2));

      if (shouldExitNonZero) {
        process.exit(1);
      }

      return;
    }

    printHumanResults(results, summary);

    if (shouldExitNonZero) {
      process.exit(1);
    }
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ error: String(error) }, null, 2));
    } else {
      console.error(chalk.red('Error checking for updates:'), error);
    }
    process.exit(1);
  }
}
