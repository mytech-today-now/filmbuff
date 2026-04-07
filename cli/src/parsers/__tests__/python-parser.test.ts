/**
 * Unit tests – Python Parser  (bd-modinsp.7.1)
 *
 * All tests are pure in-memory (no file I/O).
 * Coverage target: >80% of python-parser.ts
 */

import { describe, it, expect } from '@jest/globals';
import { parsePython } from '../python-parser';

const parse = (content: string) => parsePython('/fixture/module.py', content);

// ---------------------------------------------------------------------------
// Import parsing
// ---------------------------------------------------------------------------

describe('Import parsing', () => {
  it('parses bare import', () => {
    const r = parse(`import os`);
    expect(r.imports.find(i => i.module === 'os')).toBeDefined();
  });

  it('parses bare import with alias', () => {
    const r = parse(`import numpy as np`);
    const imp = r.imports.find(i => i.module === 'numpy');
    expect(imp?.alias).toBe('np');
    expect(imp?.isFrom).toBe(false);
  });

  it('parses multiple bare imports on one line', () => {
    const r = parse(`import os, sys, re`);
    const mods = r.imports.map(i => i.module);
    expect(mods).toContain('os');
    expect(mods).toContain('sys');
    expect(mods).toContain('re');
  });

  it('parses from-import with named symbols', () => {
    const r = parse(`from pathlib import Path, PurePath`);
    const imp = r.imports.find(i => i.module === 'pathlib')!;
    expect(imp.isFrom).toBe(true);
    expect(imp.names).toContain('Path');
    expect(imp.names).toContain('PurePath');
  });

  it('parses from-import star', () => {
    const r = parse(`from os.path import *`);
    const imp = r.imports.find(i => i.module === 'os.path')!;
    expect(imp.isStar).toBe(true);
  });

  it('handles dotted module paths', () => {
    const r = parse(`from xml.etree.ElementTree import parse`);
    expect(r.imports.find(i => i.module === 'xml.etree.ElementTree')).toBeDefined();
  });

  it('records correct line number', () => {
    const r = parse(`\nimport json`);
    expect(r.imports.find(i => i.module === 'json')?.line).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Function parsing
// ---------------------------------------------------------------------------

describe('Function parsing', () => {
  it('parses plain def', () => {
    const r = parse(`def greet(name: str) -> str:\n    return name`);
    const fn = r.functions.find(f => f.name === 'greet');
    expect(fn).toBeDefined();
    expect(fn!.isAsync).toBe(false);
  });

  it('parses async def', () => {
    const r = parse(`async def fetch(url: str) -> None:\n    pass`);
    const fn = r.functions.find(f => f.name === 'fetch')!;
    expect(fn.isAsync).toBe(true);
  });

  it('extracts return type annotation', () => {
    const r = parse(`def compute() -> int:\n    return 0`);
    expect(r.functions.find(f => f.name === 'compute')?.returnType).toBe('int');
  });

  it('extracts positional parameters', () => {
    const r = parse(`def fn(a, b, c):\n    pass`);
    const params = r.functions.find(f => f.name === 'fn')!.params.map(p => p.name);
    expect(params).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('marks parameter with default', () => {
    const r = parse(`def fn(x, y=10):\n    pass`);
    const fn = r.functions.find(f => f.name === 'fn')!;
    expect(fn.params.find(p => p.name === 'y')?.hasDefault).toBe(true);
  });

  it('marks *args parameter', () => {
    const r = parse(`def fn(*args):\n    pass`);
    expect(r.functions.find(f => f.name === 'fn')!.params[0].isRest).toBe(true);
  });

  it('marks **kwargs parameter', () => {
    const r = parse(`def fn(**kwargs):\n    pass`);
    expect(r.functions.find(f => f.name === 'fn')!.params[0].isKwRest).toBe(true);
  });

  it('extracts function docstring', () => {
    const r = parse(`def fn():\n    """Does something.\"\"\"\n    pass`);
    expect(r.functions.find(f => f.name === 'fn')?.docstring).toContain('Does something.');
  });

  it('extracts decorator names', () => {
    const r = parse(`@cache\ndef expensive():\n    pass`);
    const decorators = r.functions.find(f => f.name === 'expensive')?.decorators ?? [];
    expect(decorators.map(d => d.name)).toContain('cache');
  });

  it('records correct line number', () => {
    const r = parse(`\ndef fn():\n    pass`);
    expect(r.functions.find(f => f.name === 'fn')?.line).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Class parsing
// ---------------------------------------------------------------------------

describe('Class parsing', () => {
  const SOURCE = `
class Animal:
    """Base animal class."""
    sound: str = ""

    def __init__(self, name: str) -> None:
        self.name = name

    @staticmethod
    def kingdom() -> str:
        return "Animalia"

    @classmethod
    def from_name(cls, name: str) -> 'Animal':
        return cls(name)

    @property
    def label(self) -> str:
        return self.name
`.trim();

  it('extracts class name', () => {
    expect(parse(SOURCE).classes.find(c => c.name === 'Animal')).toBeDefined();
  });

  it('extracts class docstring', () => {
    expect(parse(SOURCE).classes.find(c => c.name === 'Animal')?.docstring).toContain('Base animal class');
  });

  it('extracts class variable', () => {
    const cls = parse(SOURCE).classes.find(c => c.name === 'Animal')!;
    expect(cls.classVars.map(v => v.name)).toContain('sound');
  });

  it('extracts methods', () => {
    const cls = parse(SOURCE).classes.find(c => c.name === 'Animal')!;
    const names = cls.methods.map(m => m.name);
    expect(names).toContain('__init__');
    expect(names).toContain('kingdom');
    expect(names).toContain('from_name');
    expect(names).toContain('label');
  });

  it('marks @staticmethod', () => {
    const cls = parse(SOURCE).classes.find(c => c.name === 'Animal')!;
    expect(cls.methods.find(m => m.name === 'kingdom')?.isStatic).toBe(true);
  });

  it('marks @classmethod', () => {
    const cls = parse(SOURCE).classes.find(c => c.name === 'Animal')!;
    expect(cls.methods.find(m => m.name === 'from_name')?.isClassMethod).toBe(true);
  });

  it('marks @property', () => {
    const cls = parse(SOURCE).classes.find(c => c.name === 'Animal')!;
    expect(cls.methods.find(m => m.name === 'label')?.isProperty).toBe(true);
  });

  it('extracts class bases', () => {
    const r = parse(`class Dog(Animal, Serializable):\n    pass`);
    const bases = r.classes.find(c => c.name === 'Dog')!.bases;
    expect(bases).toContain('Animal');
    expect(bases).toContain('Serializable');
  });
});

// ---------------------------------------------------------------------------
// Variable parsing
// ---------------------------------------------------------------------------

describe('Variable (top-level) parsing', () => {
  it('parses simple assignment', () => {
    const r = parse(`DEBUG = True`);
    expect(r.variables.find(v => v.name === 'DEBUG')).toBeDefined();
  });

  it('parses annotated assignment', () => {
    const r = parse(`MAX_RETRIES: int = 5`);
    const v = r.variables.find(v => v.name === 'MAX_RETRIES')!;
    expect(v.annotation).toBe('int');
  });

  it('does not include class or function definitions as variables', () => {
    const r = parse(`class Foo:\n    pass\ndef bar():\n    pass\nX = 1`);
    const names = r.variables.map(v => v.name);
    expect(names).not.toContain('Foo');
    expect(names).not.toContain('bar');
    expect(names).toContain('X');
  });

  it('skips import statements', () => {
    const r = parse(`import os\nfrom sys import argv\nPATH = os.getcwd()`);
    const varNames = r.variables.map(v => v.name);
    expect(varNames).not.toContain('os');
    expect(varNames).toContain('PATH');
  });
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

describe('Metadata', () => {
  it('detects __dunder__ variables', () => {
    const r = parse(`__version__ = '1.0.0'\n__author__ = 'me'`);
    expect(r.metadata.hasDunder).toBe(true);
  });

  it('hasDunder is false when no dunders', () => {
    expect(parse(`x = 1`).metadata.hasDunder).toBe(false);
  });

  it('records line count', () => {
    expect(parse('a = 1\nb = 2\n').metadata.lineCount).toBe(3);
  });

  it('records file size', () => {
    const content = 'x = 1';
    expect(parse(content).metadata.fileSize).toBe(Buffer.byteLength(content));
  });

  it('sets pythonVersion to "3"', () => {
    expect(parse('').metadata.pythonVersion).toBe('3');
  });

  it('records parsedAt as ISO timestamp', () => {
    expect(parse('').metadata.parsedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
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
    const r = parse(`# just a comment\n# another`);
    expect(r.errors).toHaveLength(0);
    expect(r.imports).toHaveLength(0);
    expect(r.functions).toHaveLength(0);
    expect(r.classes).toHaveLength(0);
  });

  it('handles multiple top-level functions', () => {
    const r = parse(`def a(): pass\ndef b(): pass\ndef c(): pass`);
    const names = r.functions.map(f => f.name);
    expect(names).toContain('a');
    expect(names).toContain('b');
    expect(names).toContain('c');
  });

  it('returns no errors on clean input', () => {
    const r = parse(`import os\ndef main():\n    os.getcwd()\n\nif __name__ == '__main__':\n    main()`);
    expect(r.errors).toHaveLength(0);
  });

  it('does not mix class methods with top-level functions', () => {
    const r = parse(`class Foo:\n    def method(self): pass\n\ndef toplevel(): pass`);
    expect(r.functions.find(f => f.name === 'toplevel')).toBeDefined();
    expect(r.functions.find(f => f.name === 'method')).toBeUndefined();
    expect(r.classes[0].methods.find(m => m.name === 'method')).toBeDefined();
  });
});
