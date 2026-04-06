/**
 * PHP Parser
 *
 * Parses PHP 7.4+ source files and extracts structural elements:
 * namespaces, classes, interfaces, traits, enums, functions, constants,
 * and PHPDoc comments. Supports PSR-4 autoloading conventions.
 *
 * Implements: bd-modinsp.2.3 (PHP Parser)
 */

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

export interface PhpDocParam {
  name: string;
  type: string;
  description: string;
}

export interface PhpDocReturn {
  type: string;
  description: string;
}

export interface PhpDocComment {
  description: string;
  params: PhpDocParam[];
  returns?: PhpDocReturn;
  throws: string[];
  deprecated: boolean;
  raw: string;
}

export interface PhpParam {
  name: string;
  type?: string;
  defaultValue?: string;
  byReference: boolean;
  variadic: boolean;
}

export interface PhpFunction {
  name: string;
  namespace?: string;
  visibility?: 'public' | 'protected' | 'private';
  isStatic: boolean;
  isAbstract: boolean;
  isFinal: boolean;
  params: PhpParam[];
  returnType?: string;
  docComment?: PhpDocComment;
  line: number;
}

export interface PhpProperty {
  name: string;
  visibility: 'public' | 'protected' | 'private';
  isStatic: boolean;
  isReadonly: boolean;
  type?: string;
  defaultValue?: string;
  docComment?: PhpDocComment;
  line: number;
}

export interface PhpConstant {
  name: string;
  value: string;
  namespace?: string;
  visibility?: 'public' | 'protected' | 'private';
  docComment?: PhpDocComment;
  line: number;
}

export interface PhpClass {
  name: string;
  namespace?: string;
  kind: 'class' | 'interface' | 'trait' | 'enum';
  isAbstract: boolean;
  isFinal: boolean;
  isReadonly: boolean;
  extends?: string;
  implements: string[];
  methods: PhpFunction[];
  properties: PhpProperty[];
  constants: PhpConstant[];
  docComment?: PhpDocComment;
  line: number;
}

export interface PhpNamespace {
  name: string;
  line: number;
}

export interface PhpUse {
  fqn: string;
  alias?: string;
  line: number;
}

export interface PhpParseError {
  message: string;
  line?: number;
  context?: string;
}

export interface PhpInspectionMetadata {
  phpVersion: string;
  strictTypes: boolean;
  psr4Compliant: boolean;
  parsedAt: string;
  lineCount: number;
  fileSize: number;
}

/** Top-level result returned by PhpParser.parse() */
export interface InspectionResult {
  language: 'php';
  filePath: string;
  namespaces: PhpNamespace[];
  uses: PhpUse[];
  classes: PhpClass[];
  functions: PhpFunction[];
  constants: PhpConstant[];
  errors: PhpParseError[];
  metadata: PhpInspectionMetadata;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Strip single-line (//) and block (/* … *\/) comments while preserving
 *  PHPDoc blocks (/** … *\/) and keeping line numbers intact. */
function stripNonDocComments(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  let inBlock = false;
  let isDoc = false;

  for (const line of lines) {
    if (inBlock) {
      if (isDoc) {
        out.push(line); // preserve PHPDoc lines
      } else {
        out.push(''); // blank out non-doc block comment lines
      }
      if (line.includes('*/')) {
        inBlock = false;
        isDoc = false;
      }
      continue;
    }

    // Detect start of PHPDoc vs. regular block comment
    const docStart = line.indexOf('/**');
    const blockStart = line.indexOf('/*');

    if (docStart !== -1 && (blockStart === -1 || docStart <= blockStart)) {
      inBlock = true;
      isDoc = true;
      out.push(line);
      if (line.indexOf('*/', docStart + 3) !== -1) {
        inBlock = false;
        isDoc = false;
      }
      continue;
    }

    if (blockStart !== -1) {
      inBlock = true;
      isDoc = false;
      out.push('');
      if (line.indexOf('*/', blockStart + 2) !== -1) {
        inBlock = false;
      }
      continue;
    }

    // Strip inline // comments (but not inside strings – best-effort)
    const slashIdx = line.indexOf('//');
    if (slashIdx !== -1) {
      out.push(line.substring(0, slashIdx));
    } else {
      out.push(line);
    }
  }

  return out.join('\n');
}

/** Parse a PHPDoc block (/** … *\/) into structured data. */
function parsePhpDoc(raw: string): PhpDocComment {
  const doc: PhpDocComment = {
    description: '',
    params: [],
    throws: [],
    deprecated: false,
    raw,
  };

  const lines = raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter((l) => l.length > 0);

  const descLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('@param')) {
      const m = line.match(/@param\s+(\S+)\s+(\$\S+)\s*(.*)/);
      if (m) {
        doc.params.push({ type: m[1], name: m[2], description: m[3] ?? '' });
      }
    } else if (line.startsWith('@return')) {
      const m = line.match(/@return\s+(\S+)\s*(.*)/);
      if (m) {
        doc.returns = { type: m[1], description: m[2] ?? '' };
      }
    } else if (line.startsWith('@throws')) {
      const m = line.match(/@throws\s+(\S+)/);
      if (m) doc.throws.push(m[1]);
    } else if (line.startsWith('@deprecated')) {
      doc.deprecated = true;
    } else if (!line.startsWith('@')) {
      descLines.push(line);
    }
  }

  doc.description = descLines.join(' ').trim();
  return doc;
}

/** Extract all PHPDoc blocks that immediately precede a declaration. */
function extractDocBlocks(source: string): Map<number, PhpDocComment> {
  const map = new Map<number, PhpDocComment>();
  const docPattern = /\/\*\*([\s\S]*?)\*\//g;
  let match: RegExpExecArray | null;
  const lines = source.split('\n');

  while ((match = docPattern.exec(source)) !== null) {
    const blockEnd = match.index + match[0].length;
    // `linesBefore` = number of lines in the substring up to and including `*/`.
    // The declaration starts on the NEXT line (linesBefore + 1), possibly after
    // blank lines.
    const linesBefore = source.substring(0, blockEnd).split('\n').length;
    let declLine = linesBefore + 1; // first line after closing */
    while (declLine <= lines.length && lines[declLine - 1]?.trim() === '') {
      declLine++;
    }
    map.set(declLine, parsePhpDoc(match[0]));
  }

  return map;
}

/** Parse a function/method parameter list string into PhpParam[]. */
function parseParamList(paramStr: string): PhpParam[] {
  if (!paramStr.trim()) return [];
  const params: PhpParam[] = [];
  // Split on commas not inside parentheses/brackets (best-effort for defaults)
  const parts = paramStr.split(/,(?![^()\[\]]*[)\]])/);
  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;
    const byRef = p.includes('&');
    const variadic = p.includes('...');
    // Strip modifiers
    const clean = p.replace(/&/, '').replace(/\.\.\./, '').trim();
    // Pattern: [type] [$name] [= default]
    const m = clean.match(/^([^$=]*?)\s*(\$\w+)\s*(?:=\s*(.+))?$/);
    if (m) {
      params.push({
        name: m[2],
        type: m[1].trim() || undefined,
        defaultValue: m[3]?.trim() || undefined,
        byReference: byRef,
        variadic,
      });
    }
  }
  return params;
}

/** Count open/close braces in a string (non-string-aware, best-effort). */
function countBraces(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (ch === '{') count++;
    else if (ch === '}') count--;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Main Parser Class
// ---------------------------------------------------------------------------

/**
 * PhpParser – parses PHP 7.4+ source code to produce an InspectionResult.
 *
 * Strategy: single-pass line scan with brace-depth tracking.
 * Does not execute PHP; uses regex + heuristics to extract structure.
 * Handles parse errors gracefully (records them and continues).
 */
export class PhpParser {
  /**
   * Parse PHP source content.
   *
   * @param content  Raw PHP source text.
   * @param filePath Logical file path (used in result metadata).
   * @returns        Structured InspectionResult.
   */
  parse(content: string, filePath = '<unknown>'): InspectionResult {
    const result: InspectionResult = {
      language: 'php',
      filePath,
      namespaces: [],
      uses: [],
      classes: [],
      functions: [],
      constants: [],
      errors: [],
      metadata: {
        phpVersion: '7.4+',
        strictTypes: false,
        psr4Compliant: false,
        parsedAt: new Date().toISOString(),
        lineCount: content.split('\n').length,
        fileSize: Buffer.byteLength(content, 'utf8'),
      },
    };

    try {
      this._parse(content, filePath, result);
      result.metadata.psr4Compliant = this._checkPsr4(result, filePath);
    } catch (err) {
      result.errors.push({
        message: err instanceof Error ? err.message : String(err),
        context: 'top-level parse',
      });
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Internal parse implementation
  // -------------------------------------------------------------------------

  private _parse(source: string, filePath: string, result: InspectionResult): void {
    const stripped = stripNonDocComments(source);
    const docBlocks = extractDocBlocks(source);
    const lines = stripped.split('\n');

    // Detect strict_types
    result.metadata.strictTypes = /declare\s*\(\s*strict_types\s*=\s*1\s*\)/.test(source);

    let currentNamespace: string | undefined;
    let braceDepth = 0;
    // Track class context when inside a class body
    interface ClassContext {
      cls: PhpClass;
      startDepth: number;
    }
    const classStack: ClassContext[] = [];

    let i = 0;
    while (i < lines.length) {
      const lineNo = i + 1; // 1-based
      const line = lines[i];
      const trimmed = line.trim();

      // ----- namespace -----
      const nsMatch = trimmed.match(/^namespace\s+([\w\\]+)\s*[;{]/);
      if (nsMatch) {
        currentNamespace = nsMatch[1];
        result.namespaces.push({ name: currentNamespace, line: lineNo });
        braceDepth += countBraces(line);
        i++;
        continue;
      }

      // ----- use -----
      const useMatch = trimmed.match(/^use\s+([\w\\]+(?:\s*,\s*[\w\\]+)*)\s*(?:as\s+(\w+))?\s*;/);
      if (useMatch && !trimmed.startsWith('use function') && !trimmed.startsWith('use const')) {
        const fqns = useMatch[1].split(',').map((s) => s.trim());
        for (const fqn of fqns) {
          result.uses.push({ fqn, alias: useMatch[2] || undefined, line: lineNo });
        }
        braceDepth += countBraces(line);
        i++;
        continue;
      }

      // ----- const (define or const keyword) -----
      if (trimmed.startsWith('define(')) {
        const m = trimmed.match(/define\s*\(\s*['"](\w+)['"]\s*,\s*([^)]+)\)/);
        if (m) {
          const ctx = classStack[classStack.length - 1];
          if (!ctx) {
            result.constants.push({
              name: m[1],
              value: m[2].trim(),
              namespace: currentNamespace,
              docComment: docBlocks.get(lineNo),
              line: lineNo,
            });
          }
        }
        braceDepth += countBraces(line);
        i++;
        continue;
      }

      // class/interface/trait-level const
      const constMatch = trimmed.match(
        /^(?:(public|protected|private)\s+)?const\s+(\w+)\s*=\s*(.+?)\s*;/
      );
      if (constMatch) {
        const constant: PhpConstant = {
          name: constMatch[2],
          value: constMatch[3],
          namespace: currentNamespace,
          visibility: (constMatch[1] as PhpConstant['visibility']) || 'public',
          docComment: docBlocks.get(lineNo),
          line: lineNo,
        };
        const ctx = classStack[classStack.length - 1];
        if (ctx) {
          ctx.cls.constants.push(constant);
        } else {
          result.constants.push(constant);
        }
        braceDepth += countBraces(line);
        i++;
        continue;
      }

      // ----- class / interface / trait / enum -----
      const classMatch = trimmed.match(
        /^(?:(abstract|final|readonly)\s+)?(?:(abstract|final|readonly)\s+)?(class|interface|trait|enum)\s+(\w+)(?:\s+extends\s+([\w\\]+))?(?:\s+implements\s+([\w\\,\s]+))?\s*(?:\{|$)/
      );
      if (classMatch) {
        const mod1 = classMatch[1] ?? '';
        const mod2 = classMatch[2] ?? '';
        const kind = classMatch[3] as PhpClass['kind'];
        const name = classMatch[4];
        const extendsName = classMatch[5];
        const implementsRaw = classMatch[6] ?? '';

        const cls: PhpClass = {
          name,
          namespace: currentNamespace,
          kind,
          isAbstract: mod1 === 'abstract' || mod2 === 'abstract',
          isFinal: mod1 === 'final' || mod2 === 'final',
          isReadonly: mod1 === 'readonly' || mod2 === 'readonly',
          extends: extendsName || undefined,
          implements: implementsRaw
            ? implementsRaw.split(',').map((s) => s.trim()).filter(Boolean)
            : [],
          methods: [],
          properties: [],
          constants: [],
          docComment: docBlocks.get(lineNo),
          line: lineNo,
        };

        result.classes.push(cls);
        classStack.push({ cls, startDepth: braceDepth });
        braceDepth += countBraces(line);
        i++;
        continue;
      }

      // ----- function / method -----
      const fnMatch = trimmed.match(
        /^(?:(public|protected|private)\s+)?(?:(static|abstract|final)\s+)?(?:(static|abstract|final)\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([\w\\|?&]+))?\s*(?:\{|;|$)/
      );
      if (fnMatch) {
        const vis = fnMatch[1] as PhpFunction['visibility'] | undefined;
        const mods = [fnMatch[2] ?? '', fnMatch[3] ?? ''];
        const fnName = fnMatch[4];
        const paramStr = fnMatch[5] ?? '';
        const returnType = fnMatch[6] || undefined;

        const fn: PhpFunction = {
          name: fnName,
          namespace: currentNamespace,
          visibility: vis,
          isStatic: mods.includes('static'),
          isAbstract: mods.includes('abstract'),
          isFinal: mods.includes('final'),
          params: parseParamList(paramStr),
          returnType,
          docComment: docBlocks.get(lineNo),
          line: lineNo,
        };

        const ctx = classStack[classStack.length - 1];
        if (ctx) {
          ctx.cls.methods.push(fn);
        } else {
          result.functions.push(fn);
        }
        braceDepth += countBraces(line);
        i++;
        continue;
      }

      // ----- property (inside class) -----
      const propMatch = trimmed.match(
        /^(?:(public|protected|private)\s+)?(?:(static|readonly)\s+)?(?:(static|readonly)\s+)?([\w\\|?]+\s+)?\$([\w]+)\s*(?:=\s*([^;]+))?\s*;/
      );
      const ctx = classStack[classStack.length - 1];
      if (propMatch && ctx && !trimmed.startsWith('function')) {
        const prop: PhpProperty = {
          name: `$${propMatch[5]}`,
          visibility: (propMatch[1] as PhpProperty['visibility']) || 'public',
          isStatic: propMatch[2] === 'static' || propMatch[3] === 'static',
          isReadonly: propMatch[2] === 'readonly' || propMatch[3] === 'readonly',
          type: propMatch[4]?.trim() || undefined,
          defaultValue: propMatch[6]?.trim() || undefined,
          docComment: docBlocks.get(lineNo),
          line: lineNo,
        };
        ctx.cls.properties.push(prop);
      }

      // Track brace depth and pop completed classes
      braceDepth += countBraces(line);
      while (
        classStack.length > 0 &&
        braceDepth <= classStack[classStack.length - 1].startDepth
      ) {
        classStack.pop();
      }

      i++;
    }
  }

  /**
   * Heuristic PSR-4 compliance check:
   * – File must have exactly one namespace declaration
   * – File must contain at least one class/interface/trait/enum
   * – The first class name should appear in the filePath
   */
  private _checkPsr4(result: InspectionResult, filePath: string): boolean {
    if (result.namespaces.length !== 1) return false;
    if (result.classes.length === 0) return false;
    const firstName = result.classes[0].name;
    const baseName = filePath.split(/[\\/]/).pop()?.replace(/\.php$/i, '') ?? '';
    return baseName === firstName;
  }
}

// ---------------------------------------------------------------------------
// Convenience factory function
// ---------------------------------------------------------------------------

/**
 * Parse a PHP source string and return an InspectionResult.
 *
 * @param content  PHP source code.
 * @param filePath Optional logical path for metadata.
 */
export function parsePhp(content: string, filePath?: string): InspectionResult {
  return new PhpParser().parse(content, filePath);
}

/**
 * Parse a PHP file on disk.
 *
 * @param filePath Absolute or relative path to the .php file.
 */
export async function parsePhpFile(filePath: string): Promise<InspectionResult> {
  const fs = await import('fs/promises');
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    const result: InspectionResult = {
      language: 'php',
      filePath,
      namespaces: [],
      uses: [],
      classes: [],
      functions: [],
      constants: [],
      errors: [
        {
          message: err instanceof Error ? err.message : String(err),
          context: 'file read',
        },
      ],
      metadata: {
        phpVersion: '7.4+',
        strictTypes: false,
        psr4Compliant: false,
        parsedAt: new Date().toISOString(),
        lineCount: 0,
        fileSize: 0,
      },
    };
    return result;
  }
  return parsePhp(content, filePath);
}
