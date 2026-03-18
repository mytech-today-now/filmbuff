import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { discoverModules, Module as ModuleType } from '../utils/module-system';
import { ModuleLoader } from '../core/module-loader';

interface ListOptions {
  linked?: boolean;
  json?: boolean;
  versions?: boolean;
}

interface Module {
  name: string;
  version: string;
  description: string;
  type: string;
  linked?: boolean;
  availableVersions?: string[];
}

/** Returns the short alias (last path segment) of a module name. */
function alias(name: string): string {
  const parts = name.split('/');
  return parts[parts.length - 1];
}

/**
 * Maps a full module path to a human-readable group label.
 * Handles screenplay sub-categories (Genres, Styles, Themes, Directors, Franchises)
 * and top-level categories (Domain Rules, Workflows, Writing Standards).
 */
function getGroupLabel(fullName: string): string {
  const p = fullName.split('/');
  if (p[0] === 'writing-standards' && p[1] === 'screenplay') {
    if (p[2] === 'genres')          return 'Screenplay  >  Genres';
    if (p[2] === 'styles')          return 'Screenplay  >  Styles';
    if (p[2] === 'themes')          return 'Screenplay  >  Themes';
    if (p[2] === 'cinematic-styles') {
      if (p[3] === 'directors')     return 'Screenplay  >  Directors';
      if (p[3] === 'franchises')    return 'Screenplay  >  Franchises';
      return 'Screenplay  >  Cinematic Styles';
    }
    return 'Screenplay';
  }
  // Default: prettify first segment
  return p[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export async function listCommand(options: ListOptions): Promise<void> {
  try {
    const modules = await getModules(options.linked, options.versions || false);

    if (options.json) {
      console.log(JSON.stringify(modules, null, 2));
      return;
    }

    if (modules.length === 0) {
      console.log(chalk.yellow(options.linked ? 'No linked modules found.' : 'No modules available.'));
      return;
    }

    console.log(chalk.bold.blue(`\n${options.linked ? 'Linked' : 'Available'} Modules:\n`));

    // Group by smart category label (preserves insertion order)
    const grouped = new Map<string, Module[]>();
    for (const m of modules) {
      const cat = getGroupLabel(m.name);
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(m);
    }

    for (const [category, mods] of grouped) {
      console.log(chalk.bold.cyan(`  ${category}`));
      console.log(chalk.gray('  ' + '-'.repeat(62)));

      for (const m of mods) {
        const status = m.linked ? chalk.green('[linked]') : chalk.gray('        ');
        const shortAlias = chalk.bold(alias(m.name).padEnd(26));
        const desc = (m.description ?? '').length > 45
          ? (m.description ?? '').slice(0, 42) + '...'
          : (m.description ?? '');
        const version = chalk.gray(`v${m.version}`);
        console.log(`  ${status} ${shortAlias} ${chalk.gray(desc)} ${version}`);

        if (options.versions && m.availableVersions && m.availableVersions.length > 0) {
          console.log(`              ${chalk.gray('Versions:')} ${chalk.yellow(m.availableVersions.join(', '))}`);
        }
      }
      console.log('');
    }

    console.log(chalk.gray(`Total: ${modules.length} module(s)`));
    console.log(chalk.gray(`Tip: Use ${chalk.white('filmbuff link <alias>')} to link a module by its short name.\n`));
  } catch (error) {
    console.error(chalk.red('Error listing modules:'), error);
    process.exit(1);
  }
}

async function getModules(linkedOnly: boolean = false, showVersions: boolean = false): Promise<Module[]> {
  const modules: Module[] = [];

  // Check for linked modules in current project
  const linkedModules = getLinkedModules();

  if (linkedOnly) {
    return linkedModules;
  }

  // Get all available modules using the module system
  const discoveredModules = discoverModules();

  // Initialize module loader for version information
  const loader = showVersions ? new ModuleLoader() : null;

  for (const module of discoveredModules) {
    const moduleData: Module = {
      name: module.fullName,
      version: module.metadata.version,
      description: module.metadata.description,
      type: module.metadata.type,
      linked: linkedModules.some(m => m.name === module.fullName)
    };

    // Get available versions if requested
    if (showVersions && loader) {
      const availableVersions = loader.getAvailableVersions(module.path);
      if (availableVersions.length > 0) {
        moduleData.availableVersions = availableVersions;
      }
    }

    modules.push(moduleData);
  }

  return modules;
}

function getLinkedModules(): Module[] {
  const configPath = path.join(process.cwd(), '.augment', 'extensions.json');
  
  if (!fs.existsSync(configPath)) {
    return [];
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return (config.modules || []).map((m: any) => ({
      ...m,
      linked: true
    }));
  } catch (error) {
    return [];
  }
}

