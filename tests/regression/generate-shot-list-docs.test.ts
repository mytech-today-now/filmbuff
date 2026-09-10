import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('generate-shot-list documentation', () => {
  it('keeps the README quick start on the required --input form', () => {
    const readme = readRepoFile('README.md');

    expect(readme).toContain('filmbuff generate-shot-list --input script.fountain');
    expect(readme).not.toContain('filmbuff generate-shot-list script.fountain');
  });

  it('keeps the AI providers guide on the required --input form', () => {
    const aiProviders = readRepoFile('cli/docs/AI_PROVIDERS.md');

    expect(aiProviders).toContain('filmbuff generate-shot-list --input script.fountain --output shots.jsonl');
    expect(aiProviders).toContain('AI_MOCK=true filmbuff generate-shot-list --input script.fountain --output shots.jsonl');
    expect(aiProviders).toContain('filmbuff generate-shot-list --input script.fountain --output shots.jsonl --generate-video \\');
    expect(aiProviders).not.toContain('filmbuff generate-shot-list script.fountain');
  });

  it('lists every supported input format in the help text', () => {
    const helpText = readRepoFile('cli/src/commands/generate-shot-list/help-text.ts');

    [
      'Fountain (.fountain)',
      'Markdown (.md)',
      'Plain Text (.txt)',
      'Final Draft (.fdx)',
      'PDF (.pdf)',
      'DOCX (.docx)',
      'RTF (.rtf)',
    ].forEach((format) => {
      expect(helpText).toContain(format);
    });
  });

  it('keeps the command help text aligned with the flag-based syntax', () => {
    const helpText = readRepoFile('cli/src/commands/generate-shot-list/help-text.ts');
    const commandSource = readRepoFile('cli/src/commands/generate-shot-list.ts');

    expect(helpText).toContain('filmbuff generate-shot-list --input <screenplay-file> [options]');
    expect(helpText).toContain('--input <file>');
    expect(commandSource).toContain('Usage: filmbuff generate-shot-list --input <screenplay-file> [options]');
    expect(commandSource).toContain('Missing required argument: --input');
  });
});
