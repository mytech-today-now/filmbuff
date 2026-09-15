import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { mkdir, writeFile } from 'fs/promises';

import { TestEnvironment } from '../../helpers/test-env';

async function executeCommand(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cliPath = path.join(__dirname, '../../../cli/dist/cli.js');

  return new Promise(resolve => {
    const child = spawn('node', [cliPath, ...args], {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env
      }
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', data => {
      stdout += data.toString();
    });

    child.stderr?.on('data', data => {
      stderr += data.toString();
    });

    child.on('close', code => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0
      });
    });

    child.on('error', error => {
      resolve({
        stdout,
        stderr: error.message,
        exitCode: 1
      });
    });
  });
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

async function createProjectRootMarker(projectPath: string): Promise<void> {
  await writeFile(
    path.join(projectPath, 'package.json'),
    JSON.stringify({ name: 'validate-fixture', version: '1.0.0' }, null, 2)
  );
  await mkdir(path.join(projectPath, 'filmbuff'), { recursive: true });
}

describe('validate command', () => {
  let testEnv: TestEnvironment;

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    await testEnv.setup();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('reports project agnostic violations from TypeScript module source', async () => {
    const project = await testEnv.createProject({
      name: 'validate-project-agnostic',
      withAugmentDir: false
    });

    await createProjectRootMarker(project.path);

    const modulePath = path.join(project.path, 'filmbuff', 'writing-standards', 'screenplay');
    const rulesPath = path.join(modulePath, 'rules');
    const examplesPath = path.join(modulePath, 'examples');
    const utilsPath = path.join(modulePath, 'utils');

    await mkdir(rulesPath, { recursive: true });
    await mkdir(examplesPath, { recursive: true });
    await mkdir(utilsPath, { recursive: true });

    await writeFile(path.join(modulePath, 'module.json'), JSON.stringify({
      name: 'screenplay',
      version: '1.0.0',
      displayName: 'Screenplay',
      description: 'Screenplay guidance for command validation',
      type: 'writing-standards',
      tags: ['screenplay', 'validation'],
      augment: {
        priority: 'medium',
        category: 'writing-standards'
      }
    }, null, 2));

    await writeFile(path.join(modulePath, 'README.md'), `
# Screenplay Module

## Overview

This fixture keeps the CLI validation path realistic.

## Contents

- Rules
- Examples
- Source helpers

## Character Count

~5,000

## Usage

Run \`filmbuff validate writing-standards/screenplay\`.

## Installation

Copy the module into the local FilmBuff tree.

\`\`\`ts
export const usage = true;
\`\`\`
`);

    await writeFile(path.join(rulesPath, 'screenplay.md'), `
# Screenplay Guidance

Keep the module tree free of environment-specific references.

## Steps

1. Prefer portable paths.
2. Avoid hardcoded URLs.
3. Keep fixtures deterministic.

\`\`\`ts
const keepItPortable = true;
\`\`\`
`);

    await writeFile(path.join(examplesPath, 'example.md'), `
# Example

This example exists so documentation validation sees at least one example file.
`);

    await writeFile(
      path.join(utilsPath, 'file-organization.ts'),
      String.raw`export const localPath = "C:\Users\tester\workspace\module";
export const localUrl = "https://example.com/source";
`
    );

    await writeFile(
      path.join(utilsPath, 'notes.txt'),
      String.raw`C:\Users\tester\ignored\path
https://example.com/ignored
`
    );

    const result = await executeCommand(['validate', 'writing-standards/screenplay'], project.path);
    const output = stripAnsi(`${result.stdout}${result.stderr}`);

    expect(result.exitCode).toBe(0);
    expect(output).toContain('Project-Agnostic Content');
    expect(output).toContain('Potential hardcoded path in file-organization.ts');
    expect(output).toContain('Potential project-specific URL in file-organization.ts');
    expect(output).not.toContain('notes.txt');
  }, 60_000);
});
