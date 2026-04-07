/**
 * Dependency Analyzer
 *
 * Language-aware dependency extraction and graph builder for JS/TS, Python, and PHP.
 *
 * Features:
 *  - Extracts imports via existing language parsers (no re-parsing overhead)
 *  - Reads package manifests (package.json, requirements.txt, composer.json)
 *    to resolve declared version constraints
 *  - Classifies every import as: internal | stdlib | third-party | url | unknown
 *  - Classifies dependency kind:  npm | pip | composer | stdlib | internal | url
 *  - Validates external URL imports for syntactic correctness
 *  - Builds a flat dependency graph and a hierarchical dependency tree
 *  - Formats output as JSON, plain text, or Markdown
 *
 * Implements: bd-modinsp.3.2 (Dependency Analyzer)
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseJsTs } from '../parsers/js-ts-parser';
import { parsePython } from '../parsers/python-parser';
import { parsePhp } from '../parsers/php-parser';
import { LANGUAGE_EXTENSIONS, SupportedLanguage } from './content-inspector';

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

/** Role of a dependency within its manifest. */
export type DependencyType =
  | 'production'   // listed in dependencies / install_requires
  | 'dev'          // devDependencies / dev-packages
  | 'peer'         // peerDependencies (npm)
  | 'optional'     // optionalDependencies / extras_require
  | 'internal'     // relative import (./foo, ../bar)
  | 'unknown';     // not found in manifest

/** Package-system the dependency belongs to. */
export type DependencyKind =
  | 'npm'       // Node.js package from npm
  | 'pip'       // Python package from PyPI
  | 'composer'  // PHP package from Packagist
  | 'stdlib'    // language standard library
  | 'internal'  // project-internal (relative) import
  | 'url'       // HTTP/HTTPS URL import (Deno-style or esm.sh)
  | 'unknown';

/** A parsed import statement from a source file. */
export interface ParsedImport {
  /** Raw module specifier as it appears in source: `'./utils'`, `'react'`, `'https://...'` */
  source: string;
  type: DependencyType;
  kind: DependencyKind;
  /** Declared version constraint from the manifest, e.g. `^18.0.0` */
  declaredVersion?: string;
  /** Whether the import source is a syntactically valid URL (only when kind === 'url') */
  isValidUrl?: boolean;
  line: number;
}

/** Dependency metadata aggregated across all files that import it. */
export interface DependencyNode {
  /** Canonical package / module name */
  name: string;
  type: DependencyType;
  kind: DependencyKind;
  /** Declared version from manifest */
  declaredVersion?: string;
  /** Files that import this dependency */
  importedBy: string[];
  /** Validation issues (e.g. invalid URL, unresolved package) */
  issues: string[];
}

/** Per-file import record */
export interface FileDependencies {
  filePath: string;
  language: SupportedLanguage;
  imports: ParsedImport[];
}

/** Manifest contents extracted from package.json / requirements.txt / composer.json */
export interface DependencyManifest {
  type: 'npm' | 'pip' | 'composer' | 'none';
  production: Record<string, string>;
  dev: Record<string, string>;
  peer: Record<string, string>;
  optional: Record<string, string>;
}

/** Full dependency graph */
export interface DependencyGraph {
  /** Per-file import lists */
  files: FileDependencies[];
  /** Deduplicated package map (keyed by canonical name) */
  packages: Map<string, DependencyNode>;
  manifest: DependencyManifest;
  summary: DependencyGraphSummary;
}

/** Summary statistics for the dependency graph */
export interface DependencyGraphSummary {
  totalFiles: number;
  totalImports: number;
  uniquePackages: number;
  byType: Record<string, number>;
  byKind: Record<string, number>;
  unresolvedPackages: string[];
  invalidUrls: string[];
  analyzedAt: string;
}

/** Options for dependency analysis */
export interface DependencyAnalysisOptions {
  /** Project root for manifest lookup. Defaults to cwd. */
  projectRoot?: string;
  /** Skip URL syntax validation. Default: false */
  skipUrlValidation?: boolean;
  /** Include devDependency entries in graph. Default: true */
  includeDevDeps?: boolean;
}

// ---------------------------------------------------------------------------
// Standard library module sets
// ---------------------------------------------------------------------------

/** Node.js built-in module names (Node 20 LTS). Prefix `node:` variants also matched. */
const NODE_STDLIB = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http',
  'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process',
  'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys',
  'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi',
  'worker_threads', 'zlib',
]);

/** Python 3 standard library top-level module names. */
const PYTHON_STDLIB = new Set([
  '__future__', 'abc', 'ast', 'asyncio', 'atexit', 'base64', 'bdb', 'binascii',
  'builtins', 'cgi', 'cmath', 'cmd', 'code', 'codecs', 'codeop', 'colorsys',
  'collections', 'compileall', 'concurrent', 'configparser', 'contextlib', 'contextvars',
  'copy', 'copyreg', 'csv', 'ctypes', 'curses', 'dataclasses', 'datetime', 'dbm',
  'decimal', 'difflib', 'dis', 'doctest', 'email', 'encodings', 'enum', 'errno',
  'faulthandler', 'fcntl', 'filecmp', 'fileinput', 'fnmatch', 'fractions', 'ftplib',
  'functools', 'gc', 'getopt', 'getpass', 'gettext', 'glob', 'grp', 'gzip', 'hashlib',
  'heapq', 'hmac', 'html', 'http', 'idlelib', 'imaplib', 'importlib', 'inspect',
  'io', 'ipaddress', 'itertools', 'json', 'keyword', 'lib2to3', 'linecache', 'locale',
  'logging', 'lzma', 'mailbox', 'math', 'mimetypes', 'mmap', 'modulefinder',
  'multiprocessing', 'netrc', 'nis', 'nntplib', 'numbers', 'operator', 'optparse',
  'os', 'ossaudiodev', 'pathlib', 'pdb', 'pickle', 'pickletools', 'pipes', 'pkgutil',
  'platform', 'plistlib', 'poplib', 'posix', 'posixpath', 'pprint', 'profile',
  'pstats', 'pty', 'pwd', 'py_compile', 'pyclbr', 'pydoc', 'queue', 'quopri',
  'random', 're', 'readline', 'reprlib', 'resource', 'rlcompleter', 'runpy', 'sched',
  'secrets', 'select', 'selectors', 'shelve', 'shlex', 'shutil', 'signal', 'site',
  'smtpd', 'smtplib', 'sndhdr', 'socket', 'socketserver', 'spwd', 'sqlite3', 'ssl',
  'stat', 'statistics', 'string', 'stringprep', 'struct', 'subprocess', 'sunau', 'sys',
  'sysconfig', 'syslog', 'tabnanny', 'tarfile', 'telnetlib', 'tempfile', 'termios',
  'test', 'textwrap', 'threading', 'time', 'timeit', 'tkinter', 'token', 'tokenize',
  'tomllib', 'trace', 'traceback', 'tracemalloc', 'tty', 'turtle', 'turtledemo',
  'types', 'typing', 'unicodedata', 'unittest', 'urllib', 'uu', 'uuid', 'venv',
  'warnings', 'wave', 'weakref', 'webbrowser', 'wsgiref', 'xdrlib', 'xml', 'xmlrpc',
  'zipapp', 'zipfile', 'zipimport', 'zlib', 'zoneinfo',
]);

/** PHP core namespace prefixes that belong to the language runtime. */
const PHP_CORE_NAMESPACES = new Set([
  'ArrayObject', 'BadFunctionCallException', 'BadMethodCallException', 'Closure',
  'DateTime', 'DateTimeImmutable', 'DateTimeInterface', 'DateInterval', 'DatePeriod',
  'Directory', 'DomainException', 'Exception', 'Generator', 'InvalidArgumentException',
  'Iterator', 'IteratorAggregate', 'JsonSerializable', 'LengthException', 'LogicException',
  'OutOfBoundsException', 'OutOfRangeException', 'OverflowException', 'RangeException',
  'RuntimeException', 'Serializable', 'SplFixedArray', 'SplStack', 'SplQueue',
  'SplMinHeap', 'SplMaxHeap', 'SplPriorityQueue', 'SplDoublyLinkedList',
  'Stringable', 'Throwable', 'TypeError', 'UnderflowException', 'UnexpectedValueException',
  'WeakMap', 'WeakReference',
]);

// ---------------------------------------------------------------------------
// Import classification helpers
// ---------------------------------------------------------------------------

function isUrl(source: string): boolean {
  return source.startsWith('http://') || source.startsWith('https://');
}

function isValidUrl(source: string): boolean {
  try { new URL(source); return true; } catch { return false; }
}

function isRelative(source: string): boolean {
  return source.startsWith('./') || source.startsWith('../') || source === '.' || source === '..';
}

function isNodeStdlib(source: string): boolean {
  const bare = source.startsWith('node:') ? source.slice(5) : source;
  return NODE_STDLIB.has(bare.split('/')[0]);
}

function isPythonStdlib(source: string): boolean {
  return PYTHON_STDLIB.has(source.split('.')[0]);
}

function isPhpCore(fqn: string): boolean {
  const last = fqn.split('\\').pop() ?? fqn;
  return PHP_CORE_NAMESPACES.has(last);
}

/** Classify a JS/TS import source string. */
function classifyJsTs(source: string): { type: DependencyType; kind: DependencyKind } {
  if (isRelative(source)) return { type: 'internal', kind: 'internal' };
  if (isUrl(source)) return { type: 'unknown', kind: 'url' };
  if (isNodeStdlib(source)) return { type: 'production', kind: 'stdlib' };
  return { type: 'unknown', kind: 'npm' };
}

/** Classify a Python import module string. */
function classifyPython(module: string): { type: DependencyType; kind: DependencyKind } {
  if (module.startsWith('.')) return { type: 'internal', kind: 'internal' };
  if (isPythonStdlib(module)) return { type: 'production', kind: 'stdlib' };
  return { type: 'unknown', kind: 'pip' };
}

/** Classify a PHP use-statement FQN. */
function classifyPhp(fqn: string): { type: DependencyType; kind: DependencyKind } {
  if (isPhpCore(fqn)) return { type: 'production', kind: 'stdlib' };
  return { type: 'unknown', kind: 'composer' };
}


// ---------------------------------------------------------------------------
// Manifest readers
// ---------------------------------------------------------------------------

const EMPTY_MANIFEST: DependencyManifest = {
  type: 'none', production: {}, dev: {}, peer: {}, optional: {},
};

/** Try to read and parse package.json from projectRoot. */
function readNpmManifest(projectRoot: string): DependencyManifest | null {
  const pkgPath = path.join(projectRoot, 'package.json');
  try {
    const raw = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return {
      type: 'npm',
      production: raw.dependencies ?? {},
      dev: raw.devDependencies ?? {},
      peer: raw.peerDependencies ?? {},
      optional: raw.optionalDependencies ?? {},
    };
  } catch { return null; }
}

/** Try to read requirements.txt from projectRoot. Returns null if missing. */
function readPipManifest(projectRoot: string): DependencyManifest | null {
  const reqPath = path.join(projectRoot, 'requirements.txt');
  try {
    const lines = fs.readFileSync(reqPath, 'utf-8').split('\n');
    const production: Record<string, string> = {};
    for (const raw of lines) {
      const line = raw.split('#')[0].trim();
      if (!line) continue;
      // package==1.0.0 | package>=1.0.0 | package~=1.0.0 | package[extra]>=1.0.0
      const m = line.match(/^([\w.-]+)(?:\[[^\]]*\])?([><=!~]{1,3}.*)?$/);
      if (m) production[m[1].toLowerCase()] = m[2]?.trim() ?? '*';
    }
    return { type: 'pip', production, dev: {}, peer: {}, optional: {} };
  } catch { return null; }
}

/** Try to read composer.json from projectRoot. */
function readComposerManifest(projectRoot: string): DependencyManifest | null {
  const cPath = path.join(projectRoot, 'composer.json');
  try {
    const raw = JSON.parse(fs.readFileSync(cPath, 'utf-8'));
    return {
      type: 'composer',
      production: raw.require ?? {},
      dev: raw['require-dev'] ?? {},
      peer: {},
      optional: {},
    };
  } catch { return null; }
}

/**
 * Auto-detect and read the best available manifest from projectRoot.
 * Priority: package.json > requirements.txt > composer.json
 */
function readManifest(projectRoot: string): DependencyManifest {
  return (
    readNpmManifest(projectRoot) ??
    readPipManifest(projectRoot) ??
    readComposerManifest(projectRoot) ??
    EMPTY_MANIFEST
  );
}

/**
 * Resolve the declared version for a package from the manifest.
 * Returns `undefined` if not found.
 */
function resolveVersion(
  name: string,
  manifest: DependencyManifest,
): { version: string; type: DependencyType } | undefined {
  const check = (map: Record<string, string>, t: DependencyType) => {
    if (Object.prototype.hasOwnProperty.call(map, name)) return { version: map[name], type: t };
    // pip keys are lowercase
    const lower = name.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(map, lower)) return { version: map[lower], type: t };
    return undefined;
  };
  return (
    check(manifest.production, 'production') ??
    check(manifest.dev, 'dev') ??
    check(manifest.peer, 'peer') ??
    check(manifest.optional, 'optional')
  );
}

// ---------------------------------------------------------------------------
// Parser adapters – extract ParsedImport[] from each language
// ---------------------------------------------------------------------------

function importsFromJsTs(filePath: string, content: string, manifest: DependencyManifest, opts: DependencyAnalysisOptions): ParsedImport[] {
  const result = parseJsTs(filePath, content);
  return result.imports.map(imp => {
    const { type, kind } = classifyJsTs(imp.module);
    const resolved = kind === 'npm' ? resolveVersion(imp.module.split('/')[0].replace(/^@[^/]+\/[^/]+/, m => m), manifest) : undefined;
    const isValidUrlVal = kind === 'url' && !opts.skipUrlValidation ? isValidUrl(imp.module) : undefined;
    return {
      source: imp.module, line: imp.line,
      type: resolved?.type ?? type,
      kind,
      declaredVersion: resolved?.version,
      isValidUrl: isValidUrlVal,
    };
  });
}

function importsFromPython(filePath: string, content: string, manifest: DependencyManifest): ParsedImport[] {
  const result = parsePython(filePath, content);
  return result.imports.map(imp => {
    const { type, kind } = classifyPython(imp.module);
    const resolved = kind === 'pip' ? resolveVersion(imp.module.split('.')[0].toLowerCase(), manifest) : undefined;
    return {
      source: imp.module, line: imp.line,
      type: resolved?.type ?? type,
      kind,
      declaredVersion: resolved?.version,
    };
  });
}

function importsFromPhp(filePath: string, content: string, manifest: DependencyManifest): ParsedImport[] {
  const result = parsePhp(content, filePath);
  return result.uses.map(use => {
    const { type, kind } = classifyPhp(use.fqn);
    // Composer packages: top-level namespace often matches vendor/package pattern
    const vendor = use.fqn.includes('\\') ? use.fqn.split('\\').slice(0, 2).join('/').toLowerCase() : undefined;
    const resolved = kind === 'composer' && vendor ? resolveVersion(vendor, manifest) : undefined;
    return {
      source: use.fqn, line: use.line,
      type: resolved?.type ?? type,
      kind,
      declaredVersion: resolved?.version,
    };
  });
}

/** Parse imports from a single source file, auto-detecting language. */
function extractImports(filePath: string, content: string, lang: SupportedLanguage, manifest: DependencyManifest, opts: DependencyAnalysisOptions): ParsedImport[] {
  try {
    if (lang === 'javascript' || lang === 'typescript') return importsFromJsTs(filePath, content, manifest, opts);
    if (lang === 'python') return importsFromPython(filePath, content, manifest);
    return importsFromPhp(filePath, content, manifest);
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Graph builder
// ---------------------------------------------------------------------------

function buildGraph(fileDeps: FileDependencies[], manifest: DependencyManifest): DependencyGraph {
  const packages = new Map<string, DependencyNode>();
  const byType: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  let totalImports = 0;

  for (const fd of fileDeps) {
    for (const imp of fd.imports) {
      totalImports++;
      byType[imp.type] = (byType[imp.type] ?? 0) + 1;
      byKind[imp.kind] = (byKind[imp.kind] ?? 0) + 1;

      if (imp.kind === 'internal') continue; // Don't add relative imports to package map

      const key = imp.source;
      if (!packages.has(key)) {
        const issues: string[] = [];
        if (imp.kind === 'url' && imp.isValidUrl === false) {
          issues.push(`Invalid URL: ${imp.source}`);
        }
        if ((imp.kind === 'npm' || imp.kind === 'pip' || imp.kind === 'composer') && !imp.declaredVersion) {
          issues.push(`Package not found in manifest: ${imp.source}`);
        }
        packages.set(key, {
          name: imp.source,
          type: imp.type,
          kind: imp.kind,
          declaredVersion: imp.declaredVersion,
          importedBy: [fd.filePath],
          issues,
        });
      } else {
        const node = packages.get(key)!;
        if (!node.importedBy.includes(fd.filePath)) node.importedBy.push(fd.filePath);
      }
    }
  }

  const unresolvedPackages = [...packages.values()]
    .filter(n => n.issues.some(i => i.startsWith('Package not found')))
    .map(n => n.name);
  const invalidUrls = [...packages.values()]
    .filter(n => n.issues.some(i => i.startsWith('Invalid URL')))
    .map(n => n.name);

  return {
    files: fileDeps,
    packages,
    manifest,
    summary: {
      totalFiles: fileDeps.length,
      totalImports,
      uniquePackages: packages.size,
      byType,
      byKind,
      unresolvedPackages,
      invalidUrls,
      analyzedAt: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatGraphText(graph: DependencyGraph): string {
  const lines: string[] = [];
  const s = graph.summary;
  lines.push('Dependency Analysis Summary');
  lines.push(`  Manifest: ${graph.manifest.type}`);
  lines.push(`  Files:    ${s.totalFiles}`);
  lines.push(`  Imports:  ${s.totalImports}`);
  lines.push(`  Packages: ${s.uniquePackages}`);
  lines.push(`  By type:  ${Object.entries(s.byType).map(([k, v]) => `${k}(${v})`).join(', ')}`);
  lines.push(`  By kind:  ${Object.entries(s.byKind).map(([k, v]) => `${k}(${v})`).join(', ')}`);
  if (s.unresolvedPackages.length) lines.push(`  Unresolved: ${s.unresolvedPackages.join(', ')}`);
  if (s.invalidUrls.length) lines.push(`  Invalid URLs: ${s.invalidUrls.join(', ')}`);
  lines.push('');

  for (const fd of graph.files) {
    if (!fd.imports.length) continue;
    lines.push(`━━ ${fd.filePath} [${fd.language}]`);
    for (const imp of fd.imports) {
      const ver = imp.declaredVersion ? ` @${imp.declaredVersion}` : '';
      const urlWarn = imp.isValidUrl === false ? ' ⚠ invalid URL' : '';
      lines.push(`   [${imp.kind}/${imp.type}] L${imp.line}  ${imp.source}${ver}${urlWarn}`);
    }
    lines.push('');
  }

  // Package summary
  lines.push('Package Index');
  for (const [name, node] of [...graph.packages.entries()].sort()) {
    const ver = node.declaredVersion ? ` @${node.declaredVersion}` : '';
    const warn = node.issues.length ? ` ⚠ ${node.issues.join('; ')}` : '';
    lines.push(`  [${node.kind}] ${name}${ver}  (imported by ${node.importedBy.length} file(s))${warn}`);
  }
  return lines.join('\n');
}

function formatGraphMarkdown(graph: DependencyGraph): string {
  const lines: string[] = [];
  const s = graph.summary;
  lines.push('# Dependency Analysis Report');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Manifest type | ${graph.manifest.type} |`);
  lines.push(`| Files analysed | ${s.totalFiles} |`);
  lines.push(`| Total imports | ${s.totalImports} |`);
  lines.push(`| Unique packages | ${s.uniquePackages} |`);
  lines.push(`| Analysed at | ${s.analyzedAt} |`);
  lines.push('');

  if (s.unresolvedPackages.length) {
    lines.push(`> ⚠️ **Unresolved packages** (not in manifest): ${s.unresolvedPackages.map(p => `\`${p}\``).join(', ')}`);
    lines.push('');
  }
  if (s.invalidUrls.length) {
    lines.push(`> ⚠️ **Invalid URLs**: ${s.invalidUrls.map(u => `\`${u}\``).join(', ')}`);
    lines.push('');
  }

  lines.push('## Package Index');
  lines.push('');
  lines.push('| Package | Kind | Type | Version | Imported by | Issues |');
  lines.push('|---------|------|------|---------|-------------|--------|');
  for (const [name, node] of [...graph.packages.entries()].sort()) {
    const issues = node.issues.length ? node.issues.join('; ') : '–';
    lines.push(`| \`${name}\` | ${node.kind} | ${node.type} | ${node.declaredVersion ?? '–'} | ${node.importedBy.length} | ${issues} |`);
  }
  lines.push('');

  lines.push('## File Import Details');
  lines.push('');
  for (const fd of graph.files) {
    if (!fd.imports.length) continue;
    lines.push(`### \`${fd.filePath}\` [${fd.language}]`);
    lines.push('');
    lines.push('| Line | Module | Kind | Type | Version |');
    lines.push('|------|--------|------|------|---------|');
    for (const imp of fd.imports) {
      const urlFlag = imp.isValidUrl === false ? ' ⚠' : '';
      lines.push(`| ${imp.line} | \`${imp.source}${urlFlag}\` | ${imp.kind} | ${imp.type} | ${imp.declaredVersion ?? '–'} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main DependencyAnalyzer class
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.tox', 'venv', '.venv', '.mypy_cache']);

/**
 * Language-aware dependency analyzer.
 *
 * @example
 * ```typescript
 * const analyzer = new DependencyAnalyzer();
 * const graph = await analyzer.analyzeDirectory('/my/project');
 * console.log(DependencyAnalyzer.format(graph, 'markdown'));
 * ```
 */
export class DependencyAnalyzer {

  /**
   * Analyze dependencies in one source file.
   *
   * @param filePath      Absolute path to the source file
   * @param options       Analysis options
   */
  async analyzeFile(filePath: string, options: DependencyAnalysisOptions = {}): Promise<DependencyGraph> {
    const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
    const manifest = readManifest(projectRoot);
    const lang = LANGUAGE_EXTENSIONS[filePath.split('.').pop()?.toLowerCase() ?? ''];
    if (!lang) {
      return buildGraph([], manifest);
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const imports = extractImports(filePath, content, lang, manifest, options);
    const fileDep: FileDependencies = { filePath, language: lang, imports };
    return buildGraph([fileDep], manifest);
  }

  /**
   * Analyze dependencies across multiple source files.
   *
   * @param filePaths   Array of absolute file paths
   * @param options     Shared analysis options
   */
  async analyzeFiles(filePaths: string[], options: DependencyAnalysisOptions = {}): Promise<DependencyGraph> {
    const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
    const manifest = readManifest(projectRoot);

    const fileDeps: FileDependencies[] = [];
    for (const fp of filePaths) {
      const lang = LANGUAGE_EXTENSIONS[fp.split('.').pop()?.toLowerCase() ?? ''];
      if (!lang) continue;
      try {
        const content = fs.readFileSync(fp, 'utf-8');
        const imports = extractImports(fp, content, lang, manifest, options);
        fileDeps.push({ filePath: fp, language: lang, imports });
      } catch { /* skip unreadable files */ }
    }
    return buildGraph(fileDeps, manifest);
  }

  /**
   * Recursively analyze all supported source files within a directory.
   *
   * @param dirPath     Root directory to scan
   * @param options     Analysis options
   * @param maxFiles    Safety limit (default: 500)
   */
  async analyzeDirectory(dirPath: string, options: DependencyAnalysisOptions = {}, maxFiles = 500): Promise<DependencyGraph> {
    const projectRoot = path.resolve(options.projectRoot ?? dirPath);
    const manifest = readManifest(projectRoot);
    const filePaths: string[] = [];

    const walk = (dir: string) => {
      if (filePaths.length >= maxFiles) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (filePaths.length >= maxFiles) break;
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
        } else if (entry.isFile()) {
          const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
          if (LANGUAGE_EXTENSIONS[ext]) filePaths.push(path.join(dir, entry.name));
        }
      }
    };
    walk(path.resolve(dirPath));

    const fileDeps: FileDependencies[] = [];
    for (const fp of filePaths) {
      const lang = LANGUAGE_EXTENSIONS[fp.split('.').pop()?.toLowerCase() ?? ''];
      if (!lang) continue;
      try {
        const content = fs.readFileSync(fp, 'utf-8');
        const imports = extractImports(fp, content, lang, manifest, options);
        fileDeps.push({ filePath: fp, language: lang, imports });
      } catch { /* skip unreadable */ }
    }
    return buildGraph(fileDeps, manifest);
  }

  /**
   * Format a {@link DependencyGraph} as JSON, plain text, or Markdown.
   *
   * @param graph   The dependency graph to format
   * @param format  Target format (default: `'text'`)
   */
  static format(graph: DependencyGraph, format: 'json' | 'text' | 'markdown' = 'text'): string {
    if (format === 'json') {
      // Map cannot be serialized directly – convert to array
      const out = { ...graph, packages: [...graph.packages.entries()].map(([k, v]) => ({ key: k, ...v })) };
      return JSON.stringify(out, null, 2);
    }
    if (format === 'markdown') return formatGraphMarkdown(graph);
    return formatGraphText(graph);
  }
}

/** Shared singleton analyzer instance. */
export const dependencyAnalyzer = new DependencyAnalyzer();
