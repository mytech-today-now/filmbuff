/**
 * Inspection Markdown Formatter  (bd-modinsp.4.3)
 *
 * Formats module inspection data as Markdown suitable for:
 *   - VS Code Markdown Preview (tables, code blocks, Mermaid diagrams)
 *   - GitHub rendering
 *   - Export to .md files
 *
 * Features:
 *   - All report sections: header, summary, dependency-tree, files, recommendations, optimizations
 *   - GFM tables for file inventory and recommendations
 *   - Fenced code blocks with language hints for optimization examples
 *   - Mermaid graph diagram for the module → directory → file dependency tree
 *   - Section filtering via `sections` option
 *   - `maxFiles` to cap the file-inventory table
 *
 * Implements: bd-modinsp.4.3 (Markdown Formatter)
 */

import * as nodePath from 'path';
import type { Module, ExtendedModuleMetadata, FileInfo } from '../module-system';
import type { RefactoringRecommendation } from '../refactoring-recommendations';
import type { OptimizationSuggestion } from '../optimization-suggestions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MarkdownSection =
  | 'header'
  | 'summary'
  | 'dependency-tree'
  | 'files'
  | 'recommendations'
  | 'optimizations';

/** Raw inspection data accepted by the Markdown formatter. */
export interface MarkdownInspectionInput {
  module: Module;
  metadata: ExtendedModuleMetadata;
  files: FileInfo[];
  recommendations?: RefactoringRecommendation[];
  optimizationSuggestions?: OptimizationSuggestion[];
}

/** Options controlling the Markdown formatter output. */
export interface MarkdownFormatterOptions {
  /**
   * Subset of sections to render.  Omit or pass `undefined` / `[]` to render all.
   */
  sections?: MarkdownSection[];
  /**
   * Maximum number of files shown in the file-inventory table.  Default: unlimited.
   */
  maxFiles?: number;
}

// ---------------------------------------------------------------------------
// Escape helpers
// ---------------------------------------------------------------------------

/** Escape pipe characters inside GFM table cells. */
function mdEsc(value: string): string {
  return value.replace(/\|/g, '\\|');
}

/** Convert an arbitrary string to a valid Mermaid node ID (alphanumeric + underscores). */
function mermaidId(value: string): string {
  return 'n_' + value.replace(/[^a-zA-Z0-9]/g, '_');
}

/** Escape double-quotes in Mermaid node labels (use single quotes instead). */
function mermaidLabel(value: string): string {
  return value.replace(/"/g, "'");
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderHeader(module: Module, meta: ExtendedModuleMetadata, generatedAt: string): string {
  const lines: string[] = [];
  lines.push(`# ${module.fullName}`);
  lines.push('');
  lines.push(`> **${module.metadata.displayName}** v${module.metadata.version}  `);
  lines.push(`> ${meta.description || module.metadata.description}  `);
  lines.push(`> _Generated: ${generatedAt}_`);
  return lines.join('\n');
}

function renderSummary(meta: ExtendedModuleMetadata, files: FileInfo[]): string {
  const lines: string[] = [];
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|------:|');
  lines.push(`| Total files | ${meta.files?.total ?? files.length} |`);
  lines.push(`| Rules | ${meta.files?.rules ?? 0} |`);
  lines.push(`| Examples | ${meta.files?.examples ?? 0} |`);
  lines.push(`| Other | ${meta.files?.other ?? 0} |`);
  lines.push(`| Total bytes | ${(meta.size?.totalBytes ?? 0).toLocaleString()} |`);
  lines.push(`| Total characters | ${(meta.size?.totalCharacters ?? 0).toLocaleString()} |`);
  if (meta.lastModified) {
    lines.push(`| Last modified | ${meta.lastModified.toISOString().slice(0, 10)} |`);
  }
  return lines.join('\n');
}

function renderDependencyTree(module: Module, files: FileInfo[]): string {
  const lines: string[] = [];
  lines.push('## Dependency Tree');
  lines.push('');
  lines.push('```mermaid');
  lines.push('graph TD');

  const modId = mermaidId(module.fullName);
  lines.push(`  ${modId}["📦 ${mermaidLabel(module.fullName)}"]`);

  // Group by top-level directory
  const dirMap = new Map<string, FileInfo[]>();
  for (const file of files) {
    const parts = file.relativePath.replace(/\\/g, '/').split('/');
    const topDir = parts.length > 1 ? parts[0] : '(root)';
    if (!dirMap.has(topDir)) dirMap.set(topDir, []);
    dirMap.get(topDir)!.push(file);
  }

  for (const [dir, dirFiles] of dirMap) {
    const dirId = mermaidId(`${module.fullName}/${dir}`);
    lines.push(`  ${dirId}["📁 ${mermaidLabel(dir)}"]`);
    lines.push(`  ${modId} --> ${dirId}`);
    const sample = dirFiles.slice(0, 5);
    for (const file of sample) {
      const fName = nodePath.basename(file.relativePath);
      const fId = mermaidId(file.relativePath);
      const icon = file.type === 'rule' ? '📋' : file.type === 'example' ? '💡' : '📄';
      lines.push(`  ${fId}["${icon} ${mermaidLabel(fName)}"]`);
      lines.push(`  ${dirId} --> ${fId}`);
    }
    if (dirFiles.length > 5) {
      const moreId = mermaidId(`${module.fullName}/${dir}/more`);
      lines.push(`  ${moreId}["… ${dirFiles.length - 5} more"]`);
      lines.push(`  ${dirId} --> ${moreId}`);
    }
  }
  lines.push('```');
  return lines.join('\n');
}

function renderFiles(files: FileInfo[], maxFiles?: number): string {
  const shown = maxFiles !== undefined ? files.slice(0, maxFiles) : files;
  const truncated = files.length - shown.length;
  const lines: string[] = [];
  lines.push('## Files');
  lines.push('');
  lines.push('| Path | Type | Size (bytes) | Modified |');
  lines.push('|------|------|-------------:|----------|');
  for (const f of shown) {
    const mod = f.modified instanceof Date
      ? f.modified.toISOString().replace('T', ' ').slice(0, 19)
      : String(f.modified);
    lines.push(`| \`${mdEsc(f.relativePath)}\` | ${f.type} | ${f.size.toLocaleString()} | ${mod} |`);
  }
  if (truncated > 0) {
    lines.push('');
    lines.push(`_… and ${truncated} more file(s) not shown._`);
  }
  return lines.join('\n');
}

function renderRecommendations(recs: RefactoringRecommendation[]): string {
  const lines: string[] = [];
  lines.push('## Refactoring Recommendations');
  lines.push('');
  if (recs.length === 0) {
    lines.push('_No immediate refactoring recommendations._');
    return lines.join('\n');
  }
  lines.push('| Priority | Title | Summary |');
  lines.push('|----------|-------|---------|');
  for (const rec of recs) {
    lines.push(`| **${rec.priority.toUpperCase()}** | ${mdEsc(rec.title)} | ${mdEsc(rec.summary)} |`);
  }
  lines.push('');
  for (const rec of recs) {
    lines.push(`### ${mdEsc(rec.title)}`);
    lines.push('');
    lines.push(`**Priority:** ${rec.priority}  `);
    lines.push(`**Rationale:** ${mdEsc(rec.rationale)}`);
    if (rec.steps.length > 0) {
      lines.push('');
      lines.push('**Steps:**');
      for (const step of rec.steps) lines.push(`- ${mdEsc(step)}`);
    }
    if (rec.metrics.length > 0) {
      lines.push('');
      lines.push('**Metrics:** ' + rec.metrics.map(m => `\`${m}\``).join(', '));
    }
    if (rec.targetPath) {
      lines.push('');
      lines.push(`**Target:** \`${mdEsc(rec.targetPath)}\``);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderOptimizations(opts: OptimizationSuggestion[]): string {
  const lines: string[] = [];
  lines.push('## Optimization Suggestions');
  lines.push('');
  if (opts.length === 0) {
    lines.push('_No immediate optimization suggestions._');
    return lines.join('\n');
  }
  for (const opt of opts) {
    lines.push(`### ${mdEsc(opt.title)}`);
    lines.push('');
    lines.push(`**Category:** \`${opt.category}\`  **Impact:** \`${opt.impact}\``);
    lines.push('');
    lines.push(mdEsc(opt.summary));
    lines.push('');
    lines.push(`> ${mdEsc(opt.rationale)}`);
    if (opt.steps.length > 0) {
      lines.push('');
      lines.push('**Steps:**');
      for (const step of opt.steps) lines.push(`- ${mdEsc(step)}`);
    }
    if (opt.metrics.length > 0) {
      lines.push('');
      lines.push('**Metrics:** ' + opt.metrics.map(m => `\`${m}\``).join(', '));
    }
    if (opt.codeExample) {
      const lang = opt.exampleLanguage || '';
      lines.push('');
      lines.push(`\`\`\`${lang}`);
      lines.push(opt.codeExample);
      lines.push('```');
    }
    if (opt.targetPath) {
      lines.push('');
      lines.push(`**Target:** \`${mdEsc(opt.targetPath)}\``);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Formats module inspection data as a GitHub-Flavored Markdown string.
 *
 * @example
 * ```typescript
 * const formatter = new InspectionMarkdownFormatter();
 * const md = formatter.format({ module, metadata, files, recommendations });
 * // Write to a file or display in VS Code Markdown Preview.
 * ```
 */
export class InspectionMarkdownFormatter {
  /**
   * Render selected sections to a Markdown string.
   * @param input    Raw inspection data
   * @param options  Formatting options (sections, maxFiles)
   */
  format(input: MarkdownInspectionInput, options: MarkdownFormatterOptions = {}): string {
    const { sections, maxFiles } = options;
    const all = !sections || sections.length === 0;
    const has = (s: MarkdownSection): boolean => all || (sections?.includes(s) ?? false);
    const generatedAt = new Date().toISOString();
    const parts: string[] = [];

    if (has('header'))          parts.push(renderHeader(input.module, input.metadata, generatedAt));
    if (has('summary'))         parts.push(renderSummary(input.metadata, input.files));
    if (has('dependency-tree')) parts.push(renderDependencyTree(input.module, input.files));
    if (has('files'))           parts.push(renderFiles(input.files, maxFiles));
    if (has('recommendations')) parts.push(renderRecommendations(input.recommendations ?? []));
    if (has('optimizations'))   parts.push(renderOptimizations(input.optimizationSuggestions ?? []));

    return parts.join('\n\n') + '\n';
  }
}

/** Shared singleton formatter instance. */
export const inspectionMarkdownFormatter = new InspectionMarkdownFormatter();
