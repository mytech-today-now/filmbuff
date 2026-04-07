/**
 * JavaScript / TypeScript Parser
 *
 * Pure-TypeScript, regex-based parser for JS/TS source files (ES6+, TypeScript 4+).
 * Extracts: imports, exports, functions, classes, interfaces, type aliases, variables.
 * No external AST dependencies – works in any Node.js environment.
 *
 * Implements: bd-modinsp.2.1 (JavaScript/TypeScript Parser)
 */

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

export interface JsTsParam {
  name: string;
  type?: string;
  hasDefault: boolean;
  isRest: boolean;
}

export interface JsTsImport {
  module: string;
  specifiers: string[];
  defaultImport?: string;
  namespaceImport?: string;
  isTypeOnly: boolean;
  line: number;
}

export interface JsTsExport {
  name: string;
  kind: 'function' | 'class' | 'variable' | 'type' | 'interface' | 're-export' | 'default';
  isDefault: boolean;
  isTypeOnly: boolean;
  line: number;
}

export interface JsTsMethod {
  name: string;
  isAsync: boolean;
  isStatic: boolean;
  isAbstract: boolean;
  visibility?: 'public' | 'protected' | 'private';
  params: JsTsParam[];
  returnType?: string;
  jsDoc?: string;
  line: number;
}

export interface JsTsClass {
  name: string;
  isExported: boolean;
  isDefault: boolean;
  isAbstract: boolean;
  extends?: string;
  implements: string[];
  methods: JsTsMethod[];
  jsDoc?: string;
  line: number;
}

export interface JsTsFunction {
  name: string;
  isAsync: boolean;
  isArrow: boolean;
  isExported: boolean;
  isDefault: boolean;
  params: JsTsParam[];
  returnType?: string;
  jsDoc?: string;
  line: number;
}

export interface JsTsVariable {
  name: string;
  kind: 'const' | 'let' | 'var';
  isExported: boolean;
  type?: string;
  line: number;
}

export interface JsTsInterface {
  name: string;
  isExported: boolean;
  extends: string[];
  line: number;
}

export interface JsTsTypeAlias {
  name: string;
  isExported: boolean;
  line: number;
}

export interface JsTsInspectionMetadata {
  language: 'javascript' | 'typescript';
  hasJsx: boolean;
  parsedAt: string;
  lineCount: number;
  fileSize: number;
}

export interface JsTsInspectionResult {
  language: 'javascript' | 'typescript';
  filePath: string;
  imports: JsTsImport[];
  exports: JsTsExport[];
  functions: JsTsFunction[];
  classes: JsTsClass[];
  variables: JsTsVariable[];
  interfaces: JsTsInterface[];
  typeAliases: JsTsTypeAlias[];
  errors: Array<{ message: string; line?: number }>;
  metadata: JsTsInspectionMetadata;
}


// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Strip single-line and block comments, preserving JSDoc blocks and line count. */
function stripNonDocComments(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  let inBlock = false;
  let isDoc = false;

  for (const line of lines) {
    if (inBlock) {
      out.push(isDoc ? line : '');
      if (line.includes('*/')) { inBlock = false; isDoc = false; }
      continue;
    }
    const docStart = line.indexOf('/**');
    const blockStart = line.indexOf('/*');
    if (docStart !== -1 && (blockStart === -1 || docStart <= blockStart)) {
      inBlock = true; isDoc = true;
      out.push(line);
      if (line.indexOf('*/', docStart + 3) !== -1) { inBlock = false; isDoc = false; }
      continue;
    }
    if (blockStart !== -1) {
      inBlock = true; isDoc = false;
      out.push('');
      if (line.indexOf('*/', blockStart + 2) !== -1) { inBlock = false; }
      continue;
    }
    const slashIdx = line.indexOf('//');
    out.push(slashIdx !== -1 ? line.substring(0, slashIdx) : line);
  }
  return out.join('\n');
}

/** Collect the JSDoc block immediately preceding a given line index. */
function collectJsDoc(lines: string[], beforeIndex: number): string | undefined {
  let i = beforeIndex - 1;
  while (i >= 0 && lines[i].trim() === '') i--;
  if (i < 0 || !lines[i].trimEnd().endsWith('*/')) return undefined;
  const end = i;
  while (i >= 0 && !lines[i].trim().startsWith('/**')) i--;
  return lines.slice(i, end + 1).join('\n');
}

/** Parse a parameter list string into JsTsParam[]. Best-effort, handles nesting. */
function parseParams(raw: string): JsTsParam[] {
  if (!raw.trim()) return [];
  const params: JsTsParam[] = [];
  let depth = 0;
  let current = '';
  for (const ch of raw) {
    if ('(<{['.includes(ch)) depth++;
    else if (')>}]'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) {
      processParam(current.trim(), params);
      current = ''; continue;
    }
    current += ch;
  }
  if (current.trim()) processParam(current.trim(), params);
  return params;
}

function processParam(raw: string, out: JsTsParam[]): void {
  if (!raw) return;
  const isRest = raw.startsWith('...');
  const stripped = isRest ? raw.slice(3) : raw;
  const hasDefault = stripped.includes('=');
  const nameAndType = hasDefault ? stripped.split('=')[0].trim() : stripped.trim();
  const colonIdx = nameAndType.indexOf(':');
  const name = (colonIdx !== -1 ? nameAndType.substring(0, colonIdx) : nameAndType).trim();
  const type = colonIdx !== -1 ? nameAndType.substring(colonIdx + 1).trim() : undefined;
  out.push({ name, type, hasDefault, isRest });
}

/** Extract visibility keyword from a line. */
function extractVisibility(line: string): 'public' | 'protected' | 'private' | undefined {
  if (/\bprivate\b/.test(line)) return 'private';
  if (/\bprotected\b/.test(line)) return 'protected';
  if (/\bpublic\b/.test(line)) return 'public';
  return undefined;
}

/** Extract `extends X` clause value from a class/interface declaration line. */
function extractExtends(line: string): string | undefined {
  const m = line.match(/\bextends\s+([\w$.<>, ]+?)(?:\s+implements|\s*[{,]|$)/);
  return m ? m[1].trim() : undefined;
}

/** Extract `implements X, Y` clause. */
function extractImplementsList(line: string): string[] {
  const m = line.match(/\bimplements\s+([\w$.<>, ]+?)(?:\s*\{|$)/);
  if (!m) return [];
  return m[1].split(',').map(s => s.trim()).filter(Boolean);
}

/** Extract content between the FIRST matching pair of balanced delimiters. */
function extractBetween(source: string, open: string, close: string): string {
  const start = source.indexOf(open);
  if (start === -1) return '';
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source.slice(i, i + open.length) === open) depth++;
    else if (source.slice(i, i + close.length) === close) {
      depth--;
      if (depth === 0) return source.slice(start + open.length, i);
    }
  }
  return source.slice(start + open.length);
}


// ---------------------------------------------------------------------------
// Import / Export parsers
// ---------------------------------------------------------------------------

/** Parse ES6+ import declarations from source lines. */
function parseImports(lines: string[]): JsTsImport[] {
  const results: JsTsImport[] = [];
  let i = 0;

  // Collapse logical multi-line imports by joining until we hit a ';'
  while (i < lines.length) {
    let raw = lines[i].trimStart();
    // Skip non-import lines
    if (!/^(?:import)\b/.test(raw)) { i++; continue; }

    // Accumulate multi-line import
    let full = raw;
    let j = i;
    while (!full.includes(';') && j + 1 < lines.length) {
      j++;
      full += ' ' + lines[j].trim();
    }

    try {
      const isTypeOnly = /^import\s+type\b/.test(full);
      const body = full.replace(/^import\s+(?:type\s+)?/, '').replace(/;.*$/, '').trim();

      // Side-effect import: import 'module' or import "module"
      const sideEffect = body.match(/^['"]([^'"]+)['"]/);
      if (sideEffect) {
        results.push({ module: sideEffect[1], specifiers: [], isTypeOnly: false, line: i + 1 });
        i = j + 1; continue;
      }

      // From clause
      const fromMatch = body.match(/(?:^|[}\]]\s*)from\s+['"]([^'"]+)['"]/);
      const module = fromMatch ? fromMatch[1] : '';

      const specifiers: string[] = [];
      let defaultImport: string | undefined;
      let namespaceImport: string | undefined;

      // Namespace: import * as X from ...
      const ns = body.match(/^\*\s+as\s+([\w$]+)/);
      if (ns) {
        namespaceImport = ns[1];
      } else {
        // Default + named: import X, { A, B } from ...
        const defaultAndNamed = body.match(/^([\w$]+)\s*,\s*\{([^}]*)\}/);
        if (defaultAndNamed) {
          defaultImport = defaultAndNamed[1];
          defaultAndNamed[2].split(',').forEach(s => { const t = s.trim(); if (t) specifiers.push(t); });
        } else {
          // Named block: { A, B as C }
          const named = body.match(/^\{([^}]*)\}/);
          if (named) {
            named[1].split(',').forEach(s => { const t = s.trim(); if (t) specifiers.push(t); });
          } else {
            // Default only: import X from ...
            const def = body.match(/^([\w$]+)\s+from/);
            if (def) defaultImport = def[1];
          }
        }
      }

      if (module || defaultImport || namespaceImport || specifiers.length) {
        results.push({ module, specifiers, defaultImport, namespaceImport, isTypeOnly, line: i + 1 });
      }
    } catch {
      // Skip malformed import
    }
    i = j + 1;
  }
  return results;
}

/** Parse top-level export declarations. */
function parseExports(lines: string[]): JsTsExport[] {
  const results: JsTsExport[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw.startsWith('export')) continue;

    // export default ...
    if (/^export\s+default\b/.test(raw)) {
      const name = raw.replace(/^export\s+default\s+/, '').replace(/[{;]/g, '').trim().split(/\s+/)[0] || 'default';
      results.push({ name, kind: 'default', isDefault: true, isTypeOnly: false, line: i + 1 });
      continue;
    }
    // export type { ... } from / export { ... } from
    const reExport = raw.match(/^export\s+(type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
    if (reExport) {
      const isTypeOnly = !!reExport[1];
      reExport[2].split(',').forEach(s => {
        const name = s.trim().replace(/\s+as\s+\w+/, '').trim();
        if (name) results.push({ name, kind: 're-export', isDefault: false, isTypeOnly, line: i + 1 });
      });
      continue;
    }
    // export { A, B as C }
    const namedExport = raw.match(/^export\s+(type\s+)?\{([^}]+)\}/);
    if (namedExport) {
      const isTypeOnly = !!namedExport[1];
      namedExport[2].split(',').forEach(s => {
        const nm = s.trim().replace(/\s+as\s+\w+/, '').trim();
        if (nm) results.push({ name: nm, kind: 'variable', isDefault: false, isTypeOnly, line: i + 1 });
      });
      continue;
    }
    // export function / class / interface / type / const / let / var
    const declExport = raw.match(/^export\s+(?:declare\s+)?(?:abstract\s+)?(function|class|interface|type|const|let|var)\s+([\w$]+)/);
    if (declExport) {
      const decl = declExport[1];
      const kind: JsTsExport['kind'] =
        decl === 'function' ? 'function' :
        decl === 'class' ? 'class' :
        decl === 'interface' ? 'interface' :
        decl === 'type' ? 'type' : 'variable';
      results.push({ name: declExport[2], kind, isDefault: false, isTypeOnly: decl === 'interface' || decl === 'type', line: i + 1 });
    }
  }
  return results;
}


// ---------------------------------------------------------------------------
// Function / Class / Interface / Variable parsers
// ---------------------------------------------------------------------------

/** Parse top-level function declarations (not methods). */
function parseFunctions(lines: string[], rawLines: string[]): JsTsFunction[] {
  const results: JsTsFunction[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();

    // export? async? function name(...)
    const fnDecl = raw.match(/^(export\s+)?(export\s+default\s+)?(async\s+)?function\s+\*?\s*([\w$]+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([\w\s<>\[\],|&?]+?))?(?:\s*\{|$)/);
    if (fnDecl) {
      results.push({
        name: fnDecl[4],
        isAsync: !!fnDecl[3],
        isArrow: false,
        isExported: !!fnDecl[1] || !!fnDecl[2],
        isDefault: !!fnDecl[2],
        params: parseParams(fnDecl[5] || ''),
        returnType: fnDecl[6]?.trim(),
        jsDoc: collectJsDoc(rawLines, i),
        line: i + 1,
      });
      continue;
    }

    // Arrow function: export? const name = async? (...) => ...
    const arrowDecl = raw.match(/^(export\s+)?(const|let|var)\s+([\w$]+)\s*(?::\s*[\w<>\[\]|&? ]+)?\s*=\s*(async\s+)?(?:\(([^)]*)\)|(\w+))\s*(?::\s*[\w<>\[\]|&? ]+)?\s*=>/);
    if (arrowDecl) {
      results.push({
        name: arrowDecl[3],
        isAsync: !!arrowDecl[4],
        isArrow: true,
        isExported: !!arrowDecl[1],
        isDefault: false,
        params: parseParams(arrowDecl[5] || arrowDecl[6] || ''),
        jsDoc: collectJsDoc(rawLines, i),
        line: i + 1,
      });
    }
  }
  return results;
}

/** Parse class declarations (top-level) and their methods. */
function parseClasses(lines: string[], rawLines: string[]): JsTsClass[] {
  const results: JsTsClass[] = [];
  const full = lines.join('\n');
  let searchFrom = 0;

  const classRe = /(?:^|\n)([ \t]*)(?:(export)\s+)?(?:(export\s+default)\s+)?(?:(abstract)\s+)?class\s+([\w$]+)(?:\s*<[^>]*>)?([^{]*)\{/g;
  let m: RegExpExecArray | null;

  while ((m = classRe.exec(full)) !== null) {
    const indent = m[1];
    if (indent !== '') continue; // Skip nested classes

    const lineIndex = full.substring(0, m.index).split('\n').length - 1;
    const isExported = !!(m[2] || m[3]);
    const isDefault = !!(m[3]);
    const isAbstract = !!m[4];
    const name = m[5];
    const inheritance = m[6] || '';

    const extendsVal = extractExtends(inheritance);
    const implementsList = extractImplementsList(inheritance);

    // Extract class body
    const bodyStart = m.index + m[0].length - 1; // position of '{'
    const body = extractBetween(full.slice(bodyStart), '{', '}');

    // Parse methods within body
    const methods: JsTsMethod[] = [];
    const bodyLines = body.split('\n');
    for (let bi = 0; bi < bodyLines.length; bi++) {
      const bl = bodyLines[bi].trim();
      if (!bl) continue;

      // Method pattern: visibility? static? abstract? async? name(...): RetType
      const methodRe = /^(?:(public|protected|private)\s+)?(?:(static)\s+)?(?:(abstract)\s+)?(?:(async)\s+)?\*?\s*(constructor|[\w$]+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([\w<>[\]|&? ]+?))?(?:\s*[{;]|$)/;
      const mm = bl.match(methodRe);
      if (mm && !bl.startsWith('//') && !bl.startsWith('*')) {
        methods.push({
          name: mm[5],
          isAsync: !!mm[4],
          isStatic: !!mm[2],
          isAbstract: !!mm[3],
          visibility: mm[1] as JsTsMethod['visibility'],
          params: parseParams(mm[6] || ''),
          returnType: mm[7]?.trim(),
          line: lineIndex + bi + 1,
        });
      }
    }

    results.push({
      name, isExported, isDefault, isAbstract,
      extends: extendsVal, implements: implementsList,
      methods,
      jsDoc: collectJsDoc(rawLines, lineIndex),
      line: lineIndex + 1,
    });
    searchFrom = classRe.lastIndex;
    void searchFrom; // used implicitly via regex state
  }

  return results;
}

/** Parse top-level interface declarations. */
function parseInterfaces(lines: string[]): JsTsInterface[] {
  const results: JsTsInterface[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    const m = raw.match(/^(?:(export)\s+)?interface\s+([\w$]+)(?:\s*<[^>]*>)?(?:\s+extends\s+([\w$,<>\s]+?))?(?:\s*\{|$)/);
    if (!m) continue;
    const extendsClause = m[3] ? m[3].split(',').map(s => s.trim()).filter(Boolean) : [];
    results.push({ name: m[2], isExported: !!m[1], extends: extendsClause, line: i + 1 });
  }
  return results;
}

/** Parse top-level type alias declarations. */
function parseTypeAliases(lines: string[]): JsTsTypeAlias[] {
  const results: JsTsTypeAlias[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    const m = raw.match(/^(?:(export)\s+)?type\s+([\w$]+)(?:\s*<[^>]*>)?\s*=/);
    if (m) results.push({ name: m[2], isExported: !!m[1], line: i + 1 });
  }
  return results;
}

/** Parse top-level variable declarations. Skips arrow functions already captured. */
function parseVariables(lines: string[], functions: JsTsFunction[]): JsTsVariable[] {
  const funcLines = new Set(functions.map(f => f.line));
  const results: JsTsVariable[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (funcLines.has(i + 1)) continue;
    const raw = lines[i].trim();
    const m = raw.match(/^(?:(export)\s+)?(const|let|var)\s+([\w$]+)(?:\s*:\s*([\w<>\[\]|&? ]+))?\s*=/);
    if (m) {
      results.push({
        name: m[3],
        kind: m[2] as 'const' | 'let' | 'var',
        isExported: !!m[1],
        type: m[4]?.trim(),
        line: i + 1,
      });
    }
  }
  return results;
}


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a JavaScript or TypeScript source file.
 *
 * @param filePath  Absolute or relative path (used for metadata and language detection)
 * @param content   Raw file content
 * @returns         Structured {@link JsTsInspectionResult}
 */
export function parseJsTs(filePath: string, content: string): JsTsInspectionResult {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const language: 'javascript' | 'typescript' = ['ts', 'tsx', 'mts', 'cts'].includes(ext) ? 'typescript' : 'javascript';
  const hasJsx = ['jsx', 'tsx'].includes(ext);

  const errors: Array<{ message: string; line?: number }> = [];

  // Strip non-JSDoc comments before analysis
  let cleaned: string;
  try {
    cleaned = stripNonDocComments(content);
  } catch (e) {
    errors.push({ message: `Comment stripping failed: ${e}` });
    cleaned = content;
  }

  const rawLines = content.split('\n');
  const lines = cleaned.split('\n');

  let imports: JsTsImport[] = [];
  let exports: JsTsExport[] = [];
  let functions: JsTsFunction[] = [];
  let classes: JsTsClass[] = [];
  let variables: JsTsVariable[] = [];
  let interfaces: JsTsInterface[] = [];
  let typeAliases: JsTsTypeAlias[] = [];

  try { imports = parseImports(lines); } catch (e) { errors.push({ message: `Import parse error: ${e}` }); }
  try { exports = parseExports(lines); } catch (e) { errors.push({ message: `Export parse error: ${e}` }); }
  try { functions = parseFunctions(lines, rawLines); } catch (e) { errors.push({ message: `Function parse error: ${e}` }); }
  try { classes = parseClasses(lines, rawLines); } catch (e) { errors.push({ message: `Class parse error: ${e}` }); }
  try { interfaces = parseInterfaces(lines); } catch (e) { errors.push({ message: `Interface parse error: ${e}` }); }
  try { typeAliases = parseTypeAliases(lines); } catch (e) { errors.push({ message: `TypeAlias parse error: ${e}` }); }
  try { variables = parseVariables(lines, functions); } catch (e) { errors.push({ message: `Variable parse error: ${e}` }); }

  return {
    language,
    filePath,
    imports,
    exports,
    functions,
    classes,
    variables,
    interfaces,
    typeAliases,
    errors,
    metadata: {
      language,
      hasJsx,
      parsedAt: new Date().toISOString(),
      lineCount: rawLines.length,
      fileSize: Buffer.byteLength(content, 'utf8'),
    },
  };
}
