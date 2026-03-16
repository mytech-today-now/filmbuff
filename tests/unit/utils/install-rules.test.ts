import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installCharacterCountRule } from '@cli/utils/install-rules';

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    access: vi.fn(),
    copyFile: vi.fn(),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    unlink: vi.fn(),
    writeFile: vi.fn()
  };
});

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn()
  };
});

vi.mock('chalk', () => ({
  default: {
    green: (str: string) => str,
    yellow: (str: string) => str,
    red: (str: string) => str,
    gray: (str: string) => str,
    blue: (str: string) => str,
    bold: {
      green: (str: string) => str,
      blue: (str: string) => str
    }
  },
  green: (str: string) => str,
  yellow: (str: string) => str,
  red: (str: string) => str,
  gray: (str: string) => str,
  blue: (str: string) => str,
  bold: {
    green: (str: string) => str,
    blue: (str: string) => str
  }
}));

describe('Install Rules', () => {
  const mockTargetDir = '/test/project';
  const mockAugmentDir = path.join(mockTargetDir, '.augment');
  const mockRulesDir = path.join(mockAugmentDir, 'rules');
  const mockRulePath = path.join(mockRulesDir, 'character-count-management.md');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsSync.existsSync).mockReturnValue(false);
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.copyFile).mockResolvedValue(undefined);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('' as never);
    vi.mocked(fs.unlink).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  });

  describe('installCharacterCountRule', () => {
    it('should create .augment/rules directory and install rule file', async () => {
      const result = await installCharacterCountRule({
        targetDir: mockTargetDir,
        verbose: false
      });

      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
      expect(result.skipped).toBe(false);
      expect(fs.mkdir).toHaveBeenCalledWith(mockAugmentDir, { recursive: true });
      expect(fs.mkdir).toHaveBeenCalledWith(mockRulesDir, { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith(
        mockRulePath,
        expect.stringContaining('Character Count Management'),
        'utf-8'
      );
    });

    it('should skip installation if rule already exists with same content', async () => {
      await installCharacterCountRule({
        targetDir: mockTargetDir,
        verbose: false
      });

      const installedContent = vi.mocked(fs.writeFile).mock.calls[0]?.[1] as string;

      vi.clearAllMocks();
      vi.mocked(fsSync.existsSync).mockReturnValue(true);
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(installedContent as never);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await installCharacterCountRule({
        targetDir: mockTargetDir,
        skipIfExists: true,
        verbose: false
      });

      expect(result.success).toBe(true);
      expect(result.created).toBe(false);
      expect(result.skipped).toBe(true);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should skip installation if rule exists with different content and skipIfExists is true', async () => {
      vi.mocked(fsSync.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue('Different content' as never);

      const result = await installCharacterCountRule({
        targetDir: mockTargetDir,
        skipIfExists: true,
        verbose: false
      });

      expect(result.success).toBe(true);
      expect(result.created).toBe(false);
      expect(result.skipped).toBe(true);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should replace rule if force option is true', async () => {
      vi.mocked(fsSync.existsSync).mockReturnValue(true);
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue('Different content' as never);
      vi.mocked(fs.copyFile).mockResolvedValue(undefined);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      const result = await installCharacterCountRule({
        targetDir: mockTargetDir,
        force: true,
        verbose: false
      });

      expect(result.success).toBe(true);
      expect(result.updated).toBe(true);
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should handle permission denied errors', async () => {
      const permError = new Error('Permission denied') as NodeJS.ErrnoException;
      permError.code = 'EACCES';
      vi.mocked(fs.mkdir).mockRejectedValue(permError);

      const result = await installCharacterCountRule({
        targetDir: mockTargetDir,
        verbose: false
      });

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('PERMISSION_DENIED');
      expect(result.error).toContain('Permission denied');
    });

    it('should handle disk full errors', async () => {
      const diskError = new Error('No space left') as NodeJS.ErrnoException;
      diskError.code = 'ENOSPC';
      vi.mocked(fs.writeFile).mockRejectedValue(diskError);

      const result = await installCharacterCountRule({
        targetDir: mockTargetDir,
        verbose: false
      });

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('DISK_FULL');
      expect(result.error).toContain('Disk full');
    });

    it('should use default target directory if not provided', async () => {
      const result = await installCharacterCountRule({
        verbose: false
      });

      expect(result.success).toBe(true);
      expect(fs.mkdir).toHaveBeenCalled();
    });
  });
});

