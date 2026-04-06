/**
 * Unit tests for cli/src/utils/prompt-loader.ts
 * Satisfies: bd-pf-a4 - Write unit tests for prompt-loader.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Hoist mock before module import
vi.mock('fs');

import { loadPrompt, promptExists, PROMPTS_DIR } from '@cli/utils/prompt-loader';

const mockedExistsSync = vi.mocked(fs.existsSync);
// readFileSync has many overloads – cast to avoid TS overload ambiguity
const mockedReadFileSync = fs.readFileSync as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// PROMPTS_DIR
// ---------------------------------------------------------------------------
describe('PROMPTS_DIR', () => {
  it('is an absolute path', () => {
    expect(path.isAbsolute(PROMPTS_DIR)).toBe(true);
  });

  it('ends with the "prompts" directory segment', () => {
    expect(PROMPTS_DIR.replace(/\\/g, '/')).toMatch(/\/prompts$/);
  });
});

// ---------------------------------------------------------------------------
// promptExists()
// ---------------------------------------------------------------------------
describe('promptExists()', () => {
  it('returns true when the prompt file exists', () => {
    mockedExistsSync.mockReturnValue(true);
    expect(promptExists('logline')).toBe(true);
  });

  it('returns false when the prompt file does not exist', () => {
    mockedExistsSync.mockReturnValue(false);
    expect(promptExists('nonexistent')).toBe(false);
  });

  it('checks the correct file path (step + .txt extension)', () => {
    mockedExistsSync.mockReturnValue(true);
    promptExists('beat-sheet');
    expect(mockedExistsSync).toHaveBeenCalledWith(
      path.join(PROMPTS_DIR, 'beat-sheet.txt'),
    );
  });

  it('handles step names with hyphens', () => {
    mockedExistsSync.mockReturnValue(false);
    promptExists('final-screenplay');
    expect(mockedExistsSync).toHaveBeenCalledWith(
      expect.stringContaining('final-screenplay.txt'),
    );
  });
});

// ---------------------------------------------------------------------------
// loadPrompt()
// ---------------------------------------------------------------------------
describe('loadPrompt()', () => {
  it('throws when the prompt file does not exist', () => {
    mockedExistsSync.mockReturnValue(false);
    expect(() => loadPrompt('unknown-step')).toThrow(
      'Prompt file not found for step "unknown-step"',
    );
  });

  it('returns raw file content when no variables are supplied', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('Hello world');
    expect(loadPrompt('logline')).toBe('Hello world');
  });

  it('substitutes a single {{variable}} placeholder', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('Title: {{title}}');
    expect(loadPrompt('logline', { title: 'My Film' })).toBe('Title: My Film');
  });

  it('substitutes multiple distinct variables', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('{{title}} — {{genre}} ({{tone}})');
    expect(
      loadPrompt('synopsis', { title: 'Inception', genre: 'sci-fi', tone: 'dark' }),
    ).toBe('Inception — sci-fi (dark)');
  });

  it('replaces all occurrences of the same placeholder (global replace)', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('{{title}} is titled {{title}}');
    expect(loadPrompt('logline', { title: 'Dune' })).toBe('Dune is titled Dune');
  });

  it('skips substitution for undefined variable values', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('Title: {{title}} Genre: {{genre}}');
    const result = loadPrompt('logline', { title: 'Film', genre: undefined });
    expect(result).toBe('Title: Film Genre: {{genre}}');
  });

  it('skips substitution for null variable values', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('Tone: {{tone}}');
    const result = loadPrompt('logline', { tone: null });
    expect(result).toBe('Tone: {{tone}}');
  });

  it('coerces numeric variable values to strings', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('Budget: {{budget}}');
    expect(loadPrompt('logline', { budget: 50000 })).toBe('Budget: 50000');
  });

  it('coerces boolean variable values to strings', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('Enabled: {{enabled}}');
    expect(loadPrompt('logline', { enabled: true })).toBe('Enabled: true');
  });

  it('leaves unmatched placeholders intact when variable not supplied', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('Title: {{title}} Audience: {{audience}}');
    const result = loadPrompt('logline', { title: 'Film' });
    expect(result).toContain('{{audience}}');
    expect(result).toContain('Film');
  });

  it('works with default empty variables object (no variables arg)', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('Plain content, no placeholders');
    expect(loadPrompt('logline')).toBe('Plain content, no placeholders');
  });

  it('reads from the correct file path for the given step name', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('content');
    loadPrompt('shot-list', {});
    expect(mockedReadFileSync).toHaveBeenCalledWith(
      path.join(PROMPTS_DIR, 'shot-list.txt'),
      'utf-8',
    );
  });

  it('does not mutate the original variables object', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('{{title}}');
    const vars = { title: 'Immutable' };
    loadPrompt('logline', vars);
    expect(vars.title).toBe('Immutable');
  });
});

