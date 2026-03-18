import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { TestEnvironment } from '@tests/helpers/test-env';

const {
  buildCliInvocation,
  findModuleRoot,
  getModuleNameFromPath,
  renderOptimizationSuggestionsMarkdown
} = require('../../../vscode/filmbuff-module-inspector/utils.js');

describe('vscode module inspector extension', () => {
  let testEnv: TestEnvironment;

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    await testEnv.setup();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('derives module context and cli invocations from a selected resource', async () => {
    const workspaceRoot = path.join(testEnv.tempDir, 'workspace');
    const moduleRoot = path.join(workspaceRoot, 'filmbuff', 'coding-standards', 'demo-module');
    const selectedFile = path.join(moduleRoot, 'rules', 'rule.md');

    await mkdir(path.dirname(selectedFile), { recursive: true });
    await writeFile(path.join(moduleRoot, 'module.json'), JSON.stringify({ name: 'demo-module' }, null, 2));
    await writeFile(selectedFile, '# Rule');

    expect(findModuleRoot(selectedFile)).toBe(moduleRoot);
    expect(getModuleNameFromPath(moduleRoot, workspaceRoot)).toBe('coding-standards/demo-module');

    const inspectInvocation = buildCliInvocation({
      workspaceRoot,
      moduleName: 'coding-standards/demo-module',
      mode: 'inspect'
    });
    const optimizationInvocation = buildCliInvocation({
      workspaceRoot,
      moduleName: 'coding-standards/demo-module',
      mode: 'optimization'
    });

    expect(inspectInvocation.args).toEqual([
      path.join(workspaceRoot, 'bin', 'filmbuff.js'),
      'show',
      'coding-standards/demo-module',
      '--webview',
      '--json'
    ]);
    expect(optimizationInvocation.args).toEqual([
      path.join(workspaceRoot, 'bin', 'filmbuff.js'),
      'show',
      'coding-standards/demo-module',
      '--optimization-suggestions',
      '--json'
    ]);
  });

  it('declares menu filters, keybindings, and renders optimization markdown', () => {
    const manifestPath = path.join(process.cwd(), 'vscode', 'filmbuff-module-inspector', 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const markdown = renderOptimizationSuggestionsMarkdown('coding-standards/demo-module', [{
      id: 'o1',
      category: 'quality',
      impact: 'medium',
      title: 'Add examples',
      summary: 'Improve module clarity.',
      rationale: 'Examples reduce ambiguity.',
      steps: ['Create examples/basic.ts'],
      metrics: ['Examples: 0'],
      codeExample: 'export const example = true;',
      exampleLanguage: 'typescript',
      targetPath: 'examples/basic.ts'
    }]);

    expect(manifest.contributes.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: 'filmbuff.inspectModule' }),
        expect.objectContaining({ command: 'filmbuff.inspectModuleOptimizations' })
      ])
    );
    expect(JSON.stringify(manifest.contributes.menus)).toContain('resourceExtname =~');
    expect(JSON.stringify(manifest.contributes.menus)).toContain('editorLangId =~');
    expect(manifest.contributes.keybindings).toHaveLength(2);
    expect(markdown).toContain('Optimization suggestions for coding-standards/demo-module');
    expect(markdown).toContain('```typescript');
  });
});