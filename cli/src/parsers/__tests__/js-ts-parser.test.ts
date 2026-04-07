/**
 * Unit tests – JS/TS Parser  (bd-modinsp.7.1)
 *
 * All tests are pure in-memory (no file I/O).
 * Coverage target: >80% of js-ts-parser.ts
 */

import { describe, it, expect } from '@jest/globals';
import { parseJsTs } from '../js-ts-parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const parse = (content: string, ext = 'ts') =>
  parseJsTs(`/fixture/file.${ext}`, content);

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

describe('Language detection', () => {
  it('detects .ts files as typescript', () => {
    expect(parse('', 'ts').language).toBe('typescript');
  });
  it('detects .tsx files as typescript with JSX', () => {
    const r = parse('', 'tsx');
    expect(r.language).toBe('typescript');
    expect(r.metadata.hasJsx).toBe(true);
  });
  it('detects .js files as javascript', () => {
    expect(parse('', 'js').language).toBe('javascript');
  });
  it('detects .jsx files as javascript with JSX', () => {
    const r = parse('', 'jsx');
    expect(r.language).toBe('javascript');
    expect(r.metadata.hasJsx).toBe(true);
  });
  it('detects .mts as typescript', () => {
    expect(parseJsTs('/f.mts', '').language).toBe('typescript');
  });
});

// ---------------------------------------------------------------------------
// Import parsing
// ---------------------------------------------------------------------------

describe('Import parsing', () => {
  it('parses named imports', () => {
    const r = parse(`import { readFile, writeFile } from 'fs';`);
    const imp = r.imports.find(i => i.module === 'fs');
    expect(imp).toBeDefined();
    expect(imp!.specifiers).toEqual(expect.arrayContaining(['readFile', 'writeFile']));
    expect(imp!.isTypeOnly).toBe(false);
  });

  it('parses default import', () => {
    const r = parse(`import express from 'express';`);
    const imp = r.imports.find(i => i.module === 'express');
    expect(imp?.defaultImport).toBe('express');
  });

  it('parses namespace import (import * as)', () => {
    const r = parse(`import * as path from 'path';`);
    const imp = r.imports.find(i => i.module === 'path');
    expect(imp?.namespaceImport).toBe('path');
  });

  it('parses type-only import', () => {
    const r = parse(`import type { Request } from 'express';`);
    const imp = r.imports.find(i => i.module === 'express');
    expect(imp?.isTypeOnly).toBe(true);
  });

  it('parses side-effect import', () => {
    const r = parse(`import 'reflect-metadata';`);
    expect(r.imports.find(i => i.module === 'reflect-metadata')).toBeDefined();
  });

  it('parses default + named import', () => {
    const r = parse(`import React, { useState, useEffect } from 'react';`);
    const imp = r.imports.find(i => i.module === 'react');
    expect(imp?.defaultImport).toBe('React');
    expect(imp?.specifiers).toContain('useState');
  });

  it('records correct line number', () => {
    const r = parse(`\nimport fs from 'fs';`);
    expect(r.imports[0]?.line).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Export parsing
// ---------------------------------------------------------------------------

describe('Export parsing', () => {
  it('parses named function export', () => {
    const r = parse(`export function greet(name: string): string { return ''; }`);
    expect(r.exports.find(e => e.name === 'greet' && e.kind === 'function')).toBeDefined();
  });

  it('parses default export', () => {
    const r = parse(`export default class App {}`);
    expect(r.exports.find(e => e.isDefault)).toBeDefined();
  });

  it('parses named export list', () => {
    const r = parse(`const a = 1; const b = 2; export { a, b };`);
    const names = r.exports.map(e => e.name);
    expect(names).toContain('a');
    expect(names).toContain('b');
  });

  it('parses re-export', () => {
    const r = parse(`export { foo } from './foo';`);
    expect(r.exports.find(e => e.name === 'foo' && e.kind === 're-export')).toBeDefined();
  });

  it('parses interface export', () => {
    const r = parse(`export interface IUser { name: string; }`);
    expect(r.exports.find(e => e.name === 'IUser' && e.kind === 'interface')).toBeDefined();
  });

  it('parses type alias export', () => {
    const r = parse(`export type UserId = string;`);
    expect(r.exports.find(e => e.name === 'UserId' && e.kind === 'type')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Function parsing
// ---------------------------------------------------------------------------

describe('Function parsing', () => {
  it('parses regular function declaration', () => {
    const r = parse(`export function add(a: number, b: number): number { return a + b; }`);
    const fn = r.functions.find(f => f.name === 'add');
    expect(fn).toBeDefined();
    expect(fn!.isAsync).toBe(false);
    expect(fn!.isArrow).toBe(false);
    expect(fn!.isExported).toBe(true);
  });

  it('parses async function', () => {
    const r = parse(`export async function fetchData(url: string): Promise<void> {}`);
    const fn = r.functions.find(f => f.name === 'fetchData');
    expect(fn?.isAsync).toBe(true);
    expect(fn?.returnType).toContain('Promise');
  });

  it('parses arrow function assigned to const', () => {
    const r = parse(`export const double = (n: number): number => n * 2;`);
    const fn = r.functions.find(f => f.name === 'double');
    expect(fn?.isArrow).toBe(true);
    expect(fn?.isExported).toBe(true);
  });

  it('parses async arrow function', () => {
    const r = parse(`const load = async (path: string) => {};`);
    const fn = r.functions.find(f => f.name === 'load');
    expect(fn?.isAsync).toBe(true);
    expect(fn?.isArrow).toBe(true);
  });

  it('extracts parameters with rest and defaults', () => {
    const r = parse(`function greet(name: string, age = 0, ...rest: string[]) {}`);
    const fn = r.functions.find(f => f.name === 'greet')!;
    const paramNames = fn.params.map(p => p.name);
    expect(paramNames).toContain('name');
    expect(paramNames).toContain('age');
    expect(paramNames).toContain('rest');
    expect(fn.params.find(p => p.name === 'age')?.hasDefault).toBe(true);
    expect(fn.params.find(p => p.name === 'rest')?.isRest).toBe(true);
  });

  it('returns no errors on clean input', () => {
    expect(parse(`export function noop(): void {}`).errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Class parsing
// ---------------------------------------------------------------------------

describe('Class parsing', () => {
  const SOURCE = `
/** Service base */
export abstract class BaseService<T> extends EventEmitter implements IDisposable, IService {
  protected name: string;
  constructor(name: string) { super(); this.name = name; }
  abstract start(): Promise<void>;
  static create(): BaseService<unknown> { return null as any; }
}
`.trim();

  it('extracts class name and flags', () => {
    const r = parse(SOURCE);
    const cls = r.classes.find(c => c.name === 'BaseService');
    expect(cls).toBeDefined();
    expect(cls!.isAbstract).toBe(true);
    expect(cls!.isExported).toBe(true);
  });

  it('extracts extends clause', () => {
    const r = parse(SOURCE);
    expect(r.classes.find(c => c.name === 'BaseService')?.extends).toBe('EventEmitter');
  });

  it('extracts implements list', () => {
    const r = parse(SOURCE);
    const cls = r.classes.find(c => c.name === 'BaseService')!;
    expect(cls.implements).toContain('IDisposable');
    expect(cls.implements).toContain('IService');
  });

  it('extracts methods with correct flags', () => {
    const r = parse(SOURCE);
    const cls = r.classes.find(c => c.name === 'BaseService')!;
    const staticCreate = cls.methods.find(m => m.name === 'create');
    expect(staticCreate?.isStatic).toBe(true);
    const abstractStart = cls.methods.find(m => m.name === 'start');
    expect(abstractStart?.isAbstract).toBe(true);
    expect(abstractStart?.isAsync).toBe(false);
  });

  it('captures JSDoc comment', () => {
    const r = parse(SOURCE);
    const cls = r.classes.find(c => c.name === 'BaseService');
    expect(cls?.jsDoc).toContain('Service base');
  });

  it('parses non-exported concrete class', () => {
    const r = parse(`class Helper { private x = 0; }`);
    const cls = r.classes.find(c => c.name === 'Helper');
    expect(cls?.isExported).toBe(false);
    expect(cls?.isAbstract).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Interface & type alias parsing
// ---------------------------------------------------------------------------

describe('Interface and type alias parsing', () => {
  it('parses exported interface', () => {
    const r = parse(`export interface ILogger { log(msg: string): void; }`);
    const iface = r.interfaces.find(i => i.name === 'ILogger');
    expect(iface).toBeDefined();
    expect(iface!.isExported).toBe(true);
  });

  it('parses interface with extends list', () => {
    const r = parse(`export interface IService extends ILogger, IDisposable {}`);
    const iface = r.interfaces.find(i => i.name === 'IService')!;
    expect(iface.extends).toContain('ILogger');
    expect(iface.extends).toContain('IDisposable');
  });

  it('parses non-exported interface', () => {
    const r = parse(`interface Internal { x: number; }`);
    expect(r.interfaces.find(i => i.name === 'Internal')?.isExported).toBe(false);
  });

  it('parses exported type alias', () => {
    const r = parse(`export type Handler = (req: Request) => Response;`);
    expect(r.typeAliases.find(t => t.name === 'Handler')?.isExported).toBe(true);
  });

  it('parses non-exported type alias', () => {
    const r = parse(`type LocalId = string;`);
    expect(r.typeAliases.find(t => t.name === 'LocalId')?.isExported).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Variable parsing
// ---------------------------------------------------------------------------

describe('Variable parsing', () => {
  it('parses exported const', () => {
    const r = parse(`export const MAX_RETRY = 3;`);
    const v = r.variables.find(v => v.name === 'MAX_RETRY');
    expect(v?.kind).toBe('const');
    expect(v?.isExported).toBe(true);
  });

  it('parses let declaration', () => {
    const r = parse(`let counter = 0;`);
    const v = r.variables.find(v => v.name === 'counter');
    expect(v?.kind).toBe('let');
  });

  it('parses var declaration', () => {
    const r = parse(`var legacy: string;`);
    const v = r.variables.find(v => v.name === 'legacy');
    expect(v?.kind).toBe('var');
  });

  it('extracts type annotation when present', () => {
    const r = parse(`const timeout: number = 5000;`);
    expect(r.variables.find(v => v.name === 'timeout')?.type).toContain('number');
  });
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

describe('Metadata', () => {
  it('records line count', () => {
    const r = parse('const a = 1;\nconst b = 2;\n');
    expect(r.metadata.lineCount).toBe(3);
  });

  it('records file size in bytes', () => {
    const content = 'const x = 1;';
    const r = parse(content);
    expect(r.metadata.fileSize).toBe(Buffer.byteLength(content));
  });

  it('records parsedAt as ISO timestamp', () => {
    const r = parse('');
    expect(r.metadata.parsedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  it('handles empty string without throwing', () => {
    expect(() => parse('')).not.toThrow();
  });

  it('handles file with only comments', () => {
    const r = parse('// This is a comment\n/* Block */');
    expect(r.errors).toHaveLength(0);
    expect(r.imports).toHaveLength(0);
    expect(r.functions).toHaveLength(0);
  });

  it('handles multiple classes in one file', () => {
    const r = parse(`
export class Alpha {}
export class Beta {}
export class Gamma {}
    `.trim());
    const names = r.classes.map(c => c.name);
    expect(names).toContain('Alpha');
    expect(names).toContain('Beta');
    expect(names).toContain('Gamma');
  });

  it('does not crash on deeply nested generics', () => {
    const r = parse(`type Deep = Map<string, Array<Promise<Set<number>>>>;`);
    expect(r.typeAliases.find(t => t.name === 'Deep')).toBeDefined();
    expect(r.errors).toHaveLength(0);
  });
});


