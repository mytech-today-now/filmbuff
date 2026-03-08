import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

describe('FilmBuff package bin launcher', () => {
  const rootDir = path.resolve(__dirname, '..');
  const binPath = path.join(rootDir, 'bin', 'filmbuff.js');
  const packageJson = JSON.parse(
    readFileSync(path.join(rootDir, 'package.json'), 'utf-8').replace(/^\uFEFF/, '')
  );

  it('maps the filmbuff bin to the top-level launcher', () => {
    expect(packageJson.bin?.filmbuff).toBe('bin/filmbuff.js');
    expect(existsSync(binPath)).toBe(true);
  });

  it('runs the launcher help successfully', () => {
    const result = spawnSync(process.execPath, [binPath, '--help'], {
      cwd: rootDir,
      encoding: 'utf-8'
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: filmbuff');
  });
});