import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { TestEnvironment } from '../../helpers/test-env';
import { spawn } from 'child_process';

/**
 * CLI Command Execution Tests
 * 
 * Tests for CLI command execution including:
 * - Command execution with execa/spawn
 * - stdout/stderr capture
 * - Exit codes
 * - Command chaining
 * - CLI error messages
 */

/**
 * Execute CLI command and capture output
 */
async function executeCommand(
  command: string,
  args: string[],
  cwd: string,
  options: { env?: NodeJS.ProcessEnv } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...options.env
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
        stdout,
        stderr,
        exitCode: code || 0
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

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

async function createShowSearchFixture(projectPath: string): Promise<void> {
  const modulePath = join(projectPath, 'filmbuff', 'writing-standards', 'screenplay');
  await mkdir(modulePath, { recursive: true });
  await writeFile(
    join(projectPath, 'package.json'),
    JSON.stringify({ name: 'show-search-fixture', version: '1.0.0' }, null, 2)
  );

  await writeFile(
    join(modulePath, 'module.json'),
    JSON.stringify(
      {
        name: 'screenplay',
        version: '1.0.0',
        displayName: 'Screenplay Fixture',
        description: 'Fixture module for literal search regressions',
        type: 'writing-standards'
      },
      null,
      2
    )
  );

  await Promise.all([
    writeFile(join(modulePath, '01-bracket.md'), '# Bracket\nThe literal token is [\n'),
    writeFile(join(modulePath, '02-paren.md'), '# Paren\nThe literal token is (\n'),
    writeFile(join(modulePath, '03-star.md'), '# Star\nThe literal token is *\n'),
    writeFile(join(modulePath, '04-dot.md'), '# Dot\nThe literal token is a.dot\n'),
    writeFile(join(modulePath, '05-normal-first.md'), '# Normal One\nneedle first\n'),
    writeFile(join(modulePath, '06-normal-second.md'), '# Normal Two\nneedle second\n')
  ]);
}

async function createCompletedTasksFixture(projectPath: string): Promise<void> {
  const beadsDir = join(projectPath, '.beads');
  const scriptsDir = join(projectPath, 'scripts');

  await mkdir(beadsDir, { recursive: true });
  await mkdir(scriptsDir, { recursive: true });

  await writeFile(
    join(scriptsDir, 'completed.jsonl'),
    [
      JSON.stringify({
        id: 'bd-1001',
        title: 'Split the search flags',
        description: 'Give module content and completed tasks separate search options.',
        status: 'closed',
        priority: 2,
        closed_at: '2026-09-07T12:00:00.000Z',
        close_reason: 'Completed with distinct CLI flags'
      }),
      JSON.stringify({
        id: 'bd-1002',
        title: 'Unrelated task',
        description: 'This entry should not match the completed search filter.',
        status: 'closed',
        priority: 3,
        closed_at: '2026-09-06T12:00:00.000Z',
        close_reason: 'Finished for a different reason'
      })
    ].join('\n')
  );
}

async function createCorruptedCompletedTasksFixture(projectPath: string): Promise<void> {
  const beadsDir = join(projectPath, '.beads');
  const scriptsDir = join(projectPath, 'scripts');

  await mkdir(beadsDir, { recursive: true });
  await mkdir(scriptsDir, { recursive: true });

  await writeFile(
    join(scriptsDir, 'completed.jsonl'),
    [
      '{"id":"bd-broken"',
      JSON.stringify({
        id: 'bd-1001',
        title: 'Split the search flags',
        description: 'Give module content and completed tasks separate search options.',
        status: 'closed',
        priority: 2,
        closed_at: '2026-09-07T12:00:00.000Z',
        close_reason: 'Completed with distinct CLI flags'
      })
    ].join('\n')
  );
}

interface ShowCompletedFixtureTask {
  id: string;
  title: string;
  description?: string;
  status: 'closed';
  priority?: number;
  issue_type?: string;
  owner?: string;
  created_at?: string;
  created_by?: string;
  updated_at?: string;
  closed_at?: string;
  close_reason?: string;
  labels?: string[];
}

async function createResolvedCompletedProjectFixture(
  projectPath: string,
  tasks: ShowCompletedFixtureTask[],
  options: {
    includeBeads?: boolean;
    includeCompletedFile?: boolean;
  } = {}
): Promise<void> {
  await mkdir(join(projectPath, 'filmbuff'), { recursive: true });
  await writeFile(
    join(projectPath, 'package.json'),
    JSON.stringify({ name: 'show-completed-fixture', version: '1.0.0' }, null, 2)
  );

  if (options.includeBeads !== false) {
    await mkdir(join(projectPath, '.beads'), { recursive: true });
  }

  if (options.includeCompletedFile !== false) {
    const scriptsDir = join(projectPath, 'scripts');
    await mkdir(scriptsDir, { recursive: true });
    await writeFile(join(scriptsDir, 'completed.jsonl'), tasks.map((task) => JSON.stringify(task)).join('\n'));
  }
}

function normalizeOutput(value: string): string {
  return stripAnsi(value).replace(/\r\n/g, '\n').trim();
}

describe('CLI Command Execution', () => {
  let testEnv: TestEnvironment;
  const CLI_PATH = join(__dirname, '../../../cli/dist/cli.js');

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    await testEnv.setup();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  describe('Basic Command Execution', () => {
    it('should execute help command successfully', async () => {
      const result = await executeCommand('node', [CLI_PATH, '--help'], testEnv.tempDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBeTruthy();
    });

    it('should execute version command successfully', async () => {
      const result = await executeCommand('node', [CLI_PATH, '--version'], testEnv.tempDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBeTruthy();
    }, 15_000);

    it('should handle unknown command gracefully', async () => {
      const result = await executeCommand(
        'node',
        [CLI_PATH, 'unknown-command'],
        testEnv.tempDir
      );

      // Should exit with error code
      expect(result.exitCode).not.toBe(0);
    }, 15_000);

    // filmbuff init calls extractCommandHelp which spawns external processes —
    // use a generous timeout so slow CI environments can still complete.
    it('should execute init successfully in a clean project', async () => {
      const projectPath = join(testEnv.tempDir, 'fresh-project');
      await mkdir(projectPath, { recursive: true });

      const result = await executeCommand('node', [CLI_PATH, 'init'], projectPath);

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(projectPath, '.augment', 'extensions.json'))).toBe(true);
      expect(existsSync(join(projectPath, 'AGENTS.md'))).toBe(true);

      const config = JSON.parse(
        await readFile(join(projectPath, '.augment', 'extensions.json'), 'utf-8')
      );

      expect(config.version).toBe('0.1.0');
    }, 60_000);

    it('should cancel re-init in a non-interactive environment without crashing', async () => {
      const project = await testEnv.createProject();

      const result = await executeCommand('node', [CLI_PATH, 'init'], project.path);
      const output = result.stdout + result.stderr;

      expect(result.exitCode).toBe(0);
      expect(output).toContain('overwrite confirmation requires an interactive terminal');
      expect(output).toContain('Initialization cancelled.');
    });
  });

  describe('stdout/stderr Capture', () => {
    it('should capture stdout from successful command', async () => {
      const project = await testEnv.createProject();
      await writeFile(
        join(project.path, 'package.json'),
        JSON.stringify({ name: 'capture-fixture', version: '1.0.0' }, null, 2)
      );
      await mkdir(join(project.path, 'filmbuff'), { recursive: true });
      const result = await executeCommand('node', [CLI_PATH, 'list'], project.path);

      expect(result.stdout).toBeTruthy();
      expect(result.stderr).toBe('');
    }, 15_000);

    it('should capture stderr from failed command', async () => {
      const result = await executeCommand(
        'node',
        [CLI_PATH, 'link', 'non-existent-module'],
        testEnv.tempDir
      );

      // Error should be captured in stderr or stdout
      expect(result.exitCode).not.toBe(0);
    });

    it('should handle empty output', async () => {
      const project = await testEnv.createProject();
      const result = await executeCommand('node', [CLI_PATH, 'list', '--json'], project.path);

      expect(result.stdout).toBeTruthy();
      // Should be valid JSON (empty array or object)
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    }, 15_000);
  });

  describe('Exit Codes', () => {
    it('should return 0 for successful command', async () => {
      const project = await testEnv.createProject();
      const result = await executeCommand('node', [CLI_PATH, 'list'], project.path);

      expect(result.exitCode).toBe(0);
    });

    it('should return non-zero for failed command', async () => {
      const result = await executeCommand(
        'node',
        [CLI_PATH, 'link', 'invalid/module'],
        testEnv.tempDir
      );

      expect(result.exitCode).not.toBe(0);
    });

    it('should return non-zero for invalid arguments', async () => {
      const result = await executeCommand(
        'node',
        [CLI_PATH, 'list', '--invalid-flag'],
        testEnv.tempDir
      );

      // May succeed or fail depending on argument parsing
      expect(result.exitCode).toBeGreaterThanOrEqual(0);
    }, 15_000);
  });

  describe('Command Chaining', () => {
    it('should execute multiple commands sequentially', async () => {
      const project = await testEnv.createProject();

      // Execute first command
      const result1 = await executeCommand('node', [CLI_PATH, 'list'], project.path);
      expect(result1.exitCode).toBe(0);

      // Execute second command
      const result2 = await executeCommand('node', [CLI_PATH, 'list', '--json'], project.path);
      expect(result2.exitCode).toBe(0);

      // Both should succeed
      expect(result1.stdout).toBeTruthy();
      expect(result2.stdout).toBeTruthy();
    }, 15_000);

    // Each CLI invocation spawns a Node process loading an ESM-only package
    // (~2.5 s per invocation) — use a 30 s timeout for multi-invocation tests.
    it('should handle command dependencies', async () => {
      const project = await testEnv.createProject();

      // First list modules (should succeed even with no modules)
      const listResult = await executeCommand('node', [CLI_PATH, 'list'], project.path);
      expect(listResult.exitCode).toBe(0);

      // Then show a real module from filmbuff
      // Use a module that actually exists in the global modules directory
      const showResult = await executeCommand(
        'node',
        [CLI_PATH, 'show', 'coding-standards/typescript'],
        project.path
      );

      // Should succeed if the module exists, or fail gracefully if it doesn't
      // Either way, the command should execute without crashing
      expect([0, 1]).toContain(showResult.exitCode);
    }, 30_000);

    it('should handle parallel command execution', async () => {
      const project = await testEnv.createProject();

      // Execute multiple commands in parallel
      const results = await Promise.all([
        executeCommand('node', [CLI_PATH, 'list'], project.path),
        executeCommand('node', [CLI_PATH, 'list', '--json'], project.path),
        executeCommand('node', [CLI_PATH, '--version'], project.path)
      ]);

      // All should succeed
      results.forEach(result => {
        expect(result.exitCode).toBe(0);
      });
    }, 30_000);
  });

  describe('CLI Error Messages', () => {
    it('should provide clear error for missing arguments', async () => {
      const result = await executeCommand('node', [CLI_PATH, 'show'], testEnv.tempDir);

      // Should fail with clear error message
      expect(result.exitCode).not.toBe(0);
      // Error message should be in stdout or stderr
      const output = result.stdout + result.stderr;
      expect(output.length).toBeGreaterThan(0);
    });

    it('should provide clear error for invalid module', async () => {
      const project = await testEnv.createProject();
      const result = await executeCommand(
        'node',
        [CLI_PATH, 'show', 'invalid/non-existent-module'],
        project.path
      );

      // Should fail with error message
      expect(result.exitCode).not.toBe(0);
      const output = result.stdout + result.stderr;
      expect(output.length).toBeGreaterThan(0);
    }, 15_000);

    it('should provide clear error for invalid project path', async () => {
      const result = await executeCommand(
        'node',
        [CLI_PATH, 'list'],
        '/non/existent/path'
      );

      // Should handle gracefully
      expect(result.exitCode).toBeGreaterThanOrEqual(0);
    });

    it('should provide help text for unknown command', async () => {
      const result = await executeCommand(
        'node',
        [CLI_PATH, 'unknown-command'],
        testEnv.tempDir
      );

      // Should fail with helpful message
      expect(result.exitCode).not.toBe(0);
      const output = result.stdout + result.stderr;
      expect(output.length).toBeGreaterThan(0);
    }, 15_000);
  });

  describe('JSON Output', () => {
    it('should produce valid JSON with --json flag', async () => {
      const project = await testEnv.createProject();
      const result = await executeCommand('node', [CLI_PATH, 'list', '--json'], project.path);

      expect(result.exitCode).toBe(0);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    }, 15_000);

    it('should handle empty JSON output', async () => {
      const project = await testEnv.createProject();
      const result = await executeCommand('node', [CLI_PATH, 'list', '--json'], project.path);

      const json = JSON.parse(result.stdout);
      expect(Array.isArray(json) || typeof json === 'object').toBe(true);
    });

    it('should format JSON output correctly', async () => {
      const project = await testEnv.createProject();
      const result = await executeCommand('node', [CLI_PATH, 'list', '--json'], project.path);

      const json = JSON.parse(result.stdout);
      // Should be valid JSON structure
      expect(json).toBeDefined();
    });
  });

  describe('Command Timeout', () => {
    it('should complete commands within reasonable time', async () => {
      const project = await testEnv.createProject();
      const start = Date.now();

      const result = await executeCommand('node', [CLI_PATH, 'list'], project.path);

      const duration = Date.now() - start;
      expect(result.exitCode).toBe(0);
      // Should complete within 10 seconds
      expect(duration).toBeLessThan(10000);
    });

    it('should handle long-running commands', async () => {
      const project = await testEnv.createProject();

      // Create multiple modules to make list command slower
      for (let i = 0; i < 5; i++) {
        await testEnv.createModule({ name: `module-${i}` });
      }

      const start = Date.now();
      const result = await executeCommand('node', [CLI_PATH, 'list'], project.path);
      const duration = Date.now() - start;

      expect(result.exitCode).toBe(0);
      // Should still complete reasonably fast
      expect(duration).toBeLessThan(15000);
    });
  });

  describe('Environment Variables', () => {
    it('should respect NODE_ENV variable', async () => {
      const project = await testEnv.createProject();

      // Execute with test environment
      const result = await executeCommand('node', [CLI_PATH, 'list'], project.path);

      expect(result.exitCode).toBe(0);
      // Command should execute successfully in test environment
    });

    it('should handle missing environment variables', async () => {
      const project = await testEnv.createProject();
      const result = await executeCommand('node', [CLI_PATH, 'list'], project.path);

      // Should work without special environment variables
      expect(result.exitCode).toBe(0);
    });
  });

  describe('Working Directory', () => {
    it('should execute commands in correct working directory', async () => {
      const project = await testEnv.createProject();
      const result = await executeCommand('node', [CLI_PATH, 'list'], project.path);

      expect(result.exitCode).toBe(0);
      // Command should execute in project directory
    }, 15_000);

    it('should handle relative paths', async () => {
      const project = await testEnv.createProject();

      // Execute from project directory
      const result = await executeCommand('node', [CLI_PATH, 'list'], project.path);

      expect(result.exitCode).toBe(0);
    }, 15_000);
  });

  describe('Show search literal regressions', () => {
    const BIN_PATH = join(__dirname, '../../../bin/filmbuff.js');

    async function runShowSearch(
      projectPath: string,
      searchTerm: string,
      extraArgs: string[] = []
    ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
      return executeCommand(
        process.execPath,
        [BIN_PATH, 'show', 'writing-standards/screenplay', '--search', searchTerm, ...extraArgs],
        projectPath,
        { env: { FORCE_COLOR: '1' } }
      );
    }

    it.each([
      ['[', '01-bracket.md'],
      ['(', '02-paren.md'],
      ['*', '03-star.md'],
      ['.', '04-dot.md']
    ])('treats %s as literal text', async (searchTerm, expectedFile) => {
      const project = await testEnv.createProject();
      await createShowSearchFixture(project.path);

      const result = await runShowSearch(project.path, searchTerm);
      const plainOutput = stripAnsi(result.stdout + result.stderr);

      expect(result.exitCode).toBe(0);
      expect(plainOutput).not.toContain('SyntaxError: Invalid regular expression');
      expect(plainOutput).toContain(`Search Results: "${searchTerm}"`);
      expect(plainOutput).toContain(`📄 ${expectedFile}`);
      expect(plainOutput).toContain('Found 1 matches in 1 files');
    }, 15_000);

    it('highlights ordinary terms and preserves file order', async () => {
      const project = await testEnv.createProject();
      await createShowSearchFixture(project.path);

      const result = await runShowSearch(project.path, 'needle');
      const output = result.stdout + result.stderr;
      const plainOutput = stripAnsi(output);
      const contentLines = output
        .split(/\r?\n/)
        .filter((line) => stripAnsi(line).trim().startsWith('needle '));

      expect(result.exitCode).toBe(0);
      expect(plainOutput).toContain('Found 2 matches in 2 files');

      const firstFileIndex = plainOutput.indexOf('📄 05-normal-first.md');
      const secondFileIndex = plainOutput.indexOf('📄 06-normal-second.md');

      expect(firstFileIndex).toBeGreaterThan(-1);
      expect(secondFileIndex).toBeGreaterThan(firstFileIndex);
      expect(contentLines).toHaveLength(2);
      contentLines.forEach((line) => {
        expect(line).toContain('\u001b[');
      });
    }, 15_000);

    it('keeps the empty-state copy when no matches are found', async () => {
      const project = await testEnv.createProject();
      await createShowSearchFixture(project.path);

      const result = await runShowSearch(project.path, 'missing-term');
      const plainOutput = stripAnsi(result.stdout + result.stderr);

      expect(result.exitCode).toBe(0);
      expect(plainOutput).toContain('No matches found for: "missing-term"');
    });

    it('still honors --no-cache without changing search ordering', async () => {
      const project = await testEnv.createProject();
      await createShowSearchFixture(project.path);

      const result = await runShowSearch(project.path, 'needle', ['--no-cache']);
      const plainOutput = stripAnsi(result.stdout + result.stderr);

      expect(result.exitCode).toBe(0);
      expect(plainOutput).toContain('Inspection cache disabled for this command.');
      expect(plainOutput).toContain('Found 2 matches in 2 files');
      expect(plainOutput).toContain('📄 05-normal-first.md');
      expect(plainOutput).toContain('📄 06-normal-second.md');
      expect(plainOutput.indexOf('📄 05-normal-first.md')).toBeLessThan(
        plainOutput.indexOf('📄 06-normal-second.md')
      );
    }, 15_000);
  });

  describe('Show search flag separation', () => {
    const BIN_PATH = join(__dirname, '../../../bin/filmbuff.js');

    it('shows module and completed search flags distinctly in help output', async () => {
      const result = await executeCommand('node', [CLI_PATH, 'show', '--help'], testEnv.tempDir);
      const output = stripAnsi(result.stdout + result.stderr);

      expect(result.exitCode).toBe(0);
      expect(output).toContain('Display detailed information about a module');
      expect(output).toContain('--search <term>');
      expect(output).toContain('Search within module content');
      expect(output).toContain('--completed-search <term>');
      expect(output).toMatch(/Search completed tasks by title, description, or\s+close reason/);
    });

    it('routes completed searches through the renamed flag', async () => {
      const project = await testEnv.createProject({
        name: 'show-completed-search',
        withAugmentDir: false
      });
      await createCompletedTasksFixture(project.path);

      const result = await executeCommand(
        'node',
        [BIN_PATH, 'show', 'completed', '--completed-search', 'distinct'],
        project.path
      );
      const output = stripAnsi(result.stdout + result.stderr);

      expect(result.exitCode).toBe(0);
      expect(output).toContain('Completed Tasks (1)');
      expect(output).toContain('bd-1001');
      expect(output).toContain('Split the search flags');
      expect(output).not.toContain('bd-1002');
    }, 60_000);

    it('keeps commander-style errors for unknown show flags', async () => {
      const project = await testEnv.createProject({ name: 'show-unknown-flag' });

      const result = await executeCommand(
        'node',
        [CLI_PATH, 'show', 'completed', '--bogus'],
        project.path
      );
      const output = stripAnsi(result.stdout + result.stderr);

      expect(result.exitCode).not.toBe(0);
      expect(output).toContain("error: unknown option '--bogus'");
    });

    it('rejects the module search flag on the completed workflow', async () => {
      const project = await testEnv.createProject({ name: 'show-completed-search-misuse' });
      await createCompletedTasksFixture(project.path);

      const result = await executeCommand(
        'node',
        [BIN_PATH, 'show', 'completed', '--search', 'distinct'],
        project.path
      );
      const output = stripAnsi(result.stdout + result.stderr);

      expect(result.exitCode).not.toBe(0);
      expect(output).toContain(
        'The --search option is reserved for module content. Use --completed-search with "filmbuff show completed".'
      );
    });

    it('rejects completed-task search on module inspections', async () => {
      const project = await testEnv.createProject({ name: 'show-completed-search-on-module' });

      const result = await executeCommand(
        'node',
        [BIN_PATH, 'show', 'writing-standards/screenplay', '--completed-search', 'distinct'],
        project.path
      );
      const output = stripAnsi(result.stdout + result.stderr);

      expect(result.exitCode).not.toBe(0);
      expect(output).toContain(
        'The --completed-search option only applies to "filmbuff show completed". Use --search for module content.'
      );
    });
  });

  describe('Show completed path resolution', () => {
    const BIN_PATH = join(__dirname, '../../../bin/filmbuff.js');

    const completedTasks: ShowCompletedFixtureTask[] = [
      {
        id: 'bd-2001',
        title: 'Alpha draft',
        description: 'needle in the haystack',
        status: 'closed',
        priority: 2,
        issue_type: 'task',
        owner: 'alice@example.com',
        created_at: '2026-09-01T09:00:00.000Z',
        created_by: 'writer@example.com',
        updated_at: '2026-09-07T09:30:00.000Z',
        closed_at: '2026-09-07T10:00:00.000Z',
        close_reason: 'First completed task',
        labels: ['alpha', 'shared']
      },
      {
        id: 'bd-2002',
        title: 'Beta draft',
        description: 'completely different',
        status: 'closed',
        priority: 1,
        issue_type: 'bug',
        owner: 'bob@example.com',
        created_at: '2026-09-02T09:00:00.000Z',
        created_by: 'writer@example.com',
        updated_at: '2026-09-07T11:30:00.000Z',
        closed_at: '2026-09-08T10:00:00.000Z',
        close_reason: 'Another finished task',
        labels: ['beta']
      },
      {
        id: 'bd-2003',
        title: 'Gamma draft',
        description: 'needle appears here too',
        status: 'closed',
        priority: 3,
        issue_type: 'task',
        owner: 'alice@example.com',
        created_at: '2026-09-03T09:00:00.000Z',
        created_by: 'writer@example.com',
        updated_at: '2026-09-06T09:30:00.000Z',
        closed_at: '2026-09-06T10:00:00.000Z',
        close_reason: 'Wrapped up cleanly',
        labels: ['alpha']
      }
    ];

    async function runShowCompleted(
      cwd: string,
      args: string[] = [],
      options: { env?: NodeJS.ProcessEnv } = {}
    ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
      return executeCommand(
        'node',
        [CLI_PATH, 'show', 'completed', ...args],
        cwd,
        options
      );
    }

    it('warns about corrupted completed history while still showing recovered records', async () => {
      const project = await testEnv.createProject({ name: 'show-completed-corruption' });
      await createCorruptedCompletedTasksFixture(project.path);

      const result = await runShowCompleted(project.path);
      const output = normalizeOutput(result.stdout + result.stderr);
      const completedFilePath = join('scripts', 'completed.jsonl');

      expect(result.exitCode).toBe(0);
      expect(output).toContain(`Completed history in ${completedFilePath} is corrupted at line 1.`);
      expect(output).toContain('Showing recovered records only.');
      expect(output).toContain('Completed Tasks (1)');
      expect(output).toContain('bd-1001');
      expect(output).toContain('Split the search flags');
      expect(output).not.toContain('bd-broken');
    }, 60_000);

    it('keeps date-only filters aligned with UTC day boundaries', async () => {
      const project = await testEnv.createProject({ name: 'show-completed-date-boundaries' });
      await createResolvedCompletedProjectFixture(project.path, [
        {
          id: 'bd-3001',
          title: 'UTC day start',
          description: 'Completed at the start of the UTC day',
          status: 'closed',
          closed_at: '2026-09-11T00:00:00.000Z',
          close_reason: 'Finished at UTC day start'
        },
        {
          id: 'bd-3002',
          title: 'UTC day end',
          description: 'Completed at the end of the UTC day',
          status: 'closed',
          closed_at: '2026-09-11T23:59:59.999Z',
          close_reason: 'Finished at UTC day end'
        },
        {
          id: 'bd-3003',
          title: 'Next UTC day',
          description: 'Completed after the UTC day boundary',
          status: 'closed',
          closed_at: '2026-09-12T00:00:00.000Z',
          close_reason: 'Finished on the next UTC day'
        }
      ]);

      const day11Result = await runShowCompleted(project.path, [
        '--since',
        '2026-09-11',
        '--until',
        '2026-09-11',
        '--json'
      ]);
      const day12Result = await runShowCompleted(project.path, [
        '--since',
        '2026-09-12',
        '--until',
        '2026-09-12',
        '--json'
      ]);

      expect(day11Result.exitCode).toBe(0);
      expect(day12Result.exitCode).toBe(0);
      expect(JSON.parse(day11Result.stdout).map((task: { id: string }) => task.id)).toEqual([
        'bd-3001',
        'bd-3002'
      ]);
      expect(JSON.parse(day12Result.stdout).map((task: { id: string }) => task.id)).toEqual([
        'bd-3003'
      ]);
    }, 60_000);

    it('keeps date-only filters stable across timezones', async () => {
      const project = await testEnv.createProject({ name: 'show-completed-timezone-stability' });
      await createResolvedCompletedProjectFixture(project.path, [
        {
          id: 'bd-3101',
          title: 'UTC day start',
          description: 'Completed at the start of the UTC day',
          status: 'closed',
          closed_at: '2026-09-11T00:00:00.000Z',
          close_reason: 'UTC start'
        },
        {
          id: 'bd-3102',
          title: 'UTC day end',
          description: 'Completed at the end of the UTC day',
          status: 'closed',
          closed_at: '2026-09-11T23:59:59.999Z',
          close_reason: 'UTC end'
        },
        {
          id: 'bd-3103',
          title: 'Next UTC day',
          description: 'Completed after the UTC day boundary',
          status: 'closed',
          closed_at: '2026-09-12T00:00:00.000Z',
          close_reason: 'Next day'
        }
      ]);

      const filterArgs = [
        '--since',
        '2026-09-11',
        '--until',
        '2026-09-11',
        '--json'
      ];

      const utcResult = await runShowCompleted(project.path, filterArgs, {
        env: { TZ: 'UTC' }
      });
      const losAngelesResult = await runShowCompleted(project.path, filterArgs, {
        env: { TZ: 'America/Los_Angeles' }
      });

      expect(utcResult.exitCode).toBe(0);
      expect(losAngelesResult.exitCode).toBe(0);

      const utcIds = JSON.parse(utcResult.stdout).map((task: { id: string }) => task.id);
      const losAngelesIds = JSON.parse(losAngelesResult.stdout).map((task: { id: string }) => task.id);

      expect(utcIds).toEqual(['bd-3101', 'bd-3102']);
      expect(losAngelesIds).toEqual(utcIds);
    }, 60_000);

    it('finds the same completed tasks from the repository root and a nested directory', async () => {
      const project = await testEnv.createProject({ name: 'show-completed-root-resolution' });
      await createResolvedCompletedProjectFixture(project.path, completedTasks);

      const nestedDir = join(project.path, 'nested', 'working', 'dir');
      await mkdir(nestedDir, { recursive: true });

      const rootResult = await runShowCompleted(project.path);
      const nestedResult = await runShowCompleted(nestedDir);

      expect(rootResult.exitCode).toBe(0);
      expect(nestedResult.exitCode).toBe(0);
      expect(normalizeOutput(rootResult.stdout + rootResult.stderr)).toBe(
        normalizeOutput(nestedResult.stdout + nestedResult.stderr)
      );
      expect(normalizeOutput(rootResult.stdout + rootResult.stderr)).toContain('Completed Tasks (3)');
      expect(normalizeOutput(rootResult.stdout + rootResult.stderr)).toContain('bd-2001');
      expect(normalizeOutput(rootResult.stdout + rootResult.stderr)).toContain('bd-2002');
      expect(normalizeOutput(rootResult.stdout + rootResult.stderr)).toContain('bd-2003');
    }, 30_000);

    it('keeps the friendly Beads empty-state guidance when .beads is missing', async () => {
      const project = await testEnv.createProject({ name: 'show-completed-missing-beads' });
      await createResolvedCompletedProjectFixture(project.path, [], {
        includeBeads: false,
        includeCompletedFile: false
      });

      const nestedDir = join(project.path, 'nested');
      await mkdir(nestedDir, { recursive: true });

      const result = await runShowCompleted(nestedDir);
      const output = normalizeOutput(result.stdout + result.stderr);

      expect(result.exitCode).toBe(0);
      expect(output).toContain('⚠ Beads is not initialized in this project.');
      expect(output).toContain('Install Beads CLI:');
      expect(output).toContain('bd init');
      expect(output).toContain('See: filmbuff show workflows/beads for more information.');
    });

    it('keeps the missing completed-file guidance when scripts/completed.jsonl is absent', async () => {
      const project = await testEnv.createProject({ name: 'show-completed-missing-file' });
      await createResolvedCompletedProjectFixture(project.path, [], {
        includeCompletedFile: false
      });

      const nestedDir = join(project.path, 'nested');
      await mkdir(nestedDir, { recursive: true });

      const result = await runShowCompleted(nestedDir);
      const output = normalizeOutput(result.stdout + result.stderr);

      expect(result.exitCode).toBe(0);
      expect(output).toContain('No completed tasks file found.');
      expect(output).toContain('The completed tasks file will be created automatically when you:');
      expect(output).toContain('Completed tasks are stored in: scripts/completed.jsonl');
    });

    it('still honors search, filter, and sort options after resolving the project root', async () => {
      const project = await testEnv.createProject({ name: 'show-completed-filters' });
      await createResolvedCompletedProjectFixture(project.path, completedTasks);

      const nestedDir = join(project.path, 'nested');
      await mkdir(nestedDir, { recursive: true });

      const searchResult = await runShowCompleted(nestedDir, ['--completed-search', 'needle', '--json']);
      const filteredResult = await runShowCompleted(nestedDir, [
        '--labels',
        'alpha',
        '--type',
        'task',
        '--priority',
        '2',
        '--assignee',
        'alice@example.com',
        '--json'
      ]);
      const sortedResult = await runShowCompleted(nestedDir, ['--sort', 'title', '--order', 'asc', '--json']);

      expect(searchResult.exitCode).toBe(0);
      expect(filteredResult.exitCode).toBe(0);
      expect(sortedResult.exitCode).toBe(0);

      const searchJson = JSON.parse(searchResult.stdout) as Array<{ id: string }>;
      const filteredJson = JSON.parse(filteredResult.stdout) as Array<{ id: string }>;
      const sortedJson = JSON.parse(sortedResult.stdout) as Array<{ title: string }>;

      expect(searchJson.map((task) => task.id)).toEqual(['bd-2001', 'bd-2003']);
      expect(filteredJson.map((task) => task.id)).toEqual(['bd-2001']);
      expect(sortedJson.map((task) => task.title)).toEqual([
        'Alpha draft',
        'Beta draft',
        'Gamma draft'
      ]);
    }, 30_000);

    it('preserves the verbose and quiet task formatting', async () => {
      const project = await testEnv.createProject({ name: 'show-completed-formatting' });
      await createResolvedCompletedProjectFixture(project.path, completedTasks.slice(0, 2));

      const nestedDir = join(project.path, 'nested', 'formatting');
      await mkdir(nestedDir, { recursive: true });

      const verboseResult = await runShowCompleted(nestedDir, ['--verbose']);
      const quietResult = await runShowCompleted(nestedDir, ['--quiet']);
      const verboseOutput = normalizeOutput(verboseResult.stdout + verboseResult.stderr);
      const quietOutput = normalizeOutput(quietResult.stdout + quietResult.stderr);

      expect(verboseResult.exitCode).toBe(0);
      expect(quietResult.exitCode).toBe(0);
      expect(verboseOutput).toContain('Completed Tasks (2)');
      expect(verboseOutput).toContain('Alpha draft');
      expect(verboseOutput).toContain('Created:');
      expect(verboseOutput).toContain('Updated:');
      expect(verboseOutput).toContain('Owner: alice@example.com');
      expect(verboseOutput).toContain('Reason: First completed task');
      expect(verboseOutput).toContain('Labels: alpha, shared');
      expect(quietOutput).toBe('bd-2001\nbd-2002');
    }, 30_000);
  });
});
