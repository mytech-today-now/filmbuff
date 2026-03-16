import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import { writeFile } from 'fs/promises';
import path from 'path';
import { TestEnvironment } from '@tests/helpers/test-env';
import { extractModuleMetadata, listModuleFiles } from '@cli/utils/module-system';
import { generateInspectionReport } from '@cli/utils/inspection-report';
import type { OptimizationSuggestion } from '@cli/utils/optimization-suggestions';

describe('inspection-report', () => {
  let testEnv: TestEnvironment;

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    await testEnv.setup();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('creates an interactive html inspection report', async () => {
    const module = await testEnv.createModule({ name: 'report-module', withRules: true, withExamples: true });
    await writeFile(path.join(module.path, 'docs.md'), '# Extra Docs\n\nSome detail.');

    const metadata = extractModuleMetadata(module.path);
    expect(metadata).toBeTruthy();

    const result = generateInspectionReport({
      module: module as any,
      metadata: metadata!,
      files: listModuleFiles(module.path, { recursive: true, groupByDirectory: true }),
      recommendations: [{
        id: 'r1',
        priority: 'high',
        title: 'Add examples',
        summary: 'Examples are valuable.',
        rationale: 'Improves learnability.',
        steps: ['Create examples/', 'Link it from README'],
        metrics: ['Examples: 1'],
        targetPath: module.path
      }],
      optimizationSuggestions: [{
        id: 'o1',
        category: 'security',
        impact: 'high',
        title: 'Add redaction guidance',
        summary: 'Show developers how to avoid leaking secrets.',
        rationale: 'Sensitive examples should always use placeholders.',
        steps: ['Add a security note', 'Use fake credentials'],
        metrics: ['Sensitive references: 2'],
        codeExample: 'API_KEY="<REDACTED_EXAMPLE_ONLY>"',
        exampleLanguage: 'bash',
        targetPath: module.path
      }] satisfies OptimizationSuggestion[],
      cwd: testEnv.tempDir
    });

    const html = fs.readFileSync(result.reportPath, 'utf-8');
    expect(fs.existsSync(result.reportPath)).toBe(true);
    expect(html).toContain(module.fullName);
    expect(html).toContain('Interactive file explorer');
    expect(html).toContain('file-search');
    expect(html).toContain('Add examples');
    expect(html).toContain('Optimization suggestions');
    expect(html).toContain('Add redaction guidance');
    expect(result.optimizationSuggestionCount).toBe(1);
  });
});