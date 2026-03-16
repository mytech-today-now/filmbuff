import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { TestEnvironment } from '@tests/helpers/test-env';
import { extractModuleMetadata, listModuleFiles } from '@cli/utils/module-system';
import { generateRefactoringRecommendations } from '@cli/utils/refactoring-recommendations';

describe('refactoring-recommendations', () => {
  let testEnv: TestEnvironment;

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    await testEnv.setup();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('prioritizes missing examples and oversized documents', async () => {
    const module = await testEnv.createModule({ name: 'recommend-module', withRules: true, withExamples: false });
    await mkdir(path.join(module.path, 'rules'), { recursive: true });
    await writeFile(path.join(module.path, 'README.md'), '# Big README\n\n' + 'content '.repeat(4000));

    const metadata = extractModuleMetadata(module.path);
    expect(metadata).toBeTruthy();

    const recommendations = generateRefactoringRecommendations(
      module as any,
      metadata!,
      listModuleFiles(module.path, { recursive: true, groupByDirectory: true })
    );

    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations[0].priority).toBe('high');
    expect(recommendations.some(rec => rec.id === 'add-examples')).toBe(true);
    expect(recommendations.some(rec => rec.id === 'split-large-documents')).toBe(true);
  });
});