/**
 * Inspection JSON Formatter  (bd-modinsp.4.2)
 *
 * Serialises module inspection data to the canonical `InspectionResult` JSON
 * schema (v1.0).  Supports:
 *   - Pretty-printing (configurable indentation) or compact output
 *   - Section filtering (emit only the parts you need)
 *   - Streaming output via a Node.js Readable for large result sets
 *
 * Implements: bd-modinsp.4.2 (JSON Formatter)
 */

import { Readable } from 'stream';
import type { Module, ExtendedModuleMetadata, FileInfo } from '../module-system';
import type { RefactoringRecommendation } from '../refactoring-recommendations';
import type { OptimizationSuggestion } from '../optimization-suggestions';

// ---------------------------------------------------------------------------
// Schema types
// ---------------------------------------------------------------------------

/** Section keys of the JSON schema. */
export type InspectionSection = 'module' | 'metadata' | 'files' | 'recommendations' | 'optimizations';

/** The canonical JSON schema emitted by {@link InspectionJsonFormatter}. */
export interface InspectionResult {
  schema: '1.0';
  generatedAt: string;
  module: {
    name: string;
    version: string;
    displayName: string;
    description: string;
    type: string;
    path: string;
    fullName: string;
    tags: string[];
  };
  metadata: {
    totalFiles: number;
    rules: number;
    examples: number;
    other: number;
    totalBytes: number;
    totalCharacters: number;
    lastModified: string | null;
  };
  files: Array<{
    relativePath: string;
    name: string;
    type: string;
    size: number;
    modified: string;
    extension: string;
    directory: string;
  }>;
  recommendations: Array<{
    id: string;
    priority: 'high' | 'medium' | 'low';
    title: string;
    summary: string;
    rationale: string;
    steps: string[];
    metrics: string[];
    targetPath?: string;
  }>;
  optimizations: Array<{
    id: string;
    category: 'performance' | 'quality' | 'security';
    impact: 'high' | 'medium' | 'low';
    title: string;
    summary: string;
    rationale: string;
    steps: string[];
    metrics: string[];
    codeExample: string;
    exampleLanguage: string;
    targetPath?: string;
  }>;
}

/** Raw input accepted by the formatter. */
export interface InspectionInput {
  module: Module;
  metadata: ExtendedModuleMetadata;
  files: FileInfo[];
  recommendations?: RefactoringRecommendation[];
  optimizationSuggestions?: OptimizationSuggestion[];
}

/** Formatting options. */
export interface JsonFormatterOptions {
  /**
   * JSON indentation in spaces.
   * `0` produces compact (minified) output.  Default: `2`.
   */
  indent?: number;
  /**
   * Subset of sections to include.  Omit or pass `undefined` to include all.
   */
  sections?: InspectionSection[];
  /**
   * Maximum number of file entries serialised into the `files` array.
   * Surplus files are omitted.  Default: unlimited.
   */
  maxFiles?: number;
}


// ---------------------------------------------------------------------------
// Normaliser: raw input → InspectionResult schema
// ---------------------------------------------------------------------------

function normalizeInput(input: InspectionInput, sections?: InspectionSection[], maxFiles?: number): InspectionResult {
  const all = !sections || sections.length === 0;
  const has = (s: InspectionSection) => all || sections!.includes(s);
  const generatedAt = new Date().toISOString();
  const files = maxFiles !== undefined ? input.files.slice(0, maxFiles) : input.files;

  return {
    schema: '1.0',
    generatedAt,
    module: has('module') ? {
      name: input.module.metadata.name,
      version: input.module.metadata.version,
      displayName: input.module.metadata.displayName,
      description: input.module.metadata.description,
      type: input.module.metadata.type,
      path: input.module.path,
      fullName: input.module.fullName,
      tags: input.module.metadata.tags ?? [],
    } : {} as InspectionResult['module'],
    metadata: has('metadata') ? {
      totalFiles: input.metadata.files?.total ?? input.files.length,
      rules: input.metadata.files?.rules ?? 0,
      examples: input.metadata.files?.examples ?? 0,
      other: input.metadata.files?.other ?? 0,
      totalBytes: input.metadata.size?.totalBytes ?? 0,
      totalCharacters: input.metadata.size?.totalCharacters ?? 0,
      lastModified: input.metadata.lastModified?.toISOString() ?? null,
    } : {} as InspectionResult['metadata'],
    files: has('files') ? files.map(f => ({
      relativePath: f.relativePath,
      name: f.name,
      type: f.type,
      size: f.size,
      modified: f.modified instanceof Date ? f.modified.toISOString() : String(f.modified),
      extension: f.extension,
      directory: f.directory,
    })) : [],
    recommendations: has('recommendations') ? (input.recommendations ?? []).map(r => ({
      id: r.id,
      priority: r.priority,
      title: r.title,
      summary: r.summary,
      rationale: r.rationale,
      steps: r.steps,
      metrics: r.metrics,
      targetPath: r.targetPath,
    })) : [],
    optimizations: has('optimizations') ? (input.optimizationSuggestions ?? []).map(o => ({
      id: o.id,
      category: o.category,
      impact: o.impact,
      title: o.title,
      summary: o.summary,
      rationale: o.rationale,
      steps: o.steps,
      metrics: o.metrics,
      codeExample: o.codeExample,
      exampleLanguage: o.exampleLanguage,
      targetPath: o.targetPath,
    })) : [],
  };
}

// ---------------------------------------------------------------------------
// Streaming: generator yields JSON segments for backpressure-friendly output
// ---------------------------------------------------------------------------

function* jsonSegments(result: InspectionResult, indent: number): Generator<string> {
  const sp = (n: number) => indent > 0 ? ' '.repeat(n) : '';
  const nl = indent > 0 ? '\n' : '';
  const comma = ',';
  const ind = ' '.repeat(indent);

  yield `{${nl}`;
  yield `${sp(indent)}"schema":${indent ? ' ' : ''}${JSON.stringify(result.schema)}${comma}${nl}`;
  yield `${sp(indent)}"generatedAt":${indent ? ' ' : ''}${JSON.stringify(result.generatedAt)}${comma}${nl}`;
  yield `${sp(indent)}"module":${indent ? ' ' : ''}${JSON.stringify(result.module, null, indent || undefined)}${comma}${nl}`;
  yield `${sp(indent)}"metadata":${indent ? ' ' : ''}${JSON.stringify(result.metadata, null, indent || undefined)}${comma}${nl}`;

  // Stream files element-by-element for large collections
  yield `${sp(indent)}"files":${indent ? ' ' : ''}[${nl}`;
  for (let i = 0; i < result.files.length; i++) {
    const trailingComma = i < result.files.length - 1 ? comma : '';
    const entry = indent > 0
      ? JSON.stringify(result.files[i], null, ind).replace(/^/gm, sp(indent * 2)).trimStart()
      : JSON.stringify(result.files[i]);
    yield `${sp(indent * 2)}${entry}${trailingComma}${nl}`;
  }
  yield `${sp(indent)}]${comma}${nl}`;

  yield `${sp(indent)}"recommendations":${indent ? ' ' : ''}${JSON.stringify(result.recommendations, null, indent || undefined)}${comma}${nl}`;
  yield `${sp(indent)}"optimizations":${indent ? ' ' : ''}${JSON.stringify(result.optimizations, null, indent || undefined)}${nl}`;
  yield '}';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Formats module inspection data as JSON following the `InspectionResult` v1.0 schema.
 *
 * @example
 * ```typescript
 * const formatter = new InspectionJsonFormatter();
 * const json = formatter.format({ module, metadata, files, recommendations });
 * const stream = formatter.createStream({ module, metadata, files });
 * stream.pipe(process.stdout);
 * const result = formatter.normalize({ module, metadata, files });
 * ```
 */
export class InspectionJsonFormatter {
  /**
   * Serialize inspection data to a JSON string.
   * @param input    Raw inspection data
   * @param options  Formatting options (indent, sections, maxFiles)
   */
  format(input: InspectionInput, options: JsonFormatterOptions = {}): string {
    const { indent = 2, sections, maxFiles } = options;
    const result = normalizeInput(input, sections, maxFiles);
    return JSON.stringify(result, null, indent > 0 ? indent : undefined);
  }

  /**
   * Create a Node.js `Readable` stream emitting UTF-8 JSON chunks.
   * Files are streamed element-by-element for backpressure-safe large output.
   * @param input    Raw inspection data
   * @param options  Formatting options
   */
  createStream(input: InspectionInput, options: JsonFormatterOptions = {}): Readable {
    const { indent = 2, sections, maxFiles } = options;
    const result = normalizeInput(input, sections, maxFiles);
    return Readable.from(jsonSegments(result, indent), { encoding: 'utf8', objectMode: false });
  }

  /**
   * Convert raw inspection input to the normalised {@link InspectionResult} schema
   * without serialising, for programmatic post-processing.
   * @param input    Raw inspection data
   * @param options  Section / maxFiles filters
   */
  normalize(
    input: InspectionInput,
    options: Pick<JsonFormatterOptions, 'sections' | 'maxFiles'> = {},
  ): InspectionResult {
    return normalizeInput(input, options.sections, options.maxFiles);
  }
}

/** Shared singleton formatter instance. */
export const inspectionJsonFormatter = new InspectionJsonFormatter();
