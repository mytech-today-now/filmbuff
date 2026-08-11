import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const repoRoot = path.resolve(__dirname, '../..');
const binPath = path.join(repoRoot, 'bin', 'filmbuff.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filmbuff-e2e-'));
const npmCli = process.env.npm_execpath;
const npmCommand = npmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const npmArgs = (args: string[]) => (npmCli ? [npmCli, ...args] : args);

afterEach(() => {
  if (fs.existsSync(tempRoot)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('CLI e2e smoke', () => {
  it('initializes a clean workspace through the shipped launcher', () => {
    const projectDir = path.join(tempRoot, 'workspace');
    fs.mkdirSync(projectDir, { recursive: true });

    const result = spawnSync(process.execPath, [binPath, 'init'], {
      cwd: projectDir,
      encoding: 'utf-8'
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(projectDir, '.augment', 'extensions.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, '.augment', 'COMMAND_HELP.md'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'AGENTS.md'))).toBe(true);
  }, 120_000);

  it('exposes the packable launcher through npm pack metadata', () => {
    const result = spawnSync(npmCommand, npmArgs(['pack', '--dry-run', '--json', '--ignore-scripts']), {
      cwd: repoRoot,
      encoding: 'utf-8',
      maxBuffer: 20 * 1024 * 1024
    });

    if (result.error) {
      throw result.error;
    }

    expect(result.status).toBe(0);
    const packInfo = JSON.parse(result.stdout.trim())[0] as { files: Array<{ path: string }> };
    expect(packInfo.files.some((file) => file.path === 'bin/filmbuff.js')).toBe(true);
  }, 120_000);
});
