import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cliPath = join(__dirname, '../../../cli/dist/cli.js');

  return await new Promise((resolve) => {
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
    omitVersion?: boolean;
  } = {}
): Promise<{ fullName: string; version?: string; description: string; type: string }> {
  const moduleName = options.name ?? 'test-module';
  const moduleVersion = options.version ?? '1.0.0';
  const moduleDescription = options.description ?? 'Scratch module for update checks';
  const moduleType = 'writing-standards';
  await writeFile(
    join(projectPath, 'package.json'),
    JSON.stringify({ name: 'check-updates-fixture', version: '1.0.0' }, null, 2)
  );
  const modulePath = join(projectPath, 'filmbuff', moduleType, moduleName);

  await mkdir(modulePath, { recursive: true });

  const moduleJson: Record<string, unknown> = {
    name: moduleName,
    displayName: 'Test Module',
    description: moduleDescription,
    type: moduleType
  };

  if (!options.omitVersion) {
    moduleJson.version = moduleVersion;
  }

  await writeFile(join(modulePath, 'module.json'), JSON.stringify(moduleJson, null, 2));
  await writeFile(join(modulePath, 'README.md'), `# Test Module\n\n${moduleDescription}\n`);

  return {
    fullName: `${moduleType}/${moduleName}`,
    version: options.omitVersion ? undefined : moduleVersion,
    description: moduleDescription,
    type: moduleType
  };
}

describe('check-updates command', () => {
  let testEnv: TestEnvironment;

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    await testEnv.setup();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('reports current linked modules and preserves the manifest', async () => {
    const project = await testEnv.createProject({ name: 'check-updates-current' });
    const module = await createLocalModuleFixture(project.path, {
      name: 'current-module',
      version: '1.0.0'
    });

    await writeFile(
      project.configPath,
      JSON.stringify(
        {
          version: '1.0.0',
          modules: [
            {
              name: module.fullName,
              version: '1.0.0',
              type: module.type,
              description: module.description
            }
          ]
        },
        null,
        2
      )
    );

    const before = await readManifest(project.configPath);
    const result = await executeCommand(['check-updates', '--json'], project.path);
    const after = await readManifest(project.configPath);

    expect(result.exitCode).toBe(0);
    expect(after.raw).toBe(before.raw);

    const payload = JSON.parse(result.stdout) as {
      success: boolean;
      summary: { current: number; outdated: number };
      modules: Array<{ name: string; status: string; linkedVersion: string; availableVersion: string }>;
    };

    expect(payload.success).toBe(true);
    expect(payload.summary.current).toBe(1);
    expect(payload.summary.outdated).toBe(0);
    expect(payload.modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: module.fullName,
          status: 'current',
          linkedVersion: '1.0.0',
          availableVersion: '1.0.0'
        })
      ])
    );
  }, 60_000);

  it('reports outdated linked modules', async () => {
    const project = await testEnv.createProject({ name: 'check-updates-outdated' });
    const module = await createLocalModuleFixture(project.path, {
      name: 'outdated-module',
      version: '2.0.0'
    });

    await writeFile(
      project.configPath,
      JSON.stringify(
        {
          version: '1.0.0',
          modules: [
            {
              name: module.fullName,
              version: '1.0.0',
              type: module.type,
              description: module.description
            }
          ]
        },
        null,
        2
      )
    );

    const before = await readManifest(project.configPath);
    const result = await executeCommand(['check-updates'], project.path);
    const after = await readManifest(project.configPath);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.exitCode).not.toBe(0);
    expect(after.raw).toBe(before.raw);
    expect(output).toContain('outdated');
    expect(output).toContain('1.0.0');
    expect(output).toContain('2.0.0');
    expect(output).toContain(module.fullName);
  }, 60_000);

  it('rejects missing module metadata with a clear error', async () => {
    const project = await testEnv.createProject({ name: 'check-updates-missing-version' });
    const module = await createLocalModuleFixture(project.path, {
      name: 'missing-version-module',
      omitVersion: true
    });

    await writeFile(
      project.configPath,
      JSON.stringify(
        {
          version: '1.0.0',
          modules: [
            {
              name: module.fullName,
              version: '1.0.0',
              type: module.type,
              description: module.description
            }
          ]
        },
        null,
        2
      )
    );

    const before = await readManifest(project.configPath);
    const result = await executeCommand(['check-updates'], project.path);
    const after = await readManifest(project.configPath);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.exitCode).not.toBe(0);
    expect(after.raw).toBe(before.raw);
    expect(output).toContain('Missing required field: version');
    expect(output).toContain(module.fullName);
  }, 60_000);

  it('rejects unsupported modules with a clear non-zero exit', async () => {
    const project = await testEnv.createProject({ name: 'check-updates-unsupported' });

    await writeFile(
      project.configPath,
      JSON.stringify(
        {
          version: '1.0.0',
          modules: [
            {
              name: 'writing-standards/ghost-module',
              version: '1.0.0',
              type: 'writing-standards',
              description: 'Missing module fixture'
            }
          ]
        },
        null,
        2
      )
    );

    const result = await executeCommand(['check-updates'], project.path);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.exitCode).not.toBe(0);
    expect(output).toContain('Module not found: writing-standards/ghost-module');
  }, 60_000);
});
