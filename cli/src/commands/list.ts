import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { discoverModules, findProjectRoot } from '../utils/module-system';
import type { Module as DiscoveredModule } from '../utils/module-system';
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

interface LinkedModulesLookup {
  modules: Module[];
  unresolvedCount: number;
  configError?: string;
}

const LINKED_MODULES_CONFIG_ERROR_MESSAGE = 'Linked modules could not be read because .augment/extensions.json is invalid.';

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

function getLinkedModuleName(entry: unknown): string | null {
  if (typeof entry === 'string') {
    return entry.trim() || null;
  }

  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const value = (entry as any).name ?? (entry as any).id;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getLinkedModuleField(entry: unknown, key: 'version' | 'description' | 'type'): string {
  if (!entry || typeof entry === 'string' || typeof entry !== 'object') {
    return '';
  }

  const value = (entry as any)[key];
  return typeof value === 'string' && value.trim() ? value : '';
}

function resolveLinkedModule(moduleName: string, discoveredModules: DiscoveredModule[]): DiscoveredModule | null {
  const normalizedName = moduleName.toLowerCase();

  const exactMatch = discoveredModules.find(module => module.fullName.toLowerCase() === normalizedName);
  if (exactMatch) {
    return exactMatch;
  }

  const directoryMatch = discoveredModules.find(module => {
    const segments = module.fullName.split('/');
    return segments[segments.length - 1].toLowerCase() === normalizedName;
  });
  if (directoryMatch) {
    return directoryMatch;
  }

  for (const module of discoveredModules) {
    if (module.rules.some(rule => path.basename(rule, '.md').toLowerCase() === normalizedName)) {
      return module;
    }
  }

  return null;
}

function getLinkedModulesConfigIssue(config: unknown): string | null {
  if (!config || typeof config !== 'object') {
    return 'Expected .augment/extensions.json to contain a modules array.';
  }

  const modules = (config as { modules?: unknown }).modules;
  if (!Array.isArray(modules)) {
    return 'Expected .augment/extensions.json to contain a modules array.';
  }

  return null;
}

function printLinkedModulesConfigIssue(details: string): void {
  console.log(chalk.yellow(LINKED_MODULES_CONFIG_ERROR_MESSAGE));
  console.log(chalk.gray(`Details: ${details}`));
  console.log(chalk.gray('Use "filmbuff init" to recreate the file or repair .augment/extensions.json, then rerun the command.'));
}

function buildLinkedModulesLookup(discoveredModules: DiscoveredModule[]): LinkedModulesLookup {
  const projectRoot = findProjectRoot() ?? process.cwd();
  const configPath = path.join(projectRoot, '.augment', 'extensions.json');

  if (!fs.existsSync(configPath)) {
    return {
      modules: [],
      unresolvedCount: 0
    };
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const configIssue = getLinkedModulesConfigIssue(config);
    if (configIssue) {
      return {
        modules: [],
        unresolvedCount: 0,
        configError: configIssue
      };
    }

    const rawModules = config.modules as unknown[];
    let unresolvedCount = 0;
    let invalidEntryCount = 0;

    const modules = rawModules
      .map((entry: unknown): Module | null => {
        const moduleName = getLinkedModuleName(entry);
        if (!moduleName) {
          invalidEntryCount++;
          return null;
        }

        const resolvedModule = resolveLinkedModule(moduleName, discoveredModules);
        if (!resolvedModule) {
          unresolvedCount++;
        }

        return {
          name: resolvedModule?.fullName ?? moduleName,
          version: getLinkedModuleField(entry, 'version') || resolvedModule?.metadata.version || '',
          description: getLinkedModuleField(entry, 'description') || resolvedModule?.metadata.description || '',
          type: getLinkedModuleField(entry, 'type') || resolvedModule?.metadata.type || '',
          linked: true
        };
      })
      .filter((module): module is Module => module !== null);

    const configError = invalidEntryCount > 0
      ? `Linked modules config contains ${invalidEntryCount} ${invalidEntryCount === 1 ? 'entry' : 'entries'} missing a module name.`
      : undefined;

    return {
      modules,
      unresolvedCount,
      configError
    };
  } catch (error) {
    return {
      modules: [],
      unresolvedCount: 0,
      configError: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function listCommand(options: ListOptions): Promise<void> {
  try {
    const { modules, unresolvedCount, configError } = await getModules(options.linked, options.versions || false);

    if (options.json) {
      if (configError) {
        console.log(JSON.stringify({
          error: LINKED_MODULES_CONFIG_ERROR_MESSAGE,
          details: configError,
          modules
        }, null, 2));
        return;
      }

      console.log(JSON.stringify(modules, null, 2));
      return;
    }

    if (configError) {
      printLinkedModulesConfigIssue(configError);
      if (modules.length === 0) {
        return;
      }
    }

    if (modules.length === 0) {
      console.log(chalk.yellow(options.linked ? 'No linked modules found.' : 'No modules available.'));
      if (unresolvedCount > 0) {
        console.log(chalk.yellow('Linked status may be incomplete until legacy names are normalized.'));
      }
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
    if (unresolvedCount > 0) {
      console.log(chalk.yellow('Linked status may be incomplete until legacy names are normalized.'));
    }
    console.log(chalk.gray(`Tip: Use ${chalk.white('filmbuff link <alias>')} to link a module by its short name.\n`));
  } catch (error) {
    console.error(chalk.red('Error listing modules:'), error);
    process.exit(1);
  }
}

async function getModules(linkedOnly: boolean = false, showVersions: boolean = false): Promise<LinkedModulesLookup> {
  // Get all available modules using the module system
  const discoveredModules = discoverModules();
  const linkedModules = buildLinkedModulesLookup(discoveredModules);

  if (linkedOnly) {
    return linkedModules;
  }

  // Initialize module loader for version information
  const loader = showVersions ? new ModuleLoader() : null;
  const modules: Module[] = [];

  for (const module of discoveredModules) {
    const moduleData: Module = {
      name: module.fullName,
      version: module.metadata.version,
      description: module.metadata.description,
      type: module.metadata.type,
      linked: linkedModules.modules.some(m => m.name === module.fullName)
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

  return {
    modules,
    unresolvedCount: linkedModules.unresolvedCount,
    configError: linkedModules.configError
  };
}

