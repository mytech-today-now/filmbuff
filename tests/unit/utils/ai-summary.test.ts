import * as fs from 'fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearAISummaryCache,
  generateAISummary,
  generateModuleSummary
} from '@cli/utils/ai-summary';
import type { Module } from '@cli/utils/module-system';
import { tmpdir } from 'os';
import path from 'path';

const cacheDirectory = path.join(tmpdir(), 'filmbuff-ai-summary-cache-tests');
const moduleDirectory = path.join(tmpdir(), 'filmbuff-ai-summary-module-tests');

function createTestModule(
  description: string = 'A module for AI summary tests',
  modulePath: string = moduleDirectory
): Module {
  return {
    fullName: 'coding-standards/test-module',
    path: modulePath,
    rules: ['Prefer deterministic output'],
    examples: ['example.ts'],
    metadata: {
      name: 'test-module',
      version: '2.0.0',
      displayName: 'Test Module',
      description,
      type: 'coding-standards',
      tags: ['test'],
      augment: { characterCount: 2048 }
    }
  } as Module;
}

afterEach(() => {
  clearAISummaryCache(cacheDirectory);
  fs.rmSync(moduleDirectory, { recursive: true, force: true });
});

function writeModuleFixture(description: string, readmeText: string): void {
  fs.rmSync(moduleDirectory, { recursive: true, force: true });
  fs.mkdirSync(path.join(moduleDirectory, 'rules'), { recursive: true });
  fs.mkdirSync(path.join(moduleDirectory, 'examples'), { recursive: true });

  fs.writeFileSync(
    path.join(moduleDirectory, 'module.json'),
    JSON.stringify({
      name: 'test-module',
      version: '2.0.0',
      displayName: 'Test Module',
      description,
      type: 'coding-standards',
      tags: ['test'],
      augment: { characterCount: 2048 }
    }, null, 2)
  );

  fs.writeFileSync(path.join(moduleDirectory, 'README.md'), readmeText);
  fs.writeFileSync(
    path.join(moduleDirectory, 'rules', 'prefer-deterministic-output.md'),
    'Prefer deterministic output.\n'
  );
  fs.writeFileSync(path.join(moduleDirectory, 'examples', 'example.ts'), 'console.log("example");\n');
}

describe('ai-summary', () => {
  it('caches generated summaries', () => {
    const config = { ai: { summaryCache: { directory: cacheDirectory, ttlSeconds: 60, retryAttempts: 0 } } };
    const testModule = createTestModule();
    const first = generateAISummary(testModule, { format: 'compact', config });
    const second = generateAISummary(testModule, { format: 'compact', config });

    expect(first.source).toBe('generated');
    expect(second.source).toBe('cache');
    expect(second.metadata.cacheHit).toBe(true);
  });

  it('regenerates summaries when only the description changes', () => {
    const config = { ai: { summaryCache: { directory: cacheDirectory, ttlSeconds: 60, retryAttempts: 0 } } };
    const first = generateAISummary(createTestModule(), { format: 'compact', config });
    const second = generateAISummary(createTestModule('An updated description for the module'), {
      format: 'compact',
      config
    });

    expect(first.source).toBe('generated');
    expect(second.source).toBe('generated');
    expect(second.metadata.cacheHit).toBe(false);
    expect(second.metadata.cacheKey).not.toBe(first.metadata.cacheKey);
    expect(second.content).not.toBe(first.content);
  });

  it('keeps includeContent toggles distinct', () => {
    const config = { ai: { summaryCache: { directory: cacheDirectory, ttlSeconds: 60, retryAttempts: 0 } } };
    const withoutContent = generateAISummary(createTestModule(), {
      format: 'detailed',
      includeContent: false,
      config
    });
    const withContent = generateAISummary(createTestModule(), {
      format: 'detailed',
      includeContent: true,
      config
    });

    expect(withoutContent.source).toBe('generated');
    expect(withContent.source).toBe('generated');
    expect(withContent.metadata.cacheKey).not.toBe(withoutContent.metadata.cacheKey);
    expect(withContent.content).not.toBe(withoutContent.content);
    expect(withContent.content).toContain('## Content Preview');
    expect(withContent.content).toContain('No content preview available.');
  });

  it('invalidates cached summaries when module files change on disk', () => {
    const config = { ai: { summaryCache: { directory: cacheDirectory, ttlSeconds: 60, retryAttempts: 0 } } };

    writeModuleFixture('A module for AI summary tests', '# Module\n\nInitial README content.\n');

    const module = createTestModule('A module for AI summary tests', moduleDirectory);
    const first = generateAISummary(module, {
      format: 'detailed',
      includeContent: true,
      config
    });

    fs.writeFileSync(
      path.join(moduleDirectory, 'README.md'),
      '# Module\n\nUpdated README content.\n'
    );

    const second = generateAISummary(module, {
      format: 'detailed',
      includeContent: true,
      config
    });

    expect(first.source).toBe('generated');
    expect(second.source).toBe('generated');
    expect(second.metadata.cacheHit).toBe(false);
    expect(second.metadata.cacheKey).not.toBe(first.metadata.cacheKey);
    expect(second.content).toContain('Updated README content.');
    expect(second.content).not.toBe(first.content);
  });

  it('regenerates expired cache entries', () => {
    const config = { ai: { summaryCache: { directory: cacheDirectory, ttlSeconds: 60, retryAttempts: 0 } } };
    const testModule = createTestModule();
    const first = generateAISummary(testModule, { format: 'compact', config });
    const cacheFilePath = path.join(cacheDirectory, `${first.metadata.cacheKey}.json`);
    const cachedEntry = JSON.parse(fs.readFileSync(cacheFilePath, 'utf-8')) as {
      format: string;
      content: string;
      createdAt: string;
      expiresAt: number;
    };

    fs.writeFileSync(
      cacheFilePath,
      JSON.stringify({
        ...cachedEntry,
        expiresAt: Date.now() - 1000
      }, null, 2)
    );

    const second = generateAISummary(testModule, { format: 'compact', config });

    expect(second.source).toBe('generated');
    expect(second.metadata.cacheHit).toBe(false);
    expect(second.metadata.cacheKey).toBe(first.metadata.cacheKey);
  });

  it('falls back with retry metadata when generation fails', () => {
    const brokenModule = {
      ...createTestModule(),
      metadata: {
        ...createTestModule().metadata,
        get description() {
          throw new Error('summary failure');
        }
      }
    } as unknown as Module;

    const result = generateAISummary(brokenModule, {
      format: 'compact',
      retryAttempts: 1,
      config: { ai: { summaryCache: { enabled: false } } }
    });

    expect(result.source).toBe('fallback');
    expect(result.metadata.fallbackUsed).toBe(true);
    expect(result.metadata.retryable).toBe(true);
    expect(result.metadata.attempts).toBe(2);
    expect(result.metadata.errors[0]).toContain('summary failure');
  });

  it('keeps the legacy module summary helper intact', () => {
    const summary = generateModuleSummary(createTestModule());
    expect(summary.name).toBe('coding-standards/test-module');
    expect(summary.exampleCount).toBe(1);
  });
});
