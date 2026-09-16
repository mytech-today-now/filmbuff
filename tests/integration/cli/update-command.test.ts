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

async function createLegacyAliasFixture(projectPath: string): Promise<void> {
  const modulePath = join(projectPath, 'filmbuff', 'writing-standards', 'screenplay', 'genres', 'action');

  await mkdir(modulePath, { recursive: true });
  await writeFile(
    join(projectPath, 'package.json'),
    JSON.stringify({ name: 'update-legacy-alias-fixture', version: '1.0.0' }, null, 2)
  );

  await writeFile(
    join(modulePath, 'module.json'),
    JSON.stringify(
      {
        name: 'screenplay-genre-action',
        version: '2.0.0',
        displayName: 'Action',
        description: 'Updated action guidance',
        type: 'writing-standards'
      },
      null,
      2
    )
  );

  await writeFile(join(modulePath, 'README.md'), '# Action\n\nUpdated action guidance\n');
}

async function createRenamedSourceFixture(projectPath: string): Promise<void> {
  const modulePath = join(projectPath, 'filmbuff', 'writing-standards', 'screenplay', 'genres', 'action-legacy');
  const rulesPath = join(modulePath, 'rules');

  await mkdir(rulesPath, { recursive: true });
  await writeFile(
    join(projectPath, 'package.json'),
    JSON.stringify({ name: 'update-renamed-source-fixture', version: '1.0.0' }, null, 2)
  );

  await writeFile(
    join(modulePath, 'module.json'),
    JSON.stringify(
      {
        name: 'screenplay-genre-action',
        version: '2.0.0',
        displayName: 'Action',
        description: 'Updated action guidance',
        type: 'writing-standards'
      },
      null,
      2
    )
  );

  await writeFile(join(rulesPath, 'action.md'), '# Action\n\nUpdated action guidance\n');
  await writeFile(join(modulePath, 'README.md'), '# Action\n\nUpdated action guidance\n');
}

describe('update command CLI regression', () => {
  let testEnv: TestEnvironment;

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    await testEnv.setup();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('rewrites a legacy alias entry when targeting the alias name through the CLI', async () => {
    const project = await testEnv.createProject({ name: 'update-legacy-alias' });
    await createLegacyAliasFixture(project.path);

    await writeFile(
      project.configPath,
      JSON.stringify(
        {
          version: '1.0.0',
          modules: [
            {
              name: 'action',
              version: '1.0.0',
              type: 'writing-standards',
              description: 'Legacy action guidance'
            }
          ]
        },
        null,
        2
      )
    );

    const before = await readManifest(project.configPath);
    const result = await executeCommand(['update', '--module', 'action'], project.path);
    const after = await readManifest(project.configPath);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.exitCode).toBe(0);
    expect(after.raw).not.toBe(before.raw);
    expect(after.data.modules).toHaveLength(1);
    expect(after.data.modules[0]).toEqual(
      expect.objectContaining({
        name: 'writing-standards/screenplay/genres/action',
        version: '2.0.0',
        type: 'writing-standards',
        description: 'Updated action guidance'
      })
    );
    expect(output).toContain('Update complete');
    expect(output).toContain('Updated: 1');
  }, 60_000);

  it('rewrites a legacy slug entry during the normal discovery flow', async () => {
    const project = await testEnv.createProject({ name: 'update-legacy-slug' });
    await createLegacyAliasFixture(project.path);

    await writeFile(
      project.configPath,
      JSON.stringify(
        {
          version: '1.0.0',
          modules: [
            {
              name: 'screenplay-genre-action',
              version: '1.0.0',
              type: 'writing-standards',
              description: 'Legacy action guidance'
            }
          ]
        },
        null,
        2
      )
    );

    const before = await readManifest(project.configPath);
    const result = await executeCommand(['update'], project.path);
    const after = await readManifest(project.configPath);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.exitCode).toBe(0);
    expect(after.raw).not.toBe(before.raw);
    expect(after.data.modules).toHaveLength(1);
    expect(after.data.modules[0]).toEqual(
      expect.objectContaining({
        name: 'writing-standards/screenplay/genres/action',
        version: '2.0.0',
        type: 'writing-standards',
        description: 'Updated action guidance'
      })
    );
    expect(output).toContain('Update complete');
    expect(output).toContain('Updated: 1');
  }, 60_000);

  it('rewrites a legacy alias entry when the local source folder has been renamed', async () => {
    const project = await testEnv.createProject({ name: 'update-renamed-source' });
    await createRenamedSourceFixture(project.path);

    await writeFile(
      project.configPath,
      JSON.stringify(
        {
          version: '1.0.0',
          modules: [
            {
              name: 'action',
              version: '1.0.0',
              type: 'writing-standards',
              description: 'Legacy action guidance'
            }
          ]
        },
        null,
        2
      )
    );

    const before = await readManifest(project.configPath);
    const result = await executeCommand(['update', '--module', 'action'], project.path);
    const after = await readManifest(project.configPath);
    const output = `${result.stdout}${result.stderr}`;

    expect(result.exitCode).toBe(0);
    expect(after.raw).not.toBe(before.raw);
    expect(after.data.modules).toHaveLength(1);
    expect(after.data.modules[0]).toEqual(
      expect.objectContaining({
        name: 'writing-standards/screenplay/genres/action-legacy',
        version: '2.0.0',
        type: 'writing-standards',
        description: 'Updated action guidance'
      })
    );
    expect(output).toContain('Update complete');
    expect(output).toContain('Updated: 1');
  }, 60_000);
});
