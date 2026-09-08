import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { VersionManager } from '../core/version-manager';
import { ModuleLoader } from '../core/module-loader';
import { findModule, findProjectRoot } from '../utils/module-system';

function getLinkedModuleName(module: unknown): string | undefined {
  if (typeof module === 'string') {
    return module;
  }

  if (module && typeof module === 'object') {
    const record = module as Record<string, unknown>;
    if (typeof record.name === 'string') return record.name;
    if (typeof record.id === 'string') return record.id;
  }

  return undefined;
}

function fail(message: string): void {
  console.error(chalk.red(message));
  process.exit(1);
}

function getAvailableVersions(modulePath: string): string[] {
  const versionManager = new VersionManager();
  const loader = new ModuleLoader(versionManager);
  const availableVersions = new Set<string>();

  const metadataVersion = versionManager.getVersion(modulePath)?.version;
  if (metadataVersion) {
    availableVersions.add(metadataVersion);
  }

  const moduleMetadataVersion = loader.getVersionMetadata(modulePath)?.version;
  if (moduleMetadataVersion) {
    availableVersions.add(moduleMetadataVersion);
  }

  for (const version of loader.getAvailableVersions(modulePath)) {
    availableVersions.add(version);
  }

  return [...availableVersions];
}

export async function pinCommand(moduleName: string, version: string): Promise<void> {
  try {
    console.log(chalk.blue(`Pinning module: ${moduleName}`));

    const projectRoot = findProjectRoot() ?? process.cwd();
    const configPath = path.join(projectRoot, '.augment', 'extensions.json');

    if (!fs.existsSync(configPath)) {
      fail('Filmbuff not initialized. Run: filmbuff init');
      return;
    }

    const module = findModule(moduleName);

    if (!module) {
      fail(`Module not found: ${moduleName}`);
      return;
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const linkedModules = Array.isArray(config.modules) ? config.modules : [];
    const canonicalModuleId = module.fullName;

    const moduleIndex = linkedModules.findIndex((entry: unknown) => {
      const linkedModuleName = getLinkedModuleName(entry);
      return (
        linkedModuleName === canonicalModuleId ||
        linkedModuleName === moduleName ||
        linkedModuleName === module.metadata.name
      );
    });

    if (moduleIndex === -1) {
      fail(`Module not found: ${moduleName}`);
      return;
    }

    const availableVersions = getAvailableVersions(module.path);
    if (!availableVersions.includes(version)) {
      fail(`Version not found: ${version} for ${canonicalModuleId}`);
      return;
    }

    const linkedModule = linkedModules[moduleIndex];

    if (typeof linkedModule === 'string') {
      linkedModules[moduleIndex] = {
        name: canonicalModuleId,
        version,
        type: module.metadata.type,
        description: module.metadata.description
      };
    } else if (linkedModule && typeof linkedModule === 'object') {
      const record = linkedModule as Record<string, unknown>;

      if (record.version === version) {
        console.log(chalk.gray(`Module already pinned: ${canonicalModuleId} (v${version})`));
        return;
      }

      record.version = version;
    }

    config.modules = linkedModules;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log(chalk.green(`✓ Pinned ${canonicalModuleId} to version ${version}`));
  } catch (error) {
    console.error(chalk.red('Error pinning module:'), error);
    process.exit(1);
  }
}
