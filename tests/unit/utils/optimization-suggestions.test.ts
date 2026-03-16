import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { TestEnvironment } from '@tests/helpers/test-env';
import { extractModuleMetadata, listModuleFiles } from '@cli/utils/module-system';
import { generateOptimizationSuggestions } from '@cli/utils/optimization-suggestions';

describe('optimization-suggestions', () => {
  let testEnv: TestEnvironment;

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    await testEnv.setup();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('generates ranked suggestions across performance, quality, and security', async () => {
    const module = await testEnv.createModule({
      name: 'optimization-module',
      withRules: true,
      withExamples: false,
      tags: []
    });

    await mkdir(path.join(module.path, 'rules'), { recursive: true });
    await writeFile(path.join(module.path, 'README.md'), '# Module\n\n' + 'guidance '.repeat(2500));
    await writeFile(path.join(module.path, 'rules', 'auth.md'), '# Auth\n\nUse API_KEY and TOKEN values for local auth flows.');

    const metadata = extractModuleMetadata(module.path);
    expect(metadata).toBeTruthy();

    const suggestions = generateOptimizationSuggestions(
      module as any,
      metadata!,
      listModuleFiles(module.path, { recursive: true, groupByDirectory: true })
    );

    expect(suggestions.length).toBeGreaterThanOrEqual(3);
    expect(suggestions[0].impact).toBe('high');
    expect(suggestions.map(suggestion => suggestion.category)).toEqual(
      expect.arrayContaining(['performance', 'quality', 'security'])
    );
    expect(suggestions.every(suggestion => suggestion.codeExample.length > 0)).toBe(true);
  });
});