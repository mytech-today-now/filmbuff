/**
 * Inspection Text Formatter  (bd-modinsp.4.1)
 *
 * Formats module inspection data as human-readable plain text suitable for:
 *   - Terminal / shell output (with optional ANSI colour)
 *   - VS Code Output Channel display (colour disabled by default unless TTY)
 *
 * Features:
 *   - All report sections: header, summary, file inventory, recommendations, optimizations
 *   - ANSI colour-coded severity levels (high=red, medium=yellow, low=green)
 *   - Configurable column width with word-wrap for long descriptions
 *   - Compact / verbose modes
 *
 * Implements: bd-modinsp.4.1 (Text Formatter)
 */

import type { Module, ExtendedModuleMetadata, FileInfo } from '../module-system';
import type { RefactoringRecommendation } from '../refactoring-recommendations';
import type { OptimizationSuggestion } from '../optimization-suggestions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TextSection = 'header' | 'summary' | 'files' | 'recommendations' | 'optimizations';

/** Input accepted by the text formatter (same shape as the JSON formatter). */
export interface TextInspectionInput {
  module: Module;
  metadata: ExtendedModuleMetadata;
  files: FileInfo[];
  recommendations?: RefactoringRecommendation[];
  optimizationSuggestions?: OptimizationSuggestion[];
}

/** Options controlling the text formatter output. */
export interface TextFormatterOptions {
  /**
   * Enable ANSI colour escape sequences.
   * Defaults to `true` when `process.stdout.isTTY` is truthy, otherwise `false`.
   */
  colorize?: boolean;
  /**
   * Maximum line width for word-wrapping descriptions.  Default: 100.
   */
  width?: number;
  /**
   * Subset of sections to render.  Omit to render all.
   */
  sections?: TextSection[];
  /**
   * Maximum number of files shown in the file-inventory section.  Default: 50.
   */
  maxFiles?: number;
  /**
   * When `true`, omit per-file table and only show aggregate counts.  Default: false.
   */
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const ANSI = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
} as const;

function colorize(color: keyof typeof ANSI, text: string, enabled: boolean): string {
  return enabled ? `${ANSI[color]}${text}${ANSI.reset}` : text;
}

function bold(text: string, enabled: boolean): string {
  return enabled ? `${ANSI.bold}${text}${ANSI.reset}` : text;
}

/** Colour a severity/impact level string. */
function severityColor(level: 'high' | 'medium' | 'low', text: string, enabled: boolean): string {
  const color: keyof typeof ANSI = level === 'high' ? 'red' : level === 'medium' ? 'yellow' : 'green';
  return colorize(color, text, enabled);
}

// ---------------------------------------------------------------------------
// Word-wrap helper
// ---------------------------------------------------------------------------

function wrap(text: string, width: number, prefix = ''): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = prefix;
  for (const word of words) {
    if (current.length + word.length + 1 > width && current.trim()) {
      lines.push(current.trimEnd());
      current = prefix + word + ' ';
    } else {
      current += word + ' ';
    }
  }
  if (current.trim()) lines.push(current.trimEnd());
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderHeader(module: Module, meta: ExtendedModuleMetadata, c: boolean): string {
  const lines: string[] = [];
  lines.push(bold(`═══ ${module.fullName} ═══`, c));
  lines.push(`  ${colorize('cyan', module.metadata.displayName, c)} v${module.metadata.version}`);
  lines.push(`  ${colorize('dim' as keyof typeof ANSI, module.metadata.description, c)}`);
  lines.push(`  Type: ${module.metadata.type}  |  Path: ${module.path}`);
  if (meta.lastModified) {
    lines.push(`  Last modified: ${meta.lastModified.toISOString().slice(0, 10)}`);
  }
  return lines.join('\n');
}

function renderSummary(meta: ExtendedModuleMetadata, files: FileInfo[], c: boolean): string {
  const lines: string[] = [];
  lines.push(bold('Summary', c));
  lines.push(`  Total files    : ${meta.files?.total ?? files.length}`);
  lines.push(`  Rules          : ${meta.files?.rules ?? 0}`);
  lines.push(`  Examples       : ${meta.files?.examples ?? 0}`);
  lines.push(`  Other          : ${meta.files?.other ?? 0}`);
  lines.push(`  Total bytes    : ${(meta.size?.totalBytes ?? 0).toLocaleString()}`);
  lines.push(`  Total chars    : ${(meta.size?.totalCharacters ?? 0).toLocaleString()}`);
  return lines.join('\n');
}


function renderFiles(files: FileInfo[], opts: { maxFiles?: number; compact?: boolean; width: number; c: boolean }): string {
  const { maxFiles = 50, compact = false, width, c } = opts;
  const shown = files.slice(0, maxFiles);
  const truncated = files.length - shown.length;
  const lines: string[] = [];
  lines.push(bold('Files', c));
  if (compact) {
    const byType = shown.reduce<Record<string, number>>((acc, f) => {
      acc[f.type] = (acc[f.type] ?? 0) + 1; return acc;
    }, {});
    for (const [type, count] of Object.entries(byType)) {
      lines.push(`  ${colorize('cyan', type, c)}  ${count}`);
    }
  } else {
    const pathW = Math.min(width - 28, 60);
    for (const f of shown) {
      const relPath = f.relativePath.length > pathW ? '\u2026' + f.relativePath.slice(-(pathW - 1)) : f.relativePath;
      lines.push(`  ${relPath.padEnd(pathW)}  ${f.type.padEnd(14)}  ${f.size.toLocaleString().padStart(8)}`);
    }
    if (truncated > 0) {
      lines.push(colorize('dim' as keyof typeof ANSI, `  \u2026 and ${truncated} more file(s) not shown`, c));
    }
  }
  return lines.join('\n');
}

function renderRecommendations(recs: RefactoringRecommendation[], width: number, c: boolean): string {
  const lines: string[] = [];
  lines.push(bold('Refactoring Recommendations', c));
  if (recs.length === 0) {
    lines.push(colorize('dim' as keyof typeof ANSI, '  No recommendations.', c));
    return lines.join('\n');
  }
  for (const rec of recs) {
    lines.push('');
    const prio = severityColor(rec.priority, `[${rec.priority.toUpperCase()}]`, c);
    lines.push(`  ${prio} ${bold(rec.title, c)}`);
    lines.push(wrap(rec.summary, width, '    '));
    if (rec.steps.length > 0) {
      lines.push(colorize('dim' as keyof typeof ANSI, '    Steps:', c));
      rec.steps.forEach(step => lines.push(wrap(`      \u2022 ${step}`, width, '        ')));
    }
    if (rec.metrics.length > 0) {
      lines.push(colorize('dim' as keyof typeof ANSI, `    Metrics: ${rec.metrics.join('  |  ')}`, c));
    }
  }
  return lines.join('\n');
}

function renderOptimizations(sug: OptimizationSuggestion[], width: number, c: boolean): string {
  const lines: string[] = [];
  lines.push(bold('Optimization Suggestions', c));
  if (sug.length === 0) {
    lines.push(colorize('dim' as keyof typeof ANSI, '  No optimization suggestions.', c));
    return lines.join('\n');
  }
  for (const opt of sug) {
    lines.push('');
    const impact = severityColor(opt.impact, `[${opt.impact.toUpperCase()}]`, c);
    const cat = colorize('cyan', `[${opt.category}]`, c);
    lines.push(`  ${impact} ${cat} ${bold(opt.title, c)}`);
    lines.push(wrap(opt.summary, width, '    '));
    lines.push(wrap(`    > ${opt.rationale}`, width, '      '));
    if (opt.steps.length > 0) {
      lines.push(colorize('dim' as keyof typeof ANSI, '    Steps:', c));
      opt.steps.forEach(step => lines.push(wrap(`      \u2022 ${step}`, width, '        ')));
    }
    if (opt.codeExample) {
      const lang = opt.exampleLanguage ? ` (${opt.exampleLanguage})` : '';
      lines.push(colorize('dim' as keyof typeof ANSI, `    Example${lang}:`, c));
      opt.codeExample.split('\n').slice(0, 8).forEach(l => lines.push(`      ${l}`));
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Formats module inspection data as human-readable plain text.
 *
 * @example
 * ```typescript
 * const formatter = new InspectionTextFormatter();
 * console.log(formatter.format({ module, metadata, files, recommendations }));
 * // VS Code output channel (no ANSI)
 * const plain = formatter.format(input, { colorize: false });
 * ```
 */
export class InspectionTextFormatter {
  /**
   * Render selected sections to a plain-text string.
   * @param input    Raw inspection data
   * @param options  Formatting options (colorize, width, sections, maxFiles, compact)
   */
  format(input: TextInspectionInput, options: TextFormatterOptions = {}): string {
    const { sections, maxFiles = 50, compact = false, width = 100 } = options;
    const c = options.colorize ?? (typeof process !== 'undefined' && !!process.stdout?.isTTY);
    const all = !sections || sections.length === 0;
    const has = (s: TextSection) => all || sections!.includes(s);
    const divider = colorize('dim' as keyof typeof ANSI, '\u2500'.repeat(Math.min(width, 120)), c);
    const parts: string[] = [];

    if (has('header'))          parts.push(renderHeader(input.module, input.metadata, c));
    if (has('summary'))         { if (parts.length) parts.push(divider); parts.push(renderSummary(input.metadata, input.files, c)); }
    if (has('files'))           { if (parts.length) parts.push(divider); parts.push(renderFiles(input.files, { maxFiles, compact, width, c })); }
    if (has('recommendations')) { if (parts.length) parts.push(divider); parts.push(renderRecommendations(input.recommendations ?? [], width, c)); }
    if (has('optimizations'))   { if (parts.length) parts.push(divider); parts.push(renderOptimizations(input.optimizationSuggestions ?? [], width, c)); }

    return parts.join('\n') + '\n';
  }
}

/** Shared singleton formatter instance. */
export const inspectionTextFormatter = new InspectionTextFormatter();
