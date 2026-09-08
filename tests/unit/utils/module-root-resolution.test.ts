import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  discoverModules,
  getModulesDir,
  resolveModulesDir
} from '@cli/utils/module-system';

const repoRoot = path.resolve(__dirname, '../../..');
const nestedRepoDir = path.join(repoRoot, 'cli', 'src', 'commands');
const tempRoots: string[] = [];

describe('module-system root resolution', () => {
  afterEach(() => {
    vi.restoreAllMocks();

    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot) {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('prefers the live tree from both the repo root and nested subdirectories', () => {
    const cwdSpy = vi.spyOn(process, 'cwd');

    cwdSpy.mockReturnValue(repoRoot);
    const rootModules = discoverModules();
    expect(getModulesDir()).toBe(path.join(repoRoot, 'filmbuff'));

    cwdSpy.mockReturnValue(nestedRepoDir);
    const nestedModules = discoverModules();
    expect(getModulesDir()).toBe(path.join(repoRoot, 'filmbuff'));

    const rootNames = rootModules.map(module => module.fullName).sort();
    const nestedNames = nestedModules.map(module => module.fullName).sort();

    expect(rootNames.length).toBeGreaterThan(0);
    expect(nestedNames).toEqual(rootNames);
  });

  it('falls back to bundled modules when no project root is available', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filmbuff-root-resolution-'));
    tempRoots.push(tempRoot);

    const startDir = path.join(tempRoot, 'nested', 'worktree');
    const bundledDir = path.join(tempRoot, 'bundled-filmbuff');
    fs.mkdirSync(startDir, { recursive: true });
    fs.mkdirSync(bundledDir, { recursive: true });

    const resolution = resolveModulesDir(startDir, bundledDir);

    expect(resolution.source).toBe('bundled');
    expect(resolution.projectRoot).toBeNull();
    expect(resolution.modulesDir).toBe(bundledDir);
    expect(resolution.message).toContain('No live FilmBuff project root was found');
    expect(resolution.message).toContain(bundledDir);
  });

  it('warns when getModulesDir has to use the bundled tree', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filmbuff-no-root-'));
    tempRoots.push(tempRoot);

    const startDir = path.join(tempRoot, 'nested', 'worktree');
    fs.mkdirSync(startDir, { recursive: true });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(startDir);

    const modulesDir = getModulesDir();

    expect(modulesDir).toBe(path.resolve(repoRoot, 'filmbuff'));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('No live FilmBuff project root was found');
    expect(String(warnSpy.mock.calls[0][0])).toContain('Using bundled module data');

    cwdSpy.mockRestore();
  });
});
