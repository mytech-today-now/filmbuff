import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TestEnvironment } from '../../helpers/test-env';

async function executeCommand(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cliPath = join(__dirname, '../../../cli/dist/cli.js');

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

describe('create command', () => {
  let testEnv: TestEnvironment;

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    await testEnv.setup();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('creates a scaffold that list and show can discover', async () => {
    const project = await testEnv.createProject({ name: 'create-scaffold-project', withAugmentDir: false });

    const createResult = await executeCommand(
      ['create', 'My New Module', '--type', 'coding-standards'],
      project.path
    );

    const createOutput = stripAnsi(`${createResult.stdout}${createResult.stderr}`);
    const modulePath = join(project.path, 'filmbuff', 'coding-standards', 'my-new-module');
    const rulePath = join(modulePath, 'rules', 'my-new-module.md');

    expect(createResult.exitCode).toBe(0);
    expect(createOutput).toContain('Created module scaffold at');
    expect(createOutput).toContain('filmbuff/coding-standards/my-new-module/module.json');
    expect(createOutput).toContain('filmbuff/coding-standards/my-new-module/README.md');
    expect(createOutput).toContain('filmbuff/coding-standards/my-new-module/rules/my-new-module.md');
    expect(createOutput).toContain('filmbuff/coding-standards/my-new-module/examples/');
    expect(existsSync(modulePath)).toBe(true);
    expect(existsSync(join(modulePath, 'module.json'))).toBe(true);
    expect(existsSync(join(modulePath, 'README.md'))).toBe(true);
    expect(existsSync(rulePath)).toBe(true);
    expect(existsSync(join(modulePath, 'examples'))).toBe(true);

    const moduleJson = JSON.parse(readFileSync(join(modulePath, 'module.json'), 'utf-8'));
    expect(moduleJson.name).toBe('my-new-module');
    expect(moduleJson.displayName).toBe('My New Module');
    expect(moduleJson.version).toBe('1.0.0');
    expect(moduleJson.type).toBe('coding-standards');
    expect(moduleJson.description).toContain('My New Module');

    const listResult = await executeCommand(['list', '--json'], project.path);
    expect(listResult.exitCode).toBe(0);
    const modules = JSON.parse(listResult.stdout) as Array<{ name: string; version: string; type: string }>;
    expect(modules.some(module => module.name === 'coding-standards/my-new-module')).toBe(true);

    const showResult = await executeCommand(['show', 'my-new-module', '--json'], project.path);
    expect(showResult.exitCode).toBe(0);
    const shownModule = JSON.parse(showResult.stdout) as {
      name: string;
      version: string;
      type: string;
      description: string;
    };
    expect(shownModule.name).toBe('coding-standards/my-new-module');
    expect(shownModule.version).toBe('1.0.0');
    expect(shownModule.type).toBe('coding-standards');
    expect(shownModule.description).toContain('My New Module');
  }, 60_000);

  it('refuses to overwrite an existing module', async () => {
    const project = await testEnv.createProject({ name: 'duplicate-module-project', withAugmentDir: false });
    const modulePath = join(project.path, 'filmbuff', 'coding-standards', 'duplicate-module');

    const firstResult = await executeCommand(
      ['create', 'duplicate-module', '--type', 'coding-standards'],
      project.path
    );

    expect(firstResult.exitCode).toBe(0);
    const moduleJsonBefore = readFileSync(join(modulePath, 'module.json'), 'utf-8');
    const readmeBefore = readFileSync(join(modulePath, 'README.md'), 'utf-8');
    const ruleFilesBefore = readdirSync(join(modulePath, 'rules')).sort();

    const secondResult = await executeCommand(
      ['create', 'duplicate-module', '--type', 'coding-standards'],
      project.path
    );

    const duplicateOutput = stripAnsi(`${secondResult.stdout}${secondResult.stderr}`);

    expect(secondResult.exitCode).not.toBe(0);
    expect(duplicateOutput).toContain('already exists');
    expect(readFileSync(join(modulePath, 'module.json'), 'utf-8')).toBe(moduleJsonBefore);
    expect(readFileSync(join(modulePath, 'README.md'), 'utf-8')).toBe(readmeBefore);
    expect(readdirSync(join(modulePath, 'rules')).sort()).toEqual(ruleFilesBefore);
  }, 60_000);

  it('rejects invalid name or path input', async () => {
    const project = await testEnv.createProject({ name: 'invalid-module-project', withAugmentDir: false });

    const result = await executeCommand(
      ['create', '../bad-module', '--type', 'coding-standards'],
      project.path
    );

    const output = stripAnsi(`${result.stdout}${result.stderr}`);

    expect(result.exitCode).not.toBe(0);
    expect(output).toContain('../bad-module');
    expect(output).toContain('Invalid module name or path');
    expect(existsSync(join(project.path, 'filmbuff'))).toBe(false);
  }, 60_000);
});
