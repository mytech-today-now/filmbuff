import * as fs from 'fs';
import * as path from 'path';
import packageJson from '../../package.json';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');
const packageVersion = (packageJson as { version: string }).version;

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function extractBadgeVersion(readme: string): string | null {
  const match = readme.match(/version-([0-9A-Za-z.+-]+)-blue\.svg/);
  return match?.[1] ?? null;
}

describe('version metadata', () => {
  it('keeps the README badge aligned with package.json', () => {
    const readme = readRepoFile('README.md');
    const badgeVersion = extractBadgeVersion(readme);

    expect(badgeVersion).toBe(packageVersion);
    expect(readme).not.toContain('version-1.0.0-blue.svg');
  });

  it('keeps the help generator on the shared version source', () => {
    const source = readRepoFile('cli/src/utils/extractCommandHelp.ts');

    expect(source).toContain('readPackageVersion');
    expect(source).not.toContain('**Version**: 1.0.0');
  });
});
