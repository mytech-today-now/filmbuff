import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '../../../');
const runLoggerModulePath = path.join(repoRoot, 'cli', 'dist', 'utils', 'run-logger.js');

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function runHarness(script: string): {
  stdout: string;
  stderr: string;
  status: number | null;
  logContent: string;
  logPath: string;
  tempDir: string;
} {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'filmbuff-run-logger-'));
  const logPath = path.join(tempDir, 'run.log');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: repoRoot,
    encoding: 'utf-8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      LOG_PATH: logPath,
    },
    maxBuffer: 10 * 1024 * 1024,
  });

  const logContent = existsSync(logPath) ? readFileSync(logPath, 'utf-8') : '';

  if (result.status === 0) {
    rmSync(tempDir, { recursive: true, force: true });
  }

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
    logContent,
    logPath,
    tempDir,
  };
}

describe('RunLogger', () => {
  it('tees terminal writes without debug noise and keeps the log format intact', () => {
    const script = `
      const fs = require('fs');
      const { RunLogger } = require(${JSON.stringify(runLoggerModulePath)});

      const logPath = process.env.LOG_PATH;
      const logger = new RunLogger(logPath);
      const sep = '='.repeat(80);
      const original = {
        stdout: process.stdout.write,
        stderr: process.stderr.write,
        fsWrite: fs.write,
        fsWriteSync: fs.writeSync,
      };

      (async () => {
        logger.start([
          sep,
          'filmbuff generate-shot-list Run Log',
          'Started: 2026-09-07T00:00:00.000Z',
          'Input:    /tmp/input.fountain',
          'Output:   /tmp/output.md',
          'Format:   md',
          'Log:      ' + logPath,
          sep,
        ].join('\\n'));

        console.log('stdout payload');
        console.error('stderr payload');
        fs.writeSync(1, 'fs sync payload\\n');
        await new Promise((resolve, reject) => {
          fs.write(2, 'fs async payload\\n', (error) => error ? reject(error) : resolve());
        });

        logger.writeDirectly('\\n' + sep + '\\nCompleted: 2026-09-07T00:00:00.000Z\\n' + sep + '\\n');
        logger.stop();

        if (
          process.stdout.write !== original.stdout ||
          process.stderr.write !== original.stderr ||
          fs.write !== original.fsWrite ||
          fs.writeSync !== original.fsWriteSync
        ) {
          throw new Error('write functions were not restored');
        }
      })().catch((error) => {
        console.error(error && error.stack ? error.stack : error);
        process.exitCode = 1;
      });
    `;

    const result = runHarness(script);
    const combinedOutput = result.stdout + result.stderr;

    expect(result.status).toBe(0);
    expect(combinedOutput).toContain('stdout payload');
    expect(combinedOutput).toContain('stderr payload');
    expect(combinedOutput).not.toContain('[RunLogger DEBUG]');

    expect(result.logContent).toContain('filmbuff generate-shot-list Run Log');
    expect(result.logContent).toContain('stdout payload');
    expect(result.logContent).toContain('stderr payload');
    expect(result.logContent).toContain('fs sync payload');
    expect(result.logContent).toContain('fs async payload');
    expect(result.logContent).toContain('Completed: 2026-09-07T00:00:00.000Z');
    expect(result.logContent).not.toContain('[RunLogger DEBUG]');
  });

  it('restores the original write hooks across repeated runs without duplicating output', () => {
    const script = `
      const fs = require('fs');
      const { RunLogger } = require(${JSON.stringify(runLoggerModulePath)});

      const logPath = process.env.LOG_PATH;
      const logger = new RunLogger(logPath);
      const sep = '='.repeat(80);
      const original = {
        stdout: process.stdout.write,
        stderr: process.stderr.write,
        fsWrite: fs.write,
        fsWriteSync: fs.writeSync,
      };

      async function runCycle(label) {
        logger.start([
          sep,
          'filmbuff generate-shot-list Run Log',
          'Started: ' + label,
          'Input:    /tmp/input.fountain',
          'Output:   /tmp/output.md',
          'Format:   md',
          'Log:      ' + logPath,
          sep,
        ].join('\\n'));

        console.log(label + ' stdout payload');
        console.error(label + ' stderr payload');
        fs.writeSync(1, label + ' fs sync payload\\n');
        await new Promise((resolve, reject) => {
          fs.write(2, label + ' fs async payload\\n', (error) => error ? reject(error) : resolve());
        });

        logger.writeDirectly('\\n' + sep + '\\nCompleted: ' + label + '\\n' + sep + '\\n');
        logger.stop();

        if (
          process.stdout.write !== original.stdout ||
          process.stderr.write !== original.stderr ||
          fs.write !== original.fsWrite ||
          fs.writeSync !== original.fsWriteSync
        ) {
          throw new Error('write functions were not restored after ' + label);
        }
      }

      (async () => {
        await runCycle('cycle-1');
        await runCycle('cycle-2');
      })().catch((error) => {
        console.error(error && error.stack ? error.stack : error);
        process.exitCode = 1;
      });
    `;

    const result = runHarness(script);
    const combinedOutput = result.stdout + result.stderr;

    expect(result.status).toBe(0);
    expect(combinedOutput).not.toContain('[RunLogger DEBUG]');
    expect(countOccurrences(combinedOutput, 'cycle-1 stdout payload')).toBe(1);
    expect(countOccurrences(combinedOutput, 'cycle-1 stderr payload')).toBe(1);
    expect(countOccurrences(combinedOutput, 'cycle-2 stdout payload')).toBe(1);
    expect(countOccurrences(combinedOutput, 'cycle-2 stderr payload')).toBe(1);

    expect(countOccurrences(result.logContent, 'cycle-1 stdout payload')).toBe(1);
    expect(countOccurrences(result.logContent, 'cycle-1 stderr payload')).toBe(1);
    expect(countOccurrences(result.logContent, 'cycle-2 stdout payload')).toBe(1);
    expect(countOccurrences(result.logContent, 'cycle-2 stderr payload')).toBe(1);
    expect(countOccurrences(result.logContent, 'Completed: cycle-1')).toBe(1);
    expect(countOccurrences(result.logContent, 'Completed: cycle-2')).toBe(1);
  });
});
