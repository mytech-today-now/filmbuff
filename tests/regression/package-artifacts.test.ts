import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '../..');
const npmCli = process.env.npm_execpath;
const npmCommand = npmCli
  ? process.execPath
  : (process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm');
const npmArgs = (args: string[]) => {
  if (npmCli) return [npmCli, ...args];
  if (process.platform === 'win32') return ['/d', '/s', '/c', 'npm.cmd', ...args];
  return args;
};

describe('package artifacts regression', () => {
  it('keeps the launcher and built CLI files in the npm package', () => {
    const npmCache = fs.mkdtempSync(path.join(os.tmpdir(), 'filmbuff-npm-cache-'));
    let result;
    try {
      result = spawnSync(npmCommand, npmArgs([
        'pack', '--dry-run', '--json', '--ignore-scripts', '--cache', npmCache
      ]), {
        cwd: repoRoot,
        encoding: 'utf-8',
        maxBuffer: 20 * 1024 * 1024
      });
    } finally {
      fs.rmSync(npmCache, { recursive: true, force: true });
    }

    if (result.error) {
      throw result.error;
    }

    expect(result.status, result.error?.message || result.stderr || result.stdout).toBe(0);

    const output = result.stdout.trim();
    expect(output).toBeTruthy();

    const packInfo = JSON.parse(output)[0] as { files: Array<{ path: string }> };
    const packagedFiles = packInfo.files.map((file) => file.path);
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));

    expect(packagedFiles).toEqual(expect.arrayContaining([
      'bin/filmbuff.js',
      'cli/dist/cli.js',
      'cli/dist/core/module-loader.js',
      'README.md',
      'LICENSE',
      'AGENTS.md'
    ]));
    expect(packageJson.main).toBe('cli/dist/cli.js');
  }, 120_000);

  it('keeps the top-level launcher wired to the built CLI entrypoint', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
    const launcherPath = path.join(repoRoot, String(packageJson.bin?.filmbuff || ''));

    expect(packageJson.bin?.filmbuff).toBe('bin/filmbuff.js');
    expect(fs.existsSync(launcherPath)).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'cli', 'dist', 'cli.js'))).toBe(true);
  });

  it('declares MCP runtime imports as production dependencies', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));

    expect(packageJson.dependencies).toMatchObject({
      '@modelcontextprotocol/sdk': expect.any(String),
      zod: expect.any(String)
    });
  });

  it('resolves the package root to the shipped CLI entrypoint', () => {
    const smokeScript = `
      const fs = require('fs');
      const pkgRoot = ${JSON.stringify(repoRoot)};
      const resolved = require.resolve(pkgRoot);
      if (!fs.existsSync(resolved)) {
        throw new Error('Resolved entrypoint does not exist: ' + resolved);
      }
      process.stdout.write(resolved + '\\n');
      process.argv = ['node', 'smoke', '--version'];
      require(pkgRoot);
    `;

    const result = spawnSync(process.execPath, ['-e', smokeScript], {
      cwd: repoRoot,
      encoding: 'utf-8',
      maxBuffer: 20 * 1024 * 1024
    });

    if (result.error) {
      throw result.error;
    }

    expect(result.status).toBe(0);

    const [resolvedEntrypoint] = result.stdout.trim().split(/\r?\n/);
    expect(resolvedEntrypoint).toBe(path.join(repoRoot, 'cli', 'dist', 'cli.js'));
  }, 120_000);
});
