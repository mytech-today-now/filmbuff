/**
 * Unit tests – Inspection Formatters  (bd-modinsp.7.1)
 *
 * Covers:
 *   - InspectionJsonFormatter: format(), normalize(), createStream(), section filtering, maxFiles
 *   - InspectionTextFormatter: format(), section filtering, colorize=false, compact mode
 *
 * All tests are pure in-memory (no file I/O, no disk).
 * Coverage target: >80% of inspection-json-formatter.ts and inspection-text-formatter.ts
 */

import { describe, it, expect } from '@jest/globals';
import { Readable } from 'stream';
import { InspectionJsonFormatter, InspectionInput, InspectionResult } from '../inspection-json-formatter';
import { InspectionTextFormatter } from '../inspection-text-formatter';
import { InspectionMarkdownFormatter } from '../inspection-markdown-formatter';
import type { Module } from '../../module-system';
import type { ExtendedModuleMetadata, FileInfo } from '../../module-system';

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

function makeModule(): Module {
  return {
    metadata: {
      name: 'test-module',
      version: '2.1.0',
      displayName: 'Test Module',
      description: 'A module used in unit tests.',
      type: 'coding-standards',
      tags: ['typescript', 'testing'],
    },
    path: '/augment-extensions/test-module',
    fullName: 'test-module@2.1.0',
    rules: [],
    examples: [],
  } as unknown as Module;
}

function makeMetadata(): ExtendedModuleMetadata {
  return {
    files: { total: 6, rules: 3, examples: 2, other: 1 },
    size: { totalBytes: 48200, totalCharacters: 47800 },
    lastModified: new Date('2026-01-15T12:00:00Z'),
  } as unknown as ExtendedModuleMetadata;
}

function makeFiles(count = 3): FileInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    relativePath: `rules/rule-${i + 1}.md`,
    name: `rule-${i + 1}.md`,
    type: 'rules',
    size: 1024 * (i + 1),
    modified: new Date(`2026-01-${String(i + 10).padStart(2, '0')}T10:00:00Z`),
    extension: '.md',
    directory: 'rules',
  })) as unknown as FileInfo[];
}

function makeInput(fileCount = 3): InspectionInput {
  return {
    module: makeModule(),
    metadata: makeMetadata(),
    files: makeFiles(fileCount),
    recommendations: [
      {
        id: 'rec-001',
        priority: 'high',
        title: 'Consolidate rule files',
        summary: 'Merge related rules into fewer files for easier maintenance.',
        rationale: 'Reduces cognitive load.',
        steps: ['Identify duplicate rules', 'Merge into single file'],
        metrics: ['3 files → 1 file', '30% smaller'],
        targetPath: 'rules/',
      },
    ],
    optimizationSuggestions: [
      {
        id: 'opt-001',
        category: 'performance',
        impact: 'medium',
        title: 'Enable rule caching',
        summary: 'Cache parsed rules to reduce repeated disk reads.',
        rationale: 'Rules change infrequently.',
        steps: ['Implement LRU cache', 'Invalidate on file change'],
        metrics: ['50% faster cold start'],
        codeExample: 'const cache = new LRUCache({ max: 100 });',
        exampleLanguage: 'typescript',
        targetPath: 'src/parser.ts',
      },
    ],
  } as unknown as InspectionInput;
}

// ===========================================================================
// InspectionJsonFormatter
// ===========================================================================

describe('InspectionJsonFormatter.normalize()', () => {
  const fmt = new InspectionJsonFormatter();

  it('sets schema to "1.0"', () => {
    expect(fmt.normalize(makeInput()).schema).toBe('1.0');
  });

  it('sets generatedAt as an ISO timestamp', () => {
    expect(fmt.normalize(makeInput()).generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('populates module fields correctly', () => {
    const r = fmt.normalize(makeInput());
    expect(r.module.name).toBe('test-module');
    expect(r.module.version).toBe('2.1.0');
    expect(r.module.type).toBe('coding-standards');
    expect(r.module.tags).toContain('typescript');
  });

  it('populates metadata counts', () => {
    const r = fmt.normalize(makeInput());
    expect(r.metadata.totalFiles).toBe(6);
    expect(r.metadata.rules).toBe(3);
    expect(r.metadata.examples).toBe(2);
    expect(r.metadata.totalBytes).toBe(48200);
  });

  it('populates files array', () => {
    const r = fmt.normalize(makeInput(3));
    expect(r.files).toHaveLength(3);
    expect(r.files[0].relativePath).toBe('rules/rule-1.md');
    expect(r.files[0].type).toBe('rules');
  });

  it('populates recommendations', () => {
    const r = fmt.normalize(makeInput());
    expect(r.recommendations).toHaveLength(1);
    expect(r.recommendations[0].id).toBe('rec-001');
    expect(r.recommendations[0].priority).toBe('high');
  });

  it('populates optimizations', () => {
    const r = fmt.normalize(makeInput());
    expect(r.optimizations).toHaveLength(1);
    expect(r.optimizations[0].category).toBe('performance');
  });

  it('converts Date modified to ISO string', () => {
    const r = fmt.normalize(makeInput(1));
    expect(r.files[0].modified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('converts lastModified to ISO string', () => {
    expect(fmt.normalize(makeInput()).metadata.lastModified).toBe('2026-01-15T12:00:00.000Z');
  });
});

describe('InspectionJsonFormatter.normalize() – section filtering', () => {
  const fmt = new InspectionJsonFormatter();

  it('returns empty files array when "files" section excluded', () => {
    const r = fmt.normalize(makeInput(), { sections: ['module', 'metadata'] });
    expect(r.files).toHaveLength(0);
  });

  it('returns empty recommendations when "recommendations" excluded', () => {
    const r = fmt.normalize(makeInput(), { sections: ['module', 'metadata', 'files'] });
    expect(r.recommendations).toHaveLength(0);
  });

  it('returns all sections when sections=[] (default)', () => {
    const r = fmt.normalize(makeInput(2), { sections: [] });
    expect(r.files.length).toBeGreaterThan(0);
    expect(r.recommendations.length).toBeGreaterThan(0);
  });
});

describe('InspectionJsonFormatter.format()', () => {
  const fmt = new InspectionJsonFormatter();

  it('returns valid JSON', () => {
    const json = fmt.format(makeInput());
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('default indent is 2 spaces', () => {
    const json = fmt.format(makeInput());
    expect(json).toContain('\n  "schema"');
  });

  it('produces compact JSON when indent=0', () => {
    const json = fmt.format(makeInput(), { indent: 0 });
    expect(json.startsWith('{')).toBe(true);
    expect(json).not.toContain('\n  ');
  });

  it('produces 4-space indent when indent=4', () => {
    const json = fmt.format(makeInput(), { indent: 4 });
    expect(json).toContain('\n    "schema"');
  });

  it('parsed output has correct schema version', () => {
    const parsed: InspectionResult = JSON.parse(fmt.format(makeInput()));
    expect(parsed.schema).toBe('1.0');
  });

  it('section filtering works via format()', () => {
    const json = fmt.format(makeInput(), { sections: ['module'] });
    const parsed: InspectionResult = JSON.parse(json);
    expect(parsed.files).toHaveLength(0);
    expect(parsed.recommendations).toHaveLength(0);
  });

  it('maxFiles limits serialised file list', () => {
    const json = fmt.format(makeInput(20), { maxFiles: 5 });
    const parsed: InspectionResult = JSON.parse(json);
    expect(parsed.files).toHaveLength(5);
  });

  it('includes all 5 top-level keys', () => {
    const parsed: InspectionResult = JSON.parse(fmt.format(makeInput()));
    expect(parsed).toHaveProperty('schema');
    expect(parsed).toHaveProperty('generatedAt');
    expect(parsed).toHaveProperty('module');
    expect(parsed).toHaveProperty('metadata');
    expect(parsed).toHaveProperty('files');
    expect(parsed).toHaveProperty('recommendations');
    expect(parsed).toHaveProperty('optimizations');
  });
});

describe('InspectionJsonFormatter.createStream()', () => {
  const fmt = new InspectionJsonFormatter();

  it('returns a Readable stream', () => {
    const stream = fmt.createStream(makeInput());
    expect(stream).toBeInstanceOf(Readable);
  });

  it('stream concatenates to valid JSON', async () => {
    const stream = fmt.createStream(makeInput());
    const chunks: string[] = [];
    for await (const chunk of stream) chunks.push(String(chunk));
    const json = chunks.join('');
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('stream JSON schema is "1.0"', async () => {
    const stream = fmt.createStream(makeInput());
    const chunks: string[] = [];
    for await (const chunk of stream) chunks.push(String(chunk));
    const parsed: InspectionResult = JSON.parse(chunks.join(''));
    expect(parsed.schema).toBe('1.0');
  });

  it('stream emits multiple chunks for multi-file input', async () => {
    const stream = fmt.createStream(makeInput(5));
    const chunks: string[] = [];
    for await (const chunk of stream) chunks.push(String(chunk));
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('compact stream (indent=0) is valid JSON', async () => {
    const stream = fmt.createStream(makeInput(2), { indent: 0 });
    const chunks: string[] = [];
    for await (const chunk of stream) chunks.push(String(chunk));
    expect(() => JSON.parse(chunks.join(''))).not.toThrow();
  });
});

// ===========================================================================
// InspectionTextFormatter
// ===========================================================================

describe('InspectionTextFormatter.format()', () => {
  const fmt = new InspectionTextFormatter();
  const opts = { colorize: false } as const;

  it('returns a non-empty string', () => {
    expect(fmt.format(makeInput(), opts).length).toBeGreaterThan(0);
  });

  it('contains module name in header', () => {
    expect(fmt.format(makeInput(), opts)).toContain('test-module');
  });

  it('contains summary counts', () => {
    const text = fmt.format(makeInput(), opts);
    expect(text).toContain('Total files');
    expect(text).toContain('6');
  });

  it('contains file paths', () => {
    const text = fmt.format(makeInput(2), opts);
    expect(text).toContain('rule-1.md');
    expect(text).toContain('rule-2.md');
  });

  it('contains recommendation title', () => {
    const text = fmt.format(makeInput(), opts);
    expect(text).toContain('Consolidate rule files');
  });

  it('contains recommendation priority label', () => {
    const text = fmt.format(makeInput(), opts);
    expect(text).toContain('[HIGH]');
  });

  it('contains optimization title', () => {
    const text = fmt.format(makeInput(), opts);
    expect(text).toContain('Enable rule caching');
  });

  it('contains optimization impact label', () => {
    const text = fmt.format(makeInput(), opts);
    expect(text).toContain('[MEDIUM]');
  });

  it('section filter – only header and summary', () => {
    const text = fmt.format(makeInput(), { colorize: false, sections: ['header', 'summary'] });
    expect(text).toContain('test-module');
    expect(text).toContain('Total files');
    expect(text).not.toContain('rule-1.md');
    expect(text).not.toContain('Consolidate');
  });

  it('section filter – only files', () => {
    const text = fmt.format(makeInput(1), { colorize: false, sections: ['files'] });
    expect(text).toContain('rule-1.md');
    expect(text).not.toContain('Total files');
  });

  it('section filter – only recommendations', () => {
    const text = fmt.format(makeInput(), { colorize: false, sections: ['recommendations'] });
    expect(text).toContain('Consolidate rule files');
    expect(text).not.toContain('Enable rule caching');
  });

  it('section filter – only optimizations', () => {
    const text = fmt.format(makeInput(), { colorize: false, sections: ['optimizations'] });
    expect(text).toContain('Enable rule caching');
    expect(text).not.toContain('Consolidate rule files');
  });

  it('maxFiles limits file list', () => {
    const text = fmt.format(makeInput(10), { colorize: false, maxFiles: 2 });
    expect(text).toContain('rule-1.md');
    expect(text).not.toContain('rule-5.md');
  });

  it('compact mode does not show per-file paths', () => {
    const text = fmt.format(makeInput(3), { colorize: false, compact: true });
    expect(text).not.toContain('rule-1.md');
    expect(text).toContain('rules');  // aggregated by type
  });

  it('no ANSI codes when colorize=false', () => {
    const text = fmt.format(makeInput(), { colorize: false });
    expect(text).not.toContain('\x1b[');
  });

  it('ANSI codes present when colorize=true', () => {
    const text = fmt.format(makeInput(), { colorize: true });
    expect(text).toContain('\x1b[');
  });

  it('handles empty recommendations gracefully', () => {
    const input = { ...makeInput(), recommendations: [] };
    const text = fmt.format(input as unknown as typeof input, { colorize: false });
    expect(text).toContain('No recommendations');
  });

  it('handles empty optimizations gracefully', () => {
    const input = { ...makeInput(), optimizationSuggestions: [] };
    const text = fmt.format(input as unknown as typeof input, { colorize: false });
    expect(text).toContain('No optimization suggestions');
  });

  it('handles zero files gracefully', () => {
    const text = fmt.format(makeInput(0), { colorize: false });
    expect(text.length).toBeGreaterThan(0);
  });
});
describe('InspectionJsonFormatter.normalize() – maxFiles', () => {
  const fmt = new InspectionJsonFormatter();

  it('limits files via maxFiles', () => {
    const r = fmt.normalize(makeInput(10), { maxFiles: 4 });
    expect(r.files).toHaveLength(4);
  });
});

// ===========================================================================
// InspectionMarkdownFormatter
// ===========================================================================

describe('InspectionMarkdownFormatter.format()', () => {
  const fmt = new InspectionMarkdownFormatter();

  it('returns a non-empty string', () => {
    expect(fmt.format(makeInput()).length).toBeGreaterThan(0);
  });

  it('contains module name in header', () => {
    expect(fmt.format(makeInput())).toContain('test-module');
  });

  it('contains summary table heading', () => {
    expect(fmt.format(makeInput())).toContain('## Summary');
  });

  it('contains summary table rows with metric values', () => {
    const md = fmt.format(makeInput());
    expect(md).toContain('Total files');
    expect(md).toContain('| 6 |');
  });

  it('contains dependency-tree Mermaid code block', () => {
    const md = fmt.format(makeInput(2));
    expect(md).toContain('```mermaid');
    expect(md).toContain('graph TD');
    expect(md).toContain('```');
  });

  it('dependency-tree contains module node', () => {
    const md = fmt.format(makeInput(1));
    expect(md).toContain('test-module');
    expect(md).toContain('-->');
  });

  it('contains Files section', () => {
    expect(fmt.format(makeInput())).toContain('## Files');
  });

  it('file table rows contain relative paths', () => {
    const md = fmt.format(makeInput(2));
    expect(md).toContain('rule-1.md');
    expect(md).toContain('rule-2.md');
  });

  it('contains Refactoring Recommendations heading', () => {
    expect(fmt.format(makeInput())).toContain('## Refactoring Recommendations');
  });

  it('recommendations table contains priority and title', () => {
    const md = fmt.format(makeInput());
    expect(md).toContain('**HIGH**');
    expect(md).toContain('Consolidate rule files');
  });

  it('contains Optimization Suggestions heading', () => {
    expect(fmt.format(makeInput())).toContain('## Optimization Suggestions');
  });

  it('optimization block contains category and impact labels', () => {
    const md = fmt.format(makeInput());
    expect(md).toContain('`performance`');
    expect(md).toContain('`medium`');
  });

  it('optimization block contains code block with language hint', () => {
    const md = fmt.format(makeInput());
    expect(md).toContain('```typescript');
    expect(md).toContain('LRUCache');
  });

  it('section filter – only header', () => {
    const md = fmt.format(makeInput(), { sections: ['header'] });
    expect(md).toContain('test-module');
    expect(md).not.toContain('## Summary');
    expect(md).not.toContain('## Files');
    expect(md).not.toContain('## Refactoring Recommendations');
  });

  it('section filter – only summary', () => {
    const md = fmt.format(makeInput(), { sections: ['summary'] });
    expect(md).toContain('## Summary');
    expect(md).not.toContain('## Files');
    expect(md).not.toContain('```mermaid');
  });

  it('section filter – only files', () => {
    const md = fmt.format(makeInput(1), { sections: ['files'] });
    expect(md).toContain('## Files');
    expect(md).toContain('rule-1.md');
    expect(md).not.toContain('## Summary');
  });

  it('section filter – only dependency-tree', () => {
    const md = fmt.format(makeInput(1), { sections: ['dependency-tree'] });
    expect(md).toContain('```mermaid');
    expect(md).not.toContain('## Files');
    expect(md).not.toContain('## Summary');
  });

  it('section filter – only recommendations', () => {
    const md = fmt.format(makeInput(), { sections: ['recommendations'] });
    expect(md).toContain('Consolidate rule files');
    expect(md).not.toContain('Enable rule caching');
  });

  it('section filter – only optimizations', () => {
    const md = fmt.format(makeInput(), { sections: ['optimizations'] });
    expect(md).toContain('Enable rule caching');
    expect(md).not.toContain('Consolidate rule files');
  });

  it('maxFiles limits the file table rows', () => {
    // makeInput(10) creates rule-1.md…rule-10.md.
    // maxFiles:2 keeps only rule-1 and rule-2 in the Files table.
    // The Mermaid tree independently shows up to 5 files per dir, so rule-6 onwards
    // are absent from BOTH the diagram AND the table – use rule-6 as the guard.
    const md = fmt.format(makeInput(10), { maxFiles: 2 });
    expect(md).toContain('rule-1.md');
    expect(md).toContain('rule-2.md');
    expect(md).not.toContain('rule-6.md');
    expect(md).toContain('more file(s) not shown');
  });

  it('handles empty recommendations gracefully', () => {
    const input = { ...makeInput(), recommendations: [] };
    const md = fmt.format(input as unknown as typeof input);
    expect(md).toContain('No immediate refactoring recommendations');
  });

  it('handles empty optimizations gracefully', () => {
    const input = { ...makeInput(), optimizationSuggestions: [] };
    const md = fmt.format(input as unknown as typeof input);
    expect(md).toContain('No immediate optimization suggestions');
  });

  it('handles zero files gracefully', () => {
    const md = fmt.format(makeInput(0));
    expect(md.length).toBeGreaterThan(0);
    expect(md).toContain('## Files');
  });

  it('output is valid Markdown (ends with newline)', () => {
    const md = fmt.format(makeInput());
    expect(md.endsWith('\n')).toBe(true);
  });

  it('does not contain raw ANSI escape codes', () => {
    const md = fmt.format(makeInput());
    expect(md).not.toContain('\x1b[');
  });
});
