/**
 * Content Inspector
 *
 * Language-aware content inspection engine for JS/TS, Python, and PHP source files.
 * Supports element-type filtering, AST caching, and consistent output formatting.
 *
 * Features:
 *  - Auto-detects file language by extension
 *  - Dispatches to the appropriate parser (JS/TS, Python, PHP)
 *  - Filters elements by kind (function, class, import, export, variable, ...)
 *  - Caches parsed results via InspectionCache (invalidated on file-mtime change)
 *  - Formats output as JSON, plain text, or Markdown
 *
 * Implements: bd-modinsp.3.1 (Content Inspector)
 */

import * as fs from 'fs';
import * as path from 'path';
import { InspectionCache } from './inspection-cache';
import { parseJsTs } from '../parsers/js-ts-parser';
import { parsePython } from '../parsers/python-parser';
import { parsePhp } from '../parsers/php-parser';

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

/** Canonical element kinds supported across all languages. */
export type ElementKind =
  | 'function'    // standalone function / def
  | 'class'       // class declaration
  | 'method'      // class / object method
  | 'import'      // import / use / require statement
  | 'export'      // export declaration (JS/TS only)
  | 'variable'    // let / var / top-level assignment
  | 'constant'    // const (JS/TS) / PHP constant
  | 'interface'   // TS interface / PHP interface
  | 'type'        // TS type alias
  | 'namespace';  // PHP namespace

/** Languages whose source files can be inspected. */
export type SupportedLanguage = 'javascript' | 'typescript' | 'python' | 'php';

/** File extensions mapped to language identifiers. */
export const LANGUAGE_EXTENSIONS: Record<string, SupportedLanguage> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  py: 'python', pyw: 'python',
  php: 'php', php7: 'php', php8: 'php',
};

/**
 * A normalized, language-agnostic representation of a source code element.
 * Parser-specific detail is preserved in the `details` property.
 */
export interface ContentElement {
  kind: ElementKind;
  name: string;
  line: number;
  language: SupportedLanguage;
  isExported?: boolean;
  isAsync?: boolean;
  isAbstract?: boolean;
  isStatic?: boolean;
  visibility?: string;
  /** Parameter names for functions / methods. */
  params?: string[];
  returnType?: string;
  /** Base class (JS/TS `extends`, Python base). */
  extends?: string;
  /** Implemented interfaces (JS/TS). */
  implements?: string[];
  /** Python class bases (full list). */
  bases?: string[];
  /** Leading JSDoc / PHPDoc / Python docstring. */
  docstring?: string;
  /** Raw parser-level detail (type-specific). */
  details?: Record<string, unknown>;
}

/** Filter to narrow which elements are returned. */
export interface ElementFilter {
  /** Element kinds to include. Omit to return all. */
  kinds?: ElementKind[];
  /** Regex pattern matched against element name (case-insensitive). */
  namePattern?: string;
  /** When true, only exported elements are returned. */
  exportedOnly?: boolean;
  /** Restrict to one language. */
  language?: SupportedLanguage;
}

/** Inspection options for a single file or a set of files. */
export interface ContentInspectionOptions {
  filter?: ElementFilter;
  /** Output format used by `ContentInspector.format()`. Default: `'text'`. */
  format?: 'json' | 'text' | 'markdown';
  /** Skip cache lookup / storage for this call. */
  noCache?: boolean;
}

/** Result from inspecting one source file. */
export interface ContentFileResult {
  filePath: string;
  language: SupportedLanguage;
  elements: ContentElement[];
  errors: string[];
  fromCache: boolean;
  inspectedAt: string;
}

/** Aggregate result from inspecting multiple files. */
export interface ContentInspectionResult {
  files: ContentFileResult[];
  summary: {
    totalFiles: number;
    totalElements: number;
    byKind: Record<string, number>;
    byLanguage: Record<string, number>;
    cacheHits: number;
    inspectedAt: string;
  };
}


// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

/** Return the language for the given file path, or `null` if unsupported. */
function detectLanguage(filePath: string): SupportedLanguage | null {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return LANGUAGE_EXTENSIONS[ext] ?? null;
}

// ---------------------------------------------------------------------------
// Parser adapters – convert parser-specific results to ContentElement[]
// ---------------------------------------------------------------------------

function elementsFromJsTs(filePath: string, content: string): { elements: ContentElement[]; errors: string[] } {
  const lang = detectLanguage(filePath) as SupportedLanguage;
  const result = parseJsTs(filePath, content);
  const elements: ContentElement[] = [];

  for (const imp of result.imports) {
    elements.push({
      kind: 'import', name: imp.module, line: imp.line, language: lang,
      details: { specifiers: imp.specifiers, defaultImport: imp.defaultImport, namespaceImport: imp.namespaceImport, isTypeOnly: imp.isTypeOnly },
    });
  }
  for (const exp of result.exports) {
    elements.push({
      kind: 'export', name: exp.name, line: exp.line, language: lang,
      isExported: true, details: { exportKind: exp.kind, isDefault: exp.isDefault, isTypeOnly: exp.isTypeOnly },
    });
  }
  for (const fn of result.functions) {
    elements.push({
      kind: 'function', name: fn.name, line: fn.line, language: lang,
      isExported: fn.isExported, isAsync: fn.isAsync,
      params: fn.params.map(p => p.isRest ? `...${p.name}` : p.name),
      returnType: fn.returnType, docstring: fn.jsDoc,
      details: { isArrow: fn.isArrow, isDefault: fn.isDefault },
    });
  }
  for (const cls of result.classes) {
    elements.push({
      kind: 'class', name: cls.name, line: cls.line, language: lang,
      isExported: cls.isExported, isAbstract: cls.isAbstract,
      extends: cls.extends, implements: cls.implements, docstring: cls.jsDoc,
    });
    for (const method of cls.methods) {
      elements.push({
        kind: 'method', name: `${cls.name}.${method.name}`, line: method.line, language: lang,
        isAsync: method.isAsync, isAbstract: method.isAbstract, isStatic: method.isStatic,
        visibility: method.visibility,
        params: method.params.map(p => p.isRest ? `...${p.name}` : p.name),
        returnType: method.returnType, docstring: method.jsDoc,
      });
    }
  }
  for (const iface of result.interfaces) {
    elements.push({
      kind: 'interface', name: iface.name, line: iface.line, language: lang,
      isExported: iface.isExported, details: { extends: iface.extends },
    });
  }
  for (const ta of result.typeAliases) {
    elements.push({ kind: 'type', name: ta.name, line: ta.line, language: lang, isExported: ta.isExported });
  }
  for (const v of result.variables) {
    elements.push({
      kind: v.kind === 'const' ? 'constant' : 'variable',
      name: v.name, line: v.line, language: lang, isExported: v.isExported,
      details: { varKind: v.kind, type: v.type },
    });
  }

  return { elements, errors: result.errors.map(e => e.line ? `L${e.line}: ${e.message}` : e.message) };
}

function elementsFromPython(filePath: string, content: string): { elements: ContentElement[]; errors: string[] } {
  const result = parsePython(filePath, content);
  const elements: ContentElement[] = [];
  const lang: SupportedLanguage = 'python';

  for (const imp of result.imports) {
    const name = imp.isFrom ? `from ${imp.module} import ${imp.isStar ? '*' : imp.names.join(', ')}` : imp.module;
    elements.push({ kind: 'import', name, line: imp.line, language: lang, details: { module: imp.module, names: imp.names, alias: imp.alias } });
  }
  for (const fn of result.functions) {
    elements.push({
      kind: 'function', name: fn.name, line: fn.line, language: lang, isAsync: fn.isAsync,
      params: fn.params.map(p => p.isKwRest ? `**${p.name}` : p.isRest ? `*${p.name}` : p.name),
      returnType: fn.returnType, docstring: fn.docstring,
      details: { decorators: fn.decorators.map(d => d.name) },
    });
  }
  for (const cls of result.classes) {
    elements.push({
      kind: 'class', name: cls.name, line: cls.line, language: lang,
      bases: cls.bases, docstring: cls.docstring,
      details: { decorators: cls.decorators.map(d => d.name) },
    });
    for (const m of cls.methods) {
      elements.push({
        kind: 'method', name: `${cls.name}.${m.name}`, line: m.line, language: lang,
        isAsync: m.isAsync, isStatic: m.isStatic, isAbstract: m.isAbstract,
        params: m.params.map(p => p.isKwRest ? `**${p.name}` : p.isRest ? `*${p.name}` : p.name),
        returnType: m.returnType, docstring: m.docstring,
        details: { isClassMethod: m.isClassMethod, isProperty: m.isProperty },
      });
    }
  }
  for (const v of result.variables) {
    const isConst = /^[A-Z_][A-Z0-9_]*$/.test(v.name);
    elements.push({ kind: isConst ? 'constant' : 'variable', name: v.name, line: v.line, language: lang, details: { annotation: v.annotation } });
  }

  return { elements, errors: result.errors.map(e => e.line ? `L${e.line}: ${e.message}` : e.message) };
}


function elementsFromPhp(filePath: string, content: string): { elements: ContentElement[]; errors: string[] } {
  const result = parsePhp(content, filePath);
  const elements: ContentElement[] = [];
  const lang: SupportedLanguage = 'php';

  // Namespace use statements → imports
  for (const use of result.uses) {
    elements.push({ kind: 'import', name: use.fqn, line: use.line, language: lang, details: { alias: use.alias } });
  }
  // Namespaces
  for (const ns of result.namespaces) {
    elements.push({ kind: 'namespace', name: ns.name, line: ns.line, language: lang });
  }
  // Top-level functions
  for (const fn of result.functions) {
    elements.push({
      kind: 'function', name: fn.name, line: fn.line, language: lang,
      isStatic: fn.isStatic, isAbstract: fn.isAbstract,
      visibility: fn.visibility,
      params: fn.params.map(p => p.variadic ? `...$${p.name}` : `$${p.name}`),
      details: { namespace: fn.namespace, isFinal: fn.isFinal },
    });
  }
  // Classes, interfaces, traits, enums
  for (const cls of result.classes) {
    const kind: ElementKind = cls.kind === 'interface' ? 'interface' : 'class';
    elements.push({
      kind, name: cls.name, line: cls.line, language: lang,
      isAbstract: cls.isAbstract, extends: cls.extends,
      implements: cls.implements,
      details: { namespace: cls.namespace, isFinal: cls.isFinal, phpKind: cls.kind },
    });
    for (const m of cls.methods) {
      elements.push({
        kind: 'method', name: `${cls.name}::${m.name}`, line: m.line, language: lang,
        isStatic: m.isStatic, isAbstract: m.isAbstract, visibility: m.visibility,
        params: m.params.map(p => p.variadic ? `...$${p.name}` : `$${p.name}`),
        details: { isFinal: m.isFinal },
      });
    }
  }
  // Constants
  for (const c of result.constants) {
    elements.push({ kind: 'constant', name: c.name, line: c.line, language: lang, details: { value: c.value, namespace: c.namespace } });
  }

  return {
    elements,
    errors: result.errors.map(e => e.line ? `L${e.line}: ${e.message}` : e.message),
  };
}

// ---------------------------------------------------------------------------
// Element filtering
// ---------------------------------------------------------------------------

function applyFilter(elements: ContentElement[], filter: ElementFilter): ContentElement[] {
  let out = elements;

  if (filter.kinds && filter.kinds.length > 0) {
    const kindSet = new Set(filter.kinds);
    out = out.filter(e => kindSet.has(e.kind));
  }
  if (filter.exportedOnly) {
    out = out.filter(e => e.isExported === true);
  }
  if (filter.language) {
    out = out.filter(e => e.language === filter.language);
  }
  if (filter.namePattern) {
    try {
      const re = new RegExp(filter.namePattern, 'i');
      out = out.filter(e => re.test(e.name));
    } catch {
      // Invalid regex – skip pattern filter
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Main ContentInspector class
// ---------------------------------------------------------------------------

/** Shared AST cache instance (5-minute TTL, max 200 files). */
const astCache = new InspectionCache<ContentElement[]>({ ttl: 5 * 60 * 1000, maxSize: 200 });

/**
 * Language-aware content inspector.
 *
 * @example
 * ```typescript
 * const inspector = new ContentInspector();
 * const result = await inspector.inspectFile('/src/app.ts', {
 *   filter: { kinds: ['function', 'class'], exportedOnly: true },
 *   format: 'markdown',
 * });
 * console.log(ContentInspector.format(result, 'markdown'));
 * ```
 */
export class ContentInspector {
  private readonly cache: InspectionCache<ContentElement[]>;

  constructor(cache?: InspectionCache<ContentElement[]>) {
    this.cache = cache ?? astCache;
  }

  /**
   * Inspect a single source file.
   *
   * Reads the file from disk, parses it (with cache), applies the filter, and
   * returns a structured {@link ContentFileResult}.
   */
  async inspectFile(filePath: string, options: ContentInspectionOptions = {}): Promise<ContentFileResult> {
    const lang = detectLanguage(filePath);
    const inspectedAt = new Date().toISOString();

    if (!lang) {
      return { filePath, language: 'javascript', elements: [], errors: [`Unsupported file type: ${path.extname(filePath)}`], fromCache: false, inspectedAt };
    }

    // Cache key is the absolute path
    const absPath = path.resolve(filePath);
    const cacheKey = `content:${absPath}`;

    let elements: ContentElement[] | null = null;
    let fromCache = false;
    const errors: string[] = [];

    if (!options.noCache) {
      elements = this.cache.get(cacheKey, absPath);
      if (elements) fromCache = true;
    }

    if (!elements) {
      let content: string;
      try {
        content = fs.readFileSync(absPath, 'utf-8');
      } catch (e) {
        return { filePath, language: lang, elements: [], errors: [`Read error: ${e}`], fromCache: false, inspectedAt };
      }

      let parsed: { elements: ContentElement[]; errors: string[] };
      try {
        if (lang === 'javascript' || lang === 'typescript') {
          parsed = elementsFromJsTs(absPath, content);
        } else if (lang === 'python') {
          parsed = elementsFromPython(absPath, content);
        } else {
          parsed = elementsFromPhp(absPath, content);
        }
      } catch (e) {
        return { filePath, language: lang, elements: [], errors: [`Parse error: ${e}`], fromCache: false, inspectedAt };
      }

      elements = parsed.elements;
      errors.push(...parsed.errors);
      if (!options.noCache) this.cache.set(cacheKey, elements, absPath);
    }

    const filtered = options.filter ? applyFilter(elements, options.filter) : elements;
    return { filePath, language: lang, elements: filtered, errors, fromCache, inspectedAt };
  }


  /**
   * Inspect multiple source files concurrently.
   *
   * @param filePaths  Array of file paths to inspect
   * @param options    Shared inspection options applied to every file
   */
  async inspectFiles(filePaths: string[], options: ContentInspectionOptions = {}): Promise<ContentInspectionResult> {
    const files = await Promise.all(filePaths.map(fp => this.inspectFile(fp, options)));
    return this.buildResult(files);
  }

  /**
   * Inspect all supported source files within a directory (recursive).
   *
   * Only files with extensions in {@link LANGUAGE_EXTENSIONS} are processed.
   * Files in `node_modules`, `.git`, `dist`, and `build` directories are skipped.
   *
   * @param dirPath   Root directory to scan
   * @param options   Shared inspection options
   * @param maxFiles  Safety limit on number of files (default: 500)
   */
  async inspectDirectory(
    dirPath: string,
    options: ContentInspectionOptions = {},
    maxFiles = 500,
  ): Promise<ContentInspectionResult> {
    const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.tox', 'venv', '.venv']);
    const filePaths: string[] = [];

    const walk = (dir: string): void => {
      if (filePaths.length >= maxFiles) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (filePaths.length >= maxFiles) break;
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
        } else if (entry.isFile()) {
          if (detectLanguage(entry.name)) filePaths.push(path.join(dir, entry.name));
        }
      }
    };

    walk(path.resolve(dirPath));
    const files = await Promise.all(filePaths.map(fp => this.inspectFile(fp, options)));
    return this.buildResult(files);
  }

  /** Clear the underlying AST cache. */
  clearCache(): void { this.cache.clear(); }

  /** Return cache statistics. */
  cacheStats() { return this.cache.getStats(); }

  // ---------------------------------------------------------------------------
  // Formatting (static)
  // ---------------------------------------------------------------------------

  /**
   * Format a {@link ContentInspectionResult} as JSON, plain text, or Markdown.
   *
   * @param result  The inspection result to format
   * @param format  Target format ('json' | 'text' | 'markdown'). Default: 'text'
   */
  static format(result: ContentInspectionResult, format: 'json' | 'text' | 'markdown' = 'text'): string {
    if (format === 'json') return JSON.stringify(result, null, 2);
    if (format === 'markdown') return ContentInspector.formatMarkdown(result);
    return ContentInspector.formatText(result);
  }

  /** Format a single file result. */
  static formatFile(fileResult: ContentFileResult, format: 'json' | 'text' | 'markdown' = 'text'): string {
    if (format === 'json') return JSON.stringify(fileResult, null, 2);
    const multi: ContentInspectionResult = {
      files: [fileResult],
      summary: {
        totalFiles: 1, totalElements: fileResult.elements.length,
        byKind: fileResult.elements.reduce((a, e) => { a[e.kind] = (a[e.kind] || 0) + 1; return a; }, {} as Record<string, number>),
        byLanguage: { [fileResult.language]: fileResult.elements.length },
        cacheHits: fileResult.fromCache ? 1 : 0,
        inspectedAt: fileResult.inspectedAt,
      },
    };
    return ContentInspector.format(multi, format);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildResult(files: ContentFileResult[]): ContentInspectionResult {
    const byKind: Record<string, number> = {};
    const byLanguage: Record<string, number> = {};
    let totalElements = 0;
    let cacheHits = 0;

    for (const f of files) {
      totalElements += f.elements.length;
      if (f.fromCache) cacheHits++;
      byLanguage[f.language] = (byLanguage[f.language] || 0) + f.elements.length;
      for (const e of f.elements) { byKind[e.kind] = (byKind[e.kind] || 0) + 1; }
    }

    return {
      files,
      summary: {
        totalFiles: files.length, totalElements,
        byKind, byLanguage, cacheHits,
        inspectedAt: new Date().toISOString(),
      },
    };
  }


  private static formatText(result: ContentInspectionResult): string {
    const lines: string[] = [];
    const s = result.summary;
    lines.push(`Inspection Summary`);
    lines.push(`  Files:    ${s.totalFiles}`);
    lines.push(`  Elements: ${s.totalElements}`);
    lines.push(`  By kind:  ${Object.entries(s.byKind).map(([k, v]) => `${k}(${v})`).join(', ')}`);
    lines.push(`  By lang:  ${Object.entries(s.byLanguage).map(([l, v]) => `${l}(${v})`).join(', ')}`);
    lines.push(`  Cache:    ${s.cacheHits}/${s.totalFiles} hits`);
    lines.push('');

    for (const file of result.files) {
      lines.push(`━━ ${file.filePath} [${file.language}]${file.fromCache ? ' (cached)' : ''}`);
      if (file.errors.length) lines.push(`   Errors: ${file.errors.join('; ')}`);

      // Group by kind
      const byKind = new Map<string, ContentElement[]>();
      for (const el of file.elements) {
        if (!byKind.has(el.kind)) byKind.set(el.kind, []);
        byKind.get(el.kind)!.push(el);
      }
      for (const [kind, els] of byKind) {
        lines.push(`  ${kind.toUpperCase()}S (${els.length})`);
        for (const el of els) {
          const flags = [
            el.isExported ? 'export' : '',
            el.isAsync ? 'async' : '',
            el.isAbstract ? 'abstract' : '',
            el.isStatic ? 'static' : '',
            el.visibility ?? '',
          ].filter(Boolean).join(' ');
          const params = el.params ? `(${el.params.join(', ')})` : '';
          const ret = el.returnType ? `: ${el.returnType}` : '';
          lines.push(`    L${el.line} ${flags ? `[${flags}] ` : ''}${el.name}${params}${ret}`);
        }
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  private static formatMarkdown(result: ContentInspectionResult): string {
    const lines: string[] = [];
    const s = result.summary;
    lines.push(`# Content Inspection Report`);
    lines.push('');
    lines.push(`## Summary`);
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Files inspected | ${s.totalFiles} |`);
    lines.push(`| Total elements | ${s.totalElements} |`);
    lines.push(`| Cache hits | ${s.cacheHits} / ${s.totalFiles} |`);
    lines.push(`| Inspected at | ${s.inspectedAt} |`);
    lines.push('');
    if (Object.keys(s.byKind).length > 0) {
      lines.push(`### Elements by Kind`);
      lines.push('');
      lines.push(`| Kind | Count |`);
      lines.push(`|------|-------|`);
      for (const [kind, count] of Object.entries(s.byKind).sort((a, b) => b[1] - a[1])) {
        lines.push(`| ${kind} | ${count} |`);
      }
      lines.push('');
    }

    for (const file of result.files) {
      lines.push(`## \`${file.filePath}\``);
      lines.push('');
      lines.push(`**Language:** ${file.language}  `);
      if (file.fromCache) lines.push(`*Served from cache*  `);
      if (file.errors.length) {
        lines.push('');
        lines.push(`> ⚠️ Parse errors: ${file.errors.join('; ')}`);
      }
      lines.push('');

      if (file.elements.length === 0) { lines.push('_No elements found._'); lines.push(''); continue; }

      // Group by kind
      const byKind = new Map<string, ContentElement[]>();
      for (const el of file.elements) {
        if (!byKind.has(el.kind)) byKind.set(el.kind, []);
        byKind.get(el.kind)!.push(el);
      }

      for (const [kind, els] of byKind) {
        lines.push(`### ${kind.charAt(0).toUpperCase() + kind.slice(1)}s (${els.length})`);
        lines.push('');
        lines.push(`| Name | Line | Flags | Params | Return |`);
        lines.push(`|------|------|-------|--------|--------|`);
        for (const el of els) {
          const flags = [
            el.isExported ? '`export`' : '',
            el.isAsync ? '`async`' : '',
            el.isAbstract ? '`abstract`' : '',
            el.isStatic ? '`static`' : '',
            el.visibility ? `\`${el.visibility}\`` : '',
          ].filter(Boolean).join(' ');
          const params = el.params ? el.params.join(', ') : '';
          const ret = el.returnType ?? '';
          lines.push(`| \`${el.name}\` | ${el.line} | ${flags || '–'} | ${params || '–'} | ${ret || '–'} |`);
        }
        lines.push('');
      }
    }
    return lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Convenience singleton export
// ---------------------------------------------------------------------------

/** Shared {@link ContentInspector} instance with default cache settings. */
export const contentInspector = new ContentInspector();
