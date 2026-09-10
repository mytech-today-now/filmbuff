import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { TestEnvironment } from '../../helpers/test-env';

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

const CLI_PATH = join(__dirname, '../../../cli/dist/cli.js');

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    FORCE_COLOR: '0',
    GIT_AUTHOR_NAME: 'Test User',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test User',
    GIT_COMMITTER_EMAIL: 'test@example.com'
  };
}

function runGit(args: string[], cwd: string): void {
  const result = spawnSync('git', args, {
    cwd,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    env: gitEnv()
  });

  if ((result.status ?? 1) !== 0) {
    const output = stripAnsi(`${result.stdout ?? ''}${result.stderr ?? ''}`).trim();
    throw new Error(`git ${args.join(' ')} failed${output ? `: ${output}` : ''}`);
  }
}

async function executeCommand(args: string[], cwd: string): Promise<CommandResult> {
  return await new Promise((resolve) => {
    const child = spawn('node', [CLI_PATH, ...args], {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: gitEnv()
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        stdout: stripAnsi(stdout),
        stderr: stripAnsi(stderr),
        exitCode: code ?? 0
      });
    });

    child.on('error', (error) => {
      resolve({
        stdout,
        stderr: error.message,
        exitCode: 1
      });
    });
  });
}

async function createDiffFixture(
  testEnv: TestEnvironment,
  projectName: string
): Promise<{
  projectPath: string;
  moduleFullName: string;
  rulePath: string;
}> {
  const project = await testEnv.createProject({ name: projectName });
  const moduleType = 'writing-standards';
  const moduleName = 'diff-module';
  const modulePath = join(project.path, 'filmbuff', moduleType, moduleName);
  const rulesPath = join(modulePath, 'rules');
  const examplesPath = join(modulePath, 'examples');
  const rulePath = join(rulesPath, 'diff-module.md');

  await mkdir(rulesPath, { recursive: true });
  await mkdir(examplesPath, { recursive: true });

  await writeFile(
    join(modulePath, 'module.json'),
    JSON.stringify(
      {
        name: moduleName,
        version: '1.0.0',
        displayName: 'Diff Module',
        description: 'Scratch module used to verify the diff command',
        type: moduleType
      },
      null,
      2
    ) + '\n'
  );
  await writeFile(join(modulePath, 'README.md'), '# Diff Module\n\nBaseline documentation.\n');
  await writeFile(rulePath, '# Diff Module Rule\n\nBaseline line.\n');

  runGit(['init', '-q'], project.path);
  runGit(['config', 'core.autocrlf', 'false'], project.path);
  runGit(['config', 'user.name', 'Test User'], project.path);
  runGit(['config', 'user.email', 'test@example.com'], project.path);
  runGit(['add', '.'], project.path);
  runGit(['commit', '-q', '-m', 'baseline'], project.path);

  return {
    projectPath: project.path,
    moduleFullName: `${moduleType}/${moduleName}`,
    rulePath
  };
}

describe('diff command', () => {
  let testEnv: TestEnvironment;

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    await testEnv.setup();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('prints a readable diff for changed module content', async () => {
    const fixture = await createDiffFixture(testEnv, 'diff-changed-project');

    await writeFile(fixture.rulePath, '# Diff Module Rule\n\nUpdated line.\n');

    const result = await executeCommand(['diff', fixture.moduleFullName], fixture.projectPath);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.exitCode).toBe(0);
    expect(output).toContain(`Module diff: ${fixture.moduleFullName}`);
    expect(output).toContain('Version: 1.0.0');
    expect(output).toContain('Compared against: git HEAD');
    expect(output).toContain(
      'diff --git a/filmbuff/writing-standards/diff-module/rules/diff-module.md b/filmbuff/writing-standards/diff-module/rules/diff-module.md'
    );
    expect(output).toContain('-Baseline line.');
    expect(output).toContain('+Updated line.');
    expect(output).not.toContain('No differences found');
  }, 60_000);

  it('reports clearly when no diff exists', async () => {
    const fixture = await createDiffFixture(testEnv, 'diff-unchanged-project');

    const result = await executeCommand(['diff', fixture.moduleFullName], fixture.projectPath);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.exitCode).toBe(0);
    expect(output).toContain(`Module diff: ${fixture.moduleFullName}`);
    expect(output).toContain('No differences found for writing-standards/diff-module.');
    expect(output).not.toContain('diff --git');
  }, 60_000);

  it('rejects unknown modules with a non-zero exit', async () => {
    const fixture = await createDiffFixture(testEnv, 'diff-unknown-project');

    const result = await executeCommand(['diff', 'missing-module'], fixture.projectPath);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.exitCode).not.toBe(0);
    expect(output).toContain('Module not found: missing-module');
  }, 60_000);

  it('rejects modules without valid version metadata', async () => {
    const project = await testEnv.createProject({ name: 'diff-missing-version-project' });
    const moduleType = 'writing-standards';
    const moduleName = 'versionless-module';
    const modulePath = join(project.path, 'filmbuff', moduleType, moduleName);

    await mkdir(join(modulePath, 'rules'), { recursive: true });
    await writeFile(
      join(modulePath, 'module.json'),
      JSON.stringify(
        {
          name: moduleName,
          displayName: 'Versionless Module',
          description: 'Module without version metadata',
          type: moduleType
        },
        null,
        2
      ) + '\n'
    );

    const result = await executeCommand(['diff', `${moduleType}/${moduleName}`], project.path);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.exitCode).not.toBe(0);
    expect(output).toContain('module.json is missing a valid semantic version');
    expect(output).toContain(`${moduleType}/${moduleName}`);
  }, 60_000);
});
