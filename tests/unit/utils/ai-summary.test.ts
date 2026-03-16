import { afterEach, describe, expect, it } from 'vitest';
import {
  clearAISummaryCache,
  generateAISummary,
  generateModuleSummary
} from '@cli/utils/ai-summary';
import type { Module } from '@cli/utils/module-system';
import { tmpdir } from 'os';
import path from 'path';

const cacheDirectory = path.join(tmpdir(), 'filmbuff-ai-summary-tests');

const testModule = {
  fullName: 'coding-standards/test-module',
  path: cacheDirectory,
  rules: ['Prefer deterministic output'],
  examples: ['example.ts'],
  metadata: {
    name: 'test-module',
    version: '2.0.0',
    displayName: 'Test Module',
    description: 'A module for AI summary tests',
    type: 'coding-standards',
    tags: ['test'],
    augment: { characterCount: 2048 }
  }
} as Module;

afterEach(() => {
  clearAISummaryCache(cacheDirectory);
});

describe('ai-summary', () => {
  it('caches generated summaries', () => {
    const config = { ai: { summaryCache: { directory: cacheDirectory, ttlSeconds: 60, retryAttempts: 0 } } };
    const first = generateAISummary(testModule, { format: 'compact', config });
    const second = generateAISummary(testModule, { format: 'compact', config });

    expect(first.source).toBe('generated');
    expect(second.source).toBe('cache');
    expect(second.metadata.cacheHit).toBe(true);
  });

  it('falls back with retry metadata when generation fails', () => {
    const brokenModule = {
      ...testModule,
      metadata: {
        ...testModule.metadata,
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
    const summary = generateModuleSummary(testModule);
    expect(summary.name).toBe('coding-standards/test-module');
    expect(summary.exampleCount).toBe(1);
  });
});