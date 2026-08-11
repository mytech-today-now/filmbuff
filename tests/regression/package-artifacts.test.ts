import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '../..');
const npmCli = process.env.npm_execpath;
const npmCommand = npmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const npmArgs = (args: string[]) => (npmCli ? [npmCli, ...args] : args);

describe('package artifacts regression', () => {
  it('keeps the launcher and built CLI files in the npm package', () => {
    const result = spawnSync(npmCommand, npmArgs(['pack', '--dry-run', '--json', '--ignore-scripts']), {
      cwd: repoRoot,
      encoding: 'utf-8',
      maxBuffer: 20 * 1024 * 1024
    });

    if (result.error) {
      throw result.error;
    }

    expect(result.status).toBe(0);

    const output = result.stdout.trim();
    expect(output).toBeTruthy();

    const packInfo = JSON.parse(output)[0] as { files: Array<{ path: string }> };
    const packagedFiles = packInfo.files.map((file) => file.path);

    expect(packagedFiles).toEqual(expect.arrayContaining([
      'bin/filmbuff.js',
      'cli/dist/cli.js',
      'cli/dist/core/module-loader.js',
      'README.md',
      'LICENSE',
      'AGENTS.md'
    ]));
  }, 120_000);

  it('keeps the top-level launcher wired to the built CLI entrypoint', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
    const launcherPath = path.join(repoRoot, String(packageJson.bin?.filmbuff || ''));

    expect(packageJson.bin?.filmbuff).toBe('bin/filmbuff.js');
    expect(fs.existsSync(launcherPath)).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'cli', 'dist', 'cli.js'))).toBe(true);
  });
});
