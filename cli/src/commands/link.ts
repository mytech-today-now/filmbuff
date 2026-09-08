import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { findModule, findProjectRoot } from '../utils/module-system';

interface LinkOptions {
  version?: string;
}

function getLinkedModuleId(module: any): string | undefined {
  if (typeof module === 'string') {
    return module;
  }

  return module?.name ?? module?.id;
}

export async function linkCommand(moduleName: string, options: LinkOptions): Promise<void> {
  try {
    console.log(chalk.blue(`Linking module: ${moduleName}`));

    // Load extensions config
    const projectRoot = findProjectRoot() ?? process.cwd();
    const configPath = path.join(projectRoot, '.augment', 'extensions.json');
    
    if (!fs.existsSync(configPath)) {
      console.error(chalk.red('Filmbuff not initialized. Run: filmbuff init'));
      process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    // Check if module exists
    const module = findModule(moduleName);

    if (!module) {
      console.error(chalk.red(`Module not found: ${moduleName}`));
      process.exit(1);
    }

    const canonicalModuleId = module.fullName;
    const linkedModules = Array.isArray(config.modules) ? config.modules : [];

    // Check if already linked
    const existingIndex = linkedModules.findIndex((m: any) => getLinkedModuleId(m) === canonicalModuleId);
    
    if (existingIndex >= 0) {
      console.log(chalk.yellow(`Module already linked: ${canonicalModuleId}`));
      console.log(chalk.gray('Use "filmbuff update" to update to latest version'));
      return;
    }

    // Add to config
    linkedModules.push({
      name: module.fullName,
      version: options.version || module.metadata.version,
      type: module.metadata.type,
      description: module.metadata.description
    });

    config.modules = linkedModules;

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log(chalk.green(`✓ Linked ${module.fullName} (v${options.version || module.metadata.version})`));
    console.log(chalk.gray(`\nUse "filmbuff show ${module.fullName}" to view module details`));

  } catch (error) {
    console.error(chalk.red('Error linking module:'), error);
    process.exit(1);
  }
}

