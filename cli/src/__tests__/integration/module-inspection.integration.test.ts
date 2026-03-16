/**
 * Integration tests for module inspection behavior.
 * These exercise the current module discovery and show-command handlers directly.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { showModuleCommand } from '../../commands/show';

const TEST_MODULE_NAME = 'test-module';
const TEST_MODULE_PATH = path.join(process.cwd(), 'augment-extensions', 'domain-rules', TEST_MODULE_NAME);

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map(arg => {
      if (typeof arg === 'string') {
        return arg;
      }

      if (arg instanceof Error) {
        return arg.stack || arg.message;
      }

      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

async function invokeShow(
  moduleName: string,
  filePath?: string,
  options: Record<string, unknown> = {}
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode: number | null = null;

  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit;

  console.log = ((...args: unknown[]) => {
    stdout.push(formatConsoleArgs(args));
  }) as typeof console.log;
  console.error = ((...args: unknown[]) => {
    stderr.push(formatConsoleArgs(args));
  }) as typeof console.error;
  process.exit = (((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`process.exit:${exitCode}`);
  }) as never) as typeof process.exit;

  try {
    await showModuleCommand(moduleName, filePath, options as any);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('process.exit:')) {
      throw error;
    }
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
  }

  return {
    stdout: stdout.join('\n'),
    stderr: stderr.join('\n'),
    exitCode
  };
}

describe('Module Inspection Integration Tests', () => {
  beforeAll(() => {
    // Create test module fixture
    if (!fs.existsSync(TEST_MODULE_PATH)) {
      fs.mkdirSync(TEST_MODULE_PATH, { recursive: true });
      fs.mkdirSync(path.join(TEST_MODULE_PATH, 'rules'));
      fs.mkdirSync(path.join(TEST_MODULE_PATH, 'examples'));
      
      // Create module.json
      fs.writeFileSync(
        path.join(TEST_MODULE_PATH, 'module.json'),
        JSON.stringify({
          name: TEST_MODULE_NAME,
          version: '1.0.0',
          displayName: 'Test Module',
          description: 'A test module for integration testing',
          type: 'domain-rules'
        }, null, 2)
      );
      
      // Create test rule file
      fs.writeFileSync(
        path.join(TEST_MODULE_PATH, 'rules', 'test-rule.md'),
        '# Test Rule\n\nThis is a test rule file.\n\n## Example\n\n```javascript\nconsole.log("test");\n```'
      );
      
      // Create test example file
      fs.writeFileSync(
        path.join(TEST_MODULE_PATH, 'examples', 'test-example.md'),
        '# Test Example\n\nThis is a test example file.'
      );
    }
  });

  afterAll(() => {
    // Clean up test fixtures
    if (fs.existsSync(TEST_MODULE_PATH)) {
      fs.rmSync(TEST_MODULE_PATH, { recursive: true, force: true });
    }
  });

  describe('Complete Workflow Tests', () => {
    it('should discover and display module overview', async () => {
      const result = await invokeShow(TEST_MODULE_NAME, undefined, { format: 'text' });

      expect(result.exitCode).toBeNull();
      expect(result.stdout).toContain('Name:        Test Module');
      expect(result.stdout).toContain('Version:     1.0.0');
      expect(result.stdout).toContain('Type:        domain-rules');
    });

    it('should report file counts in module overview output', async () => {
      const result = await invokeShow(TEST_MODULE_NAME, undefined, { format: 'text' });

      expect(result.exitCode).toBeNull();
      expect(result.stdout).toContain('Files:');
      expect(result.stdout).toContain('Total:       3');
      expect(result.stdout).toContain('Rules:       1');
      expect(result.stdout).toContain('Examples:    1');
    });

    it('should display aggregated content', async () => {
      const result = await invokeShow(TEST_MODULE_NAME, undefined, { content: true, format: 'text' });

      expect(result.exitCode).toBeNull();
      expect(result.stdout).toContain('Aggregated Content: domain-rules/test-module');
      expect(result.stdout).toContain('Test Rule');
      expect(result.stdout).toContain('Test Example');
    });

    it('should display individual file in text format', async () => {
      const result = await invokeShow(TEST_MODULE_NAME, 'rules/test-rule.md', { format: 'text' });

      expect(result.exitCode).toBeNull();
      expect(result.stdout).toContain('File: rules\\test-rule.md');
      expect(result.stdout).toContain('Test Rule');
      expect(result.stdout).toContain('Content:');
    });

    it('should output JSON overview format', async () => {
      const result = await invokeShow(TEST_MODULE_NAME, undefined, { format: 'json' });
      const json = JSON.parse(result.stdout);

      expect(json.name).toBe('domain-rules/test-module');
      expect(json.version).toBe('1.0.0');
      expect(json.displayName).toBe('Test Module');
    });

    it('should output Markdown content format', async () => {
      const result = await invokeShow(TEST_MODULE_NAME, undefined, { content: true, format: 'markdown' });

      expect(result.stdout).toContain('# domain-rules/test-module');
      expect(result.stdout).toContain('**Module Type:** domain-rules');
      expect(result.stdout).toContain('**Version:** 1.0.0');
    });

    it('should search within module content', async () => {
      const result = await invokeShow(TEST_MODULE_NAME, undefined, { content: true, search: 'test', format: 'text' });

      expect(result.exitCode).toBeNull();
      expect(result.stdout).toContain('Search Results: "test"');
      expect(result.stdout).toContain('test-rule.md');
    });

    it('should redact sensitive data with secure mode', async () => {
      // Create file with sensitive data
      const sensitiveFile = path.join(TEST_MODULE_PATH, 'rules', 'sensitive.md');
      fs.writeFileSync(sensitiveFile, 'API_KEY=abcdefghijklmnopqrstuvwxyz123456\nPASSWORD=mypassword');

      const result = await invokeShow(TEST_MODULE_NAME, 'rules/sensitive.md', { secure: true, format: 'text' });

      expect(result.stdout).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
      expect(result.stdout).not.toContain('mypassword');
      expect(result.stdout).toContain('[REDACTED_API_KEY]');
      expect(result.stdout).toContain('[REDACTED_PASSWORD]');

      // Clean up
      fs.unlinkSync(sensitiveFile);
    });
  });

  describe('Error Handling Tests', () => {
    it('should handle non-existent module gracefully', async () => {
      const result = await invokeShow('non-existent-module', undefined, { format: 'text' });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Module not found: non-existent-module');
    });

    it('should handle non-existent file gracefully', async () => {
      const result = await invokeShow(TEST_MODULE_NAME, 'non-existent-file.md');

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('File not found: non-existent-file.md');
    });
  });
});

