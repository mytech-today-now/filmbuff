import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { discoverModules, getModulesDir, type ModuleMetadata, validateModuleStructure } from '../utils/module-system';
import { deriveSlug } from '../utils/wizard-utils';

const MODULE_TYPES = [
  'coding-standards',
  'domain-rules',
  'workflows',
  'examples',
  'marketing-standards',
  'writing-standards',
  'themes'
] as const;

type ModuleType = typeof MODULE_TYPES[number];

interface CreateOptions {
  type?: string;
}

function isDirectory(target: string): boolean {
  return fs.existsSync(target) && fs.statSync(target).isDirectory();
}

function toRelativePath(target: string): string {
  return path.relative(process.cwd(), target).replace(/\\/g, '/');
}

function resolveModuleType(rawType?: string): ModuleType | null {
  const requestedType = rawType === undefined ? 'coding-standards' : rawType.trim();
  if (!requestedType) {
    return null;
  }

  return MODULE_TYPES.includes(requestedType as ModuleType)
    ? (requestedType as ModuleType)
    : null;
}

function normalizeModuleName(rawName: string): string | null {
  const trimmed = rawName.trim();
  if (!trimmed) {
    return null;
  }

  if (path.isAbsolute(trimmed) || trimmed.includes('/') || trimmed.includes('\\')) {
    return null;
  }

  const slug = deriveSlug(trimmed);
  return slug.length > 0 ? slug : null;
}

function titleize(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildReadme(displayName: string, fullName: string, slug: string): string {
  return `# ${displayName}

Generated module scaffold for \`${fullName}\`.

## Overview

Describe what this module teaches, enforces, or generates.

## Files

- \`module.json\` - Module metadata and discovery entry.
- \`rules/${slug}.md\` - Starter rule file.

## Next Steps

- Replace the placeholder guidance with real module content.
- Add additional rule files and examples as the module grows.
`;
}

function buildRuleFile(displayName: string, fullName: string): string {
  return `# ${displayName}

This starter rule file was created by \`filmbuff create\`.

## Purpose

Describe the core guidance for \`${fullName}\` here.

## Starter Checklist

- Replace this placeholder with the actual rules.
- Add supporting examples if needed.
- Run \`filmbuff validate ${fullName}\` after editing.
`;
}

export async function createCommand(name: string, options: CreateOptions = {}): Promise<void> {
  console.log(chalk.blue(`Creating new module scaffold: ${name}`));

  const moduleType = resolveModuleType(options.type);
  if (!moduleType) {
    console.error(
      chalk.red(
        `✗ Invalid module type "${options.type ?? ''}". Expected one of: ${MODULE_TYPES.join(', ')}`
      )
    );
    process.exit(1);
    return;
  }

  const slug = normalizeModuleName(name);
  if (!slug) {
    console.error(chalk.red(`✗ Invalid module name or path "${name}". Use a simple module name without path separators.`));
    process.exit(1);
    return;
  }

  const modulesRoot = getModulesDir();
  const typeDir = path.join(modulesRoot, moduleType);
  const moduleDir = path.join(typeDir, slug);
  const fullName = `${moduleType}/${slug}`;
  const displayName = titleize(slug);
  const description = `Generated ${moduleType} module scaffold for ${displayName}.`;

  let createdModuleDir = false;

  try {
    if (fs.existsSync(modulesRoot) && !isDirectory(modulesRoot)) {
      throw new Error(`Target modules root exists and is not a directory: ${toRelativePath(modulesRoot)}`);
    }

    if (fs.existsSync(typeDir) && !isDirectory(typeDir)) {
      throw new Error(`Target module category exists and is not a directory: ${toRelativePath(typeDir)}`);
    }

    if (fs.existsSync(moduleDir)) {
      if (isDirectory(moduleDir)) {
        throw new Error(`Module directory already exists: ${toRelativePath(moduleDir)}`);
      }

      throw new Error(`Target path exists and is not a directory: ${toRelativePath(moduleDir)}`);
    }

    const localModules = fs.existsSync(modulesRoot) && isDirectory(modulesRoot)
      ? discoverModules()
      : [];

    const duplicate = localModules.find(module =>
      module.fullName.toLowerCase() === fullName.toLowerCase() ||
      module.metadata.name.toLowerCase() === slug.toLowerCase()
    );

    if (duplicate) {
      throw new Error(`Module already exists: ${duplicate.fullName}`);
    }

    fs.mkdirSync(moduleDir, { recursive: true });
    createdModuleDir = true;
    fs.mkdirSync(path.join(moduleDir, 'rules'), { recursive: true });
    fs.mkdirSync(path.join(moduleDir, 'examples'), { recursive: true });

    const metadata: ModuleMetadata = {
      name: slug,
      version: '1.0.0',
      displayName,
      description,
      type: moduleType,
      tags: [moduleType, slug],
      augment: {
        priority: 'medium',
        category: moduleType
      }
    };

    fs.writeFileSync(
      path.join(moduleDir, 'module.json'),
      `${JSON.stringify(metadata, null, 2)}\n`,
      'utf-8'
    );
    fs.writeFileSync(path.join(moduleDir, 'README.md'), `${buildReadme(displayName, fullName, slug).trimEnd()}\n`, 'utf-8');
    fs.writeFileSync(path.join(moduleDir, 'rules', `${slug}.md`), `${buildRuleFile(displayName, fullName).trimEnd()}\n`, 'utf-8');

    const validation = validateModuleStructure(moduleDir);
    if (!validation.valid) {
      throw new Error(validation.errors.join('; '));
    }

    console.log(chalk.green(`✓ Created module scaffold at ${toRelativePath(moduleDir)}`));
    console.log(chalk.gray('Created files:'));
    console.log(chalk.gray(`  • ${toRelativePath(path.join(moduleDir, 'module.json'))}`));
    console.log(chalk.gray(`  • ${toRelativePath(path.join(moduleDir, 'README.md'))}`));
    console.log(chalk.gray(`  • ${toRelativePath(path.join(moduleDir, 'rules', `${slug}.md`))}`));
    console.log(chalk.gray(`  • ${toRelativePath(path.join(moduleDir, 'examples'))}/`));
    console.log(chalk.gray('\nNext steps:'));
    console.log(chalk.cyan(`  • filmbuff list`));
    console.log(chalk.cyan(`  • filmbuff show ${fullName}`));
    console.log(chalk.cyan(`  • filmbuff validate ${fullName}\n`));
  } catch (error) {
    if (createdModuleDir && fs.existsSync(moduleDir)) {
      try {
        fs.rmSync(moduleDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup only.
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`✗ Failed to create module "${name}": ${message}`));
    process.exit(1);
    return;
  }
}
