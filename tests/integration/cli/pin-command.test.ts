import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { spawn } from 'child_process';
import { TestEnvironment } from '../../helpers/test-env';

type ManifestModule = {
  name: string;
  version: string;
  type: string;
  description: string;
};

type Manifest = {
  version: string;
  modules: ManifestModule[];
};

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

async function executeCommand(
  command: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
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
  });
}

async function readManifest(configPath: string): Promise<{ raw: string; data: Manifest }> {
  const raw = await readFile(configPath, 'utf-8');
  return {
    raw,
    data: JSON.parse(raw) as Manifest
  };
}

async function createLocalModuleFixture(
  projectPath: string,
  options: {
    name?: string;
    version?: string;
    description?: string;
  } = {}
): Promise<{ fullName: string; version: string; description: string }> {
  const moduleName = options.name ?? 'pinned-module';
  const moduleVersion = options.version ?? '2.0.0';
  const moduleDescription = options.description ?? 'Pinned module fixture';
  const moduleType = 'domain-rules';
  await writeFile(
    join(projectPath, 'package.json'),
    JSON.stringify({ name: 'pin-fixture', version: '1.0.0' }, null, 2)
  );
  const modulePath = join(projectPath, 'filmbuff', moduleType, moduleName);

  await mkdir(join(modulePath, 'rules'), { recursive: true });

  await writeFile(
    join(modulePath, 'module.json'),
    JSON.stringify(
      {
        name: moduleName,
        version: moduleVersion,
        displayName: 'Pinned Module',
        description: moduleDescription,
        type: moduleType
      },
      null,
      2
    )
  );

  await writeFile(join(modulePath, 'VERSION'), `${moduleVersion}\n`);
  await writeFile(join(modulePath, 'README.md'), `# Pinned Module\n\n${moduleDescription}\n`);
  await writeFile(join(modulePath, 'rules', 'sample-rule.md'), '# Sample Rule\n');

  return {
    fullName: `${moduleType}/${moduleName}`,
    version: moduleVersion,
    description: moduleDescription
  };
}

describe('pin command', () => {
  const binPath = join(__dirname, '../../../bin/filmbuff.js');
  let testEnv: TestEnvironment;

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    await testEnv.setup();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('pins an existing version in the manifest', async () => {
    const project = await testEnv.createProject({ name: 'pin-project' });
    const module = await createLocalModuleFixture(project.path);

    const manifestBefore: Manifest = {
      version: '1.0.0',
      modules: [
        {
          name: module.fullName,
          version: '1.0.0',
          type: 'domain-rules',
          description: 'Original module description'
        },
        {
          name: 'workflows/unrelated-module',
          version: '3.1.4',
          type: 'workflows',
          description: 'Unrelated module record'
        }
      ]
    };

    await writeFile(project.configPath, JSON.stringify(manifestBefore, null, 2));

    const result = await executeCommand(
      process.execPath,
      [binPath, 'pin', 'pinned-module', module.version],
      project.path
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(`Pinned ${module.fullName} to version ${module.version}`);

    const manifestAfter = await readManifest(project.configPath);
    const pinnedModule = manifestAfter.data.modules.find((entry) => entry.name === module.fullName);
    const unrelatedModule = manifestAfter.data.modules.find(
      (entry) => entry.name === 'workflows/unrelated-module'
    );

    expect(pinnedModule).toBeDefined();
    expect(pinnedModule?.version).toBe(module.version);
    expect(pinnedModule?.description).toBe('Original module description');
    expect(unrelatedModule).toEqual({
      name: 'workflows/unrelated-module',
      version: '3.1.4',
      type: 'workflows',
      description: 'Unrelated module record'
    });
  }, 30_000);

  it('keeps the manifest stable when pinning the same version twice', async () => {
    const project = await testEnv.createProject({ name: 'pin-repeat-project' });
    const module = await createLocalModuleFixture(project.path);

    await writeFile(
      project.configPath,
      JSON.stringify(
        {
          version: '1.0.0',
          modules: [
            {
              name: module.fullName,
              version: '1.0.0',
              type: 'domain-rules',
              description: 'Original module description'
            }
          ]
        },
        null,
        2
      )
    );

    const firstRun = await executeCommand(
      process.execPath,
      [binPath, 'pin', 'pinned-module', module.version],
      project.path
    );

    const afterFirstRun = await readManifest(project.configPath);

    const secondRun = await executeCommand(
      process.execPath,
      [binPath, 'pin', 'pinned-module', module.version],
      project.path
    );

    const afterSecondRun = await readManifest(project.configPath);

    expect(firstRun.exitCode).toBe(0);
    expect(secondRun.exitCode).toBe(0);
    expect(afterSecondRun.raw).toBe(afterFirstRun.raw);
    expect(afterSecondRun.data.modules).toHaveLength(1);
    expect(afterSecondRun.data.modules[0]).toEqual({
      name: module.fullName,
      version: module.version,
      type: 'domain-rules',
      description: 'Original module description'
    });
  }, 30_000);

  it('rejects an unknown module', async () => {
    const project = await testEnv.createProject({ name: 'pin-missing-module-project' });
    await createLocalModuleFixture(project.path);

    const result = await executeCommand(
      process.execPath,
      [binPath, 'pin', 'missing-module', '2.0.0'],
      project.path
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('Module not found: missing-module');
  }, 30_000);

  it('rejects an unknown version', async () => {
    const project = await testEnv.createProject({ name: 'pin-missing-version-project' });
    const module = await createLocalModuleFixture(project.path);

    await writeFile(
      project.configPath,
      JSON.stringify(
        {
          version: '1.0.0',
          modules: [
            {
              name: module.fullName,
              version: '1.0.0',
              type: 'domain-rules',
              description: 'Original module description'
            }
          ]
        },
        null,
        2
      )
    );

    const result = await executeCommand(
      process.execPath,
      [binPath, 'pin', 'pinned-module', '9.9.9'],
      project.path
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain(
      'Version not found: 9.9.9 for domain-rules/pinned-module'
    );
  }, 30_000);
});
