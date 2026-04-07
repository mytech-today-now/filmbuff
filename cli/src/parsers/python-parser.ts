/**
 * Python Parser
 *
 * Pure-TypeScript, line-scanning parser for Python 3 source files.
 * Extracts: imports, functions, classes (with methods), variables/constants.
 * No external dependencies – regex + state-machine approach.
 *
 * Implements: bd-modinsp.2.2 (Python Parser)
 */

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

export interface PyImport {
  /** The module being imported: `os`, `pathlib`, etc. */
  module: string;
  /** Names imported: `from X import A, B` → ['A', 'B']. Empty for bare `import X`. */
  names: string[];
  /** Alias when using `import X as Y` */
  alias?: string;
  /** True when `from X import *` */
  isStar: boolean;
  /** True when using `from X import ...` form */
  isFrom: boolean;
  line: number;
}

export interface PyParam {
  name: string;
  annotation?: string;
  hasDefault: boolean;
  isRest: boolean;   // *args
  isKwRest: boolean; // **kwargs
}

export interface PyDecorator {
  name: string;
  args?: string;
  line: number;
}

export interface PyMethod {
  name: string;
  isAsync: boolean;
  isStatic: boolean;
  isClassMethod: boolean;
  isAbstract: boolean;
  isProperty: boolean;
  params: PyParam[];
  decorators: PyDecorator[];
  returnType?: string;
  docstring?: string;
  line: number;
}

export interface PyClass {
  name: string;
  bases: string[];
  decorators: PyDecorator[];
  methods: PyMethod[];
  classVars: PyVariable[];
  docstring?: string;
  line: number;
}

export interface PyFunction {
  name: string;
  isAsync: boolean;
  params: PyParam[];
  decorators: PyDecorator[];
  returnType?: string;
  docstring?: string;
  line: number;
}

export interface PyVariable {
  name: string;
  /** PEP 526 annotation: `x: int = 5` */
  annotation?: string;
  line: number;
}

export interface PyInspectionMetadata {
  parsedAt: string;
  lineCount: number;
  fileSize: number;
  hasDunder: boolean;     // has __name__, __version__, etc.
  pythonVersion: '3';
}

export interface PyInspectionResult {
  filePath: string;
  imports: PyImport[];
  functions: PyFunction[];
  classes: PyClass[];
  variables: PyVariable[];
  errors: Array<{ message: string; line?: number }>;
  metadata: PyInspectionMetadata;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Python indentation level: count leading spaces (tabs count as 4). */
function indentLevel(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (ch === ' ') count++;
    else if (ch === '\t') count += 4;
    else break;
  }
  return count;
}

/** Extract triple-quoted docstring from the first non-blank line of a body. */
function extractDocstring(lines: string[], startIdx: number): string | undefined {
  let i = startIdx;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length) return undefined;
  const first = lines[i].trim();
  for (const q of ['"""', "'''"]) {
    if (!first.startsWith(q)) continue;
    // Single-line docstring: """text"""
    const inner = first.slice(q.length);
    if (inner.includes(q)) return inner.slice(0, inner.indexOf(q)).trim();
    // Multi-line: collect until closing triple-quote
    const doc: string[] = [inner];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].includes(q)) {
        doc.push(lines[j].slice(0, lines[j].indexOf(q)));
        return doc.join('\n').trim();
      }
      doc.push(lines[j]);
    }
  }
  return undefined;
}

/** Parse a Python parameter list string into PyParam[]. */
function parsePyParams(raw: string): PyParam[] {
  if (!raw.trim()) return [];
  const params: PyParam[] = [];
  // Split on commas not inside brackets
  let depth = 0;
  let current = '';
  for (const ch of raw) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) {
      pushPyParam(current.trim(), params);
      current = ''; continue;
    }
    current += ch;
  }
  if (current.trim()) pushPyParam(current.trim(), params);
  return params;
}

function pushPyParam(raw: string, out: PyParam[]): void {
  if (!raw || raw === '/') return; // positional-only separator
  const isKwRest = raw.startsWith('**');
  const isRest = !isKwRest && raw.startsWith('*');
  const stripped = raw.slice(isKwRest ? 2 : isRest ? 1 : 0).trim();
  // Strip 'self' / 'cls' but keep in params list
  const hasDefault = stripped.includes('=');
  const nameAndAnnotation = hasDefault ? stripped.split('=')[0].trim() : stripped;
  const colonIdx = nameAndAnnotation.indexOf(':');
  const name = (colonIdx !== -1 ? nameAndAnnotation.slice(0, colonIdx) : nameAndAnnotation).trim();
  const annotation = colonIdx !== -1 ? nameAndAnnotation.slice(colonIdx + 1).trim() : undefined;
  out.push({ name, annotation, hasDefault, isRest, isKwRest });
}

/** Collect decorator lines immediately above a def/class. Returns decorators and new index. */
function collectDecorators(lines: string[], defIndex: number): PyDecorator[] {
  const decorators: PyDecorator[] = [];
  let i = defIndex - 1;
  while (i >= 0 && lines[i].trim().startsWith('@')) {
    const dLine = lines[i].trim();
    const parenIdx = dLine.indexOf('(');
    const name = parenIdx !== -1 ? dLine.slice(1, parenIdx) : dLine.slice(1);
    const args = parenIdx !== -1 ? dLine.slice(parenIdx + 1, dLine.lastIndexOf(')')) : undefined;
    decorators.unshift({ name, args, line: i + 1 });
    i--;
  }
  return decorators;
}

/** Parse a def signature that may span multiple lines (continuation via `\` or open paren). */
function collectDefSignature(lines: string[], startIdx: number): { sig: string; endIdx: number } {
  let sig = lines[startIdx];
  let i = startIdx;
  // If we have an open paren with no matching close, keep reading
  let depth = (sig.match(/\(/g) || []).length - (sig.match(/\)/g) || []).length;
  while (depth > 0 && i + 1 < lines.length) {
    i++;
    sig += ' ' + lines[i].trim();
    depth += (lines[i].match(/\(/g) || []).length;
    depth -= (lines[i].match(/\)/g) || []).length;
  }
  return { sig, endIdx: i };
}

// ---------------------------------------------------------------------------
// Top-level parsers
// ---------------------------------------------------------------------------

function parseImports(lines: string[]): PyImport[] {
  const results: PyImport[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i].trim();

    // from X import Y, Z  /  from X import *
    const fromMatch = raw.match(/^from\s+([\w.]+)\s+import\s+(.+)$/);
    if (fromMatch) {
      const module = fromMatch[1];
      const rest = fromMatch[2].trim();
      const isStar = rest === '*';
      const rawNames = isStar ? [] : rest.replace(/^\(/, '').replace(/\)$/, '').split(',').map(s => s.trim()).filter(Boolean);
      results.push({ module, names: rawNames, isStar, isFrom: true, line: i + 1 });
      i++; continue;
    }

    // import X  /  import X as Y  /  import X, Y
    const impMatch = raw.match(/^import\s+(.+)$/);
    if (impMatch) {
      const parts = impMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      for (const part of parts) {
        const asMm = part.match(/^([\w.]+)\s+as\s+([\w]+)$/);
        if (asMm) {
          results.push({ module: asMm[1], names: [], alias: asMm[2], isStar: false, isFrom: false, line: i + 1 });
        } else {
          results.push({ module: part, names: [], isStar: false, isFrom: false, line: i + 1 });
        }
      }
    }
    i++;
  }
  return results;
}

function parseFunctions(lines: string[], baseIndent = 0): PyFunction[] {
  const results: PyFunction[] = [];
  let i = 0;
  while (i < lines.length) {
    const lvl = indentLevel(lines[i]);
    if (lvl !== baseIndent) { i++; continue; }
    const raw = lines[i].trim();
    const isAsync = raw.startsWith('async ');
    const defMatch = (isAsync ? raw.slice(6) : raw).match(/^def\s+([\w$]+)\s*\(/);
    if (!defMatch) { i++; continue; }

    const { sig, endIdx } = collectDefSignature(lines, i);
    const paramMatch = sig.match(/\(([^)]*)\)(?:\s*->\s*([\w\s\[\]|,.']+?))?:/);
    const params = parsePyParams(paramMatch?.[1] ?? '');
    const returnType = paramMatch?.[2]?.trim();
    const decorators = collectDecorators(lines, i);
    const docstring = extractDocstring(lines, endIdx + 1);

    results.push({
      name: defMatch[1], isAsync, params, decorators,
      returnType, docstring, line: i + 1,
    });
    i = endIdx + 1;
  }
  return results;
}

function parseClasses(lines: string[]): PyClass[] {
  const results: PyClass[] = [];
  let i = 0;
  while (i < lines.length) {
    const lvl = indentLevel(lines[i]);
    if (lvl !== 0) { i++; continue; }
    const raw = lines[i].trim();
    const classMatch = raw.match(/^class\s+([\w$]+)\s*(?:\(([^)]*)\))?:/);
    if (!classMatch) { i++; continue; }

    const name = classMatch[1];
    const bases = (classMatch[2] || '').split(',').map(s => s.trim()).filter(Boolean);
    const decorators = collectDecorators(lines, i);
    const classLine = i + 1;

    // Collect body at indent+4
    const bodyStart = i + 1;
    let bodyEnd = bodyStart;
    while (bodyEnd < lines.length) {
      const bLine = lines[bodyEnd];
      if (bLine.trim() === '' || indentLevel(bLine) > 0) { bodyEnd++; continue; }
      break;
    }
    const bodyLines = lines.slice(bodyStart, bodyEnd).map(l =>
      l.length >= 4 ? l.slice(4) : l.trimStart()
    );

    const docstring = extractDocstring(bodyLines, 0);
    const methods = parseClassMethods(bodyLines, classLine + 1);
    const classVars = parseClassVars(bodyLines, classLine + 1);

    results.push({ name, bases, decorators, methods, classVars, docstring, line: classLine });
    i = bodyEnd;
  }
  return results;
}

function parseClassMethods(bodyLines: string[], lineOffset: number): PyMethod[] {
  const methods: PyMethod[] = [];
  let i = 0;
  while (i < bodyLines.length) {
    const lvl = indentLevel(bodyLines[i]);
    if (lvl !== 0) { i++; continue; }
    const raw = bodyLines[i].trim();
    const isAsync = raw.startsWith('async ');
    const defMatch = (isAsync ? raw.slice(6) : raw).match(/^def\s+([\w$]+)\s*\(/);
    if (!defMatch) { i++; continue; }

    const decorators = collectDecorators(bodyLines, i);
    const decoratorNames = decorators.map(d => d.name);
    const { sig, endIdx } = collectDefSignature(bodyLines, i);
    const paramMatch = sig.match(/\(([^)]*)\)(?:\s*->\s*([\w\s\[\]|,.']+?))?:/);
    const params = parsePyParams(paramMatch?.[1] ?? '');
    const returnType = paramMatch?.[2]?.trim();
    const docstring = extractDocstring(bodyLines, endIdx + 1);

    methods.push({
      name: defMatch[1], isAsync,
      isStatic: decoratorNames.includes('staticmethod'),
      isClassMethod: decoratorNames.includes('classmethod'),
      isAbstract: decoratorNames.includes('abstractmethod'),
      isProperty: decoratorNames.includes('property'),
      params, decorators, returnType, docstring,
      line: lineOffset + i,
    });
    i = endIdx + 1;
  }
  return methods;
}

function parseClassVars(bodyLines: string[], lineOffset: number): PyVariable[] {
  const vars: PyVariable[] = [];
  for (let i = 0; i < bodyLines.length; i++) {
    const lvl = indentLevel(bodyLines[i]);
    if (lvl !== 0) continue;
    const raw = bodyLines[i].trim();
    if (raw.startsWith('def ') || raw.startsWith('async def') || raw.startsWith('@') || raw.startsWith('#')) continue;
    // x: int = 5  or  x = 5
    const m = raw.match(/^([\w$]+)(?:\s*:\s*([\w\[\]|, ]+?))?\s*=/);
    if (m) vars.push({ name: m[1], annotation: m[2]?.trim(), line: lineOffset + i });
  }
  return vars;
}

function parseTopLevelVars(lines: string[]): PyVariable[] {
  const vars: PyVariable[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lvl = indentLevel(lines[i]);
    if (lvl !== 0) continue;
    const raw = lines[i].trim();
    if (raw.startsWith('#') || raw.startsWith('def ') || raw.startsWith('async def')
        || raw.startsWith('class ') || raw.startsWith('import ') || raw.startsWith('from ')
        || raw.startsWith('@') || raw.startsWith('"""') || raw.startsWith("'''")) continue;
    const m = raw.match(/^([\w$]+)(?:\s*:\s*([\w\[\]|, ]+?))?\s*=/);
    if (m) vars.push({ name: m[1], annotation: m[2]?.trim(), line: i + 1 });
  }
  return vars;
}



// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a Python 3 source file.
 *
 * @param filePath  Absolute or relative path (used for metadata)
 * @param content   Raw file content
 * @returns         Structured {@link PyInspectionResult}
 */
export function parsePython(filePath: string, content: string): PyInspectionResult {
  const errors: Array<{ message: string; line?: number }> = [];
  const lines = content.split('\n');

  let imports: PyImport[] = [];
  let functions: PyFunction[] = [];
  let classes: PyClass[] = [];
  let variables: PyVariable[] = [];

  try { imports = parseImports(lines); } catch (e) { errors.push({ message: `Import parse error: ${e}` }); }
  try { functions = parseFunctions(lines); } catch (e) { errors.push({ message: `Function parse error: ${e}` }); }
  try { classes = parseClasses(lines); } catch (e) { errors.push({ message: `Class parse error: ${e}` }); }
  try { variables = parseTopLevelVars(lines); } catch (e) { errors.push({ message: `Variable parse error: ${e}` }); }

  const hasDunder = lines.some(l => /^__\w+__\s*=/.test(l.trim()));

  return {
    filePath,
    imports,
    functions,
    classes,
    variables,
    errors,
    metadata: {
      parsedAt: new Date().toISOString(),
      lineCount: lines.length,
      fileSize: Buffer.byteLength(content, 'utf8'),
      hasDunder,
      pythonVersion: '3',
    },
  };
}
