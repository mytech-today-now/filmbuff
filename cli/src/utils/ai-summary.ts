/**
 * AI Summary Generation Utilities
 *
 * Generates concise summaries of modules for AI context with caching and fallback metadata.
 */

import { Module } from './module-system';
import type { AugmentConfig } from './config-system';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface ModuleSummary {
  name: string;
  version: string;
  type: string;
  description: string;
  keyRules: string[];
  exampleCount: number;
  characterCount: number;
  tags: string[];
  summary: string;
}

export type AISummaryFormat = 'json' | 'compact' | 'detailed' | 'context';

export interface AISummaryResult {
  format: AISummaryFormat;
  content: string;
  source: 'generated' | 'cache' | 'fallback';
  metadata: {
    cacheKey: string;
    cacheHit: boolean;
    generatedAt: string;
    attempts: number;
    fallbackUsed: boolean;
    retryable: boolean;
    errors: string[];
  };
}

export interface AISummaryOptions {
  format?: AISummaryFormat;
  includeContent?: boolean;
  retryAttempts?: number;
  config?: Pick<AugmentConfig, 'ai'>;
}

interface CachedSummaryEntry {
  format: AISummaryFormat;
  content: string;
  createdAt: string;
  expiresAt: number;
}

const DEFAULT_CACHE_CONFIG = {
  enabled: true,
  ttlSeconds: 3600,
  directory: '.augment/cache/ai-summaries',
  retryAttempts: 1
};

/**
 * Generate a concise summary of a module
 */
export function generateModuleSummary(module: Module): ModuleSummary {
  const keyRules = module.rules?.slice(0, 10) || [];
  const exampleCount = module.examples?.length || 0;
  const characterCount = module.metadata.augment?.characterCount || 0;
  const tags = module.metadata.tags || [];

  const summary = `${module.fullName} (v${module.metadata.version}) provides ${module.metadata.type} guidelines. ` +
    `Includes ${keyRules.length} key rules and ${exampleCount} examples. ` +
    `Total content: ~${characterCount} characters.`;

  return {
    name: module.fullName,
    version: module.metadata.version,
    type: module.metadata.type,
    description: module.metadata.description,
    keyRules,
    exampleCount,
    characterCount,
    tags,
    summary
  };
}

/**
 * Generate a detailed AI-friendly summary
 */
export function generateDetailedSummary(module: Module, includeContent: boolean = false): string {
  const summary = generateModuleSummary(module);

  let output = `# ${summary.name}\n\n`;
  output += `**Version**: ${summary.version}\n`;
  output += `**Type**: ${summary.type}\n`;
  output += `**Description**: ${summary.description}\n\n`;

  output += `## Quick Summary\n${summary.summary}\n\n`;

  if (summary.tags.length > 0) {
    output += `## Tags\n${summary.tags.map(tag => `- ${tag}`).join('\n')}\n\n`;
  }

  if (summary.keyRules.length > 0) {
    output += `## Key Rules\n`;
    summary.keyRules.forEach((rule, i) => {
      output += `${i + 1}. ${rule}\n`;
    });
    output += '\n';
  }

  if (summary.exampleCount > 0) {
    output += `## Examples\n`;
    output += `This module includes ${summary.exampleCount} example(s).\n\n`;
  }

  output += `## Metrics\n`;
  output += `- Character Count: ${summary.characterCount.toLocaleString()}\n`;
  output += `- Rules: ${summary.keyRules.length}\n`;
  output += `- Examples: ${summary.exampleCount}\n\n`;

  if (includeContent && module.path) {
    output += `## Content Preview\n`;
    output += generateContentPreview(module);
  }

  return output;
}

/**
 * Generate a content preview from module files
 */
function generateContentPreview(module: Module): string {
  let preview = '';

  // Try to read README
  const readmePath = path.join(module.path, 'README.md');
  if (fs.existsSync(readmePath)) {
    const content = fs.readFileSync(readmePath, 'utf-8');
    const lines = content.split('\n').slice(0, 20);
    preview += '### README.md (first 20 lines)\n```markdown\n';
    preview += lines.join('\n');
    preview += '\n```\n\n';
  }

  // Try to read first rule file
  if (module.rules && module.rules.length > 0) {
    const firstRule = module.rules[0];
    const rulePath = path.join(module.path, 'rules', firstRule);
    if (fs.existsSync(rulePath)) {
      const content = fs.readFileSync(rulePath, 'utf-8');
      const lines = content.split('\n').slice(0, 15);
      preview += `### ${firstRule} (first 15 lines)\n\`\`\`markdown\n`;
      preview += lines.join('\n');
      preview += '\n```\n\n';
    }
  }

  return preview || 'No content preview available.\n';
}

/**
 * Generate a JSON summary for programmatic use
 */
export function generateJSONSummary(module: Module): string {
  const summary = generateModuleSummary(module);
  return JSON.stringify(summary, null, 2);
}

/**
 * Generate a compact one-line summary
 */
export function generateCompactSummary(module: Module): string {
  const summary = generateModuleSummary(module);
  return `${summary.name} v${summary.version}: ${summary.description} (${summary.keyRules.length} rules, ${summary.exampleCount} examples)`;
}

/**
 * Generate AI context string for injection
 */
export function generateAIContext(module: Module): string {
  const summary = generateModuleSummary(module);

  let context = `Module: ${summary.name}\n`;
  context += `Type: ${summary.type}\n`;
  context += `Description: ${summary.description}\n\n`;

  context += `Key Standards:\n`;
  summary.keyRules.forEach((rule, i) => {
    context += `${i + 1}. ${rule}\n`;
  });

  context += `\nWhen generating code, follow these ${summary.type} standards from ${summary.name}.\n`;

  return context;
}

/**
 * Generate a summary with optimization suggestions
 */
export function generateSummaryWithSuggestions(module: Module): string {
  const summary = generateDetailedSummary(module, false);

  let suggestions = '\n## AI Usage Suggestions\n\n';
  suggestions += `### For Code Generation\n`;
  suggestions += `Use this module when generating ${module.metadata.type} code to ensure compliance with standards.\n\n`;

  suggestions += `### For Code Review\n`;
  suggestions += `Reference these rules when reviewing code for ${module.metadata.type} best practices.\n\n`;

  suggestions += `### For Refactoring\n`;
  suggestions += `Apply these standards when refactoring existing code to improve quality and maintainability.\n\n`;

  return summary + suggestions;
}

export function generateAISummary(module: Module, options: AISummaryOptions = {}): AISummaryResult {
  const format = options.format || 'detailed';
  const cacheConfig = resolveCacheConfig(options.config);
  const cacheKey = createCacheKey(module, format, Boolean(options.includeContent));

  if (cacheConfig.enabled) {
    const cachedEntry = readCachedSummary(cacheConfig.directory, cacheKey);
    if (cachedEntry) {
      return {
        format,
        content: cachedEntry.content,
        source: 'cache',
        metadata: {
          cacheKey,
          cacheHit: true,
          generatedAt: cachedEntry.createdAt,
          attempts: 1,
          fallbackUsed: false,
          retryable: false,
          errors: []
        }
      };
    }
  }

  const attempts = Math.max(1, (options.retryAttempts ?? cacheConfig.retryAttempts) + 1);
  const errors: string[] = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const content = generateSummaryByFormat(module, format, Boolean(options.includeContent));
      const generatedAt = new Date().toISOString();

      if (cacheConfig.enabled) {
        writeCachedSummary(cacheConfig.directory, cacheKey, {
          format,
          content,
          createdAt: generatedAt,
          expiresAt: Date.now() + cacheConfig.ttlSeconds * 1000
        });
      }

      return {
        format,
        content,
        source: 'generated',
        metadata: {
          cacheKey,
          cacheHit: false,
          generatedAt,
          attempts: attempt,
          fallbackUsed: false,
          retryable: false,
          errors
        }
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    format,
    content: generateFallbackSummary(module),
    source: 'fallback',
    metadata: {
      cacheKey,
      cacheHit: false,
      generatedAt: new Date().toISOString(),
      attempts,
      fallbackUsed: true,
      retryable: true,
      errors
    }
  };
}

export function clearAISummaryCache(cacheDirectory: string = DEFAULT_CACHE_CONFIG.directory): void {
  if (fs.existsSync(cacheDirectory)) {
    fs.rmSync(cacheDirectory, { recursive: true, force: true });
  }
}

function generateSummaryByFormat(module: Module, format: AISummaryFormat, includeContent: boolean): string {
  switch (format) {
    case 'json':
      return generateJSONSummary(module);
    case 'compact':
      return generateCompactSummary(module);
    case 'context':
      return generateAIContext(module);
    case 'detailed':
    default:
      return generateDetailedSummary(module, includeContent);
  }
}

function resolveCacheConfig(config?: Pick<AugmentConfig, 'ai'>) {
  return {
    enabled: config?.ai?.summaryCache?.enabled ?? DEFAULT_CACHE_CONFIG.enabled,
    ttlSeconds: config?.ai?.summaryCache?.ttlSeconds ?? DEFAULT_CACHE_CONFIG.ttlSeconds,
    directory: config?.ai?.summaryCache?.directory ?? DEFAULT_CACHE_CONFIG.directory,
    retryAttempts: config?.ai?.summaryCache?.retryAttempts ?? DEFAULT_CACHE_CONFIG.retryAttempts
  };
}

function createCacheKey(module: Module, format: AISummaryFormat, includeContent: boolean): string {
  return crypto.createHash('sha1').update(JSON.stringify({
    module: safeValue(() => module.fullName, 'unknown-module'),
    version: safeValue(() => module.metadata.version, 'unknown-version'),
    type: safeValue(() => module.metadata.type, 'unknown-type'),
    path: safeValue(() => module.path, 'unknown-path'),
    format,
    includeContent,
    rules: safeValue(() => module.rules, [] as string[]),
    examples: safeValue(() => module.examples, [] as string[]),
    characterCount: safeValue(() => module.metadata.augment?.characterCount || 0, 0)
  })).digest('hex');
}

function getCacheFilePath(cacheDirectory: string, cacheKey: string): string {
  return path.join(cacheDirectory, `${cacheKey}.json`);
}

function readCachedSummary(cacheDirectory: string, cacheKey: string): CachedSummaryEntry | null {
  const filePath = getCacheFilePath(cacheDirectory, cacheKey);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const entry = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CachedSummaryEntry;
    if (entry.expiresAt < Date.now()) {
      fs.rmSync(filePath, { force: true });
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function writeCachedSummary(cacheDirectory: string, cacheKey: string, entry: CachedSummaryEntry): void {
  fs.mkdirSync(cacheDirectory, { recursive: true });
  fs.writeFileSync(getCacheFilePath(cacheDirectory, cacheKey), JSON.stringify(entry, null, 2));
}

function generateFallbackSummary(module: Module): string {
  const name = safeValue(() => module.fullName, 'unknown-module');
  const version = safeValue(() => module.metadata.version, 'unknown-version');
  return `${name} v${version}: AI summary unavailable. Retry the command to attempt regeneration.`;
}

function safeValue<T>(getter: () => T, fallback: T): T {
  try {
    return getter();
  } catch {
    return fallback;
  }
}

