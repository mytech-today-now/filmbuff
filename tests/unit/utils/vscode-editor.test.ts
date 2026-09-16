import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  focusVSCode,
  getVSCodeVersion,
  isVSCodeAvailable,
  openInEditor,
  openInPreview,
  openInVSCode
} from '@cli/utils/vscode-editor';

vi.mock('child_process', () => ({
  execFileSync: vi.fn()
}));

const tempDirs: string[] = [];

function makeSpecialFilePath(
  fileName = "draft scene's & notes.txt",
  tempDirPrefix = "filmbuff vscode's & editor-"
): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), tempDirPrefix));
  tempDirs.push(tempDir);

  const filePath = path.join(tempDir, fileName);
  fs.writeFileSync(filePath, 'test');
  return filePath;
}

function mockCodeCli(versionText = '1.91.0\n') {
  const execFileSyncMock = vi.mocked(child_process.execFileSync);

  execFileSyncMock.mockImplementation(((_command: string, _args?: readonly string[], options?: { encoding?: string }) => {
    if (options && typeof options === 'object' && options.encoding) {
      return versionText;
    }

    return Buffer.from('');
  }) as any);

  return execFileSyncMock;
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe('vscode-editor', () => {
  it('passes the exact requested file path as a single argv entry', async () => {
    const filePath = makeSpecialFilePath();
    const execFileSyncSpy = mockCodeCli();

    await openInVSCode(filePath, { line: 12, column: 4, reuse: false });

    expect(execFileSyncSpy).toHaveBeenCalledTimes(2);
    expect(execFileSyncSpy).toHaveBeenNthCalledWith(
      1,
      'code',
      ['--version'],
      expect.objectContaining({ stdio: 'ignore', windowsHide: true })
    );
    expect(execFileSyncSpy).toHaveBeenNthCalledWith(
      2,
      'code',
      [`${filePath}:12:4`],
      expect.objectContaining({ stdio: 'ignore', windowsHide: true })
    );
  });

  it('keeps additional shell metacharacters as literal argv data', async () => {
    const filePath = makeSpecialFilePath("draft scene's & notes (final);.txt", "filmbuff vscode's & shell-");
    const execFileSyncSpy = mockCodeCli();

    await openInVSCode(filePath, { reuse: true });

    expect(execFileSyncSpy).toHaveBeenCalledTimes(2);
    expect(execFileSyncSpy).toHaveBeenNthCalledWith(
      1,
      'code',
      ['--version'],
      expect.objectContaining({ stdio: 'ignore', windowsHide: true })
    );
    expect(execFileSyncSpy).toHaveBeenNthCalledWith(
      2,
      'code',
      ['-r', filePath],
      expect.objectContaining({ stdio: 'ignore', windowsHide: true })
    );
  });

  it('keeps preview mode and reuse-window behavior intact', async () => {
    const filePath = makeSpecialFilePath();
    const execFileSyncSpy = mockCodeCli();

    await openInPreview(filePath);

    expect(execFileSyncSpy).toHaveBeenCalledTimes(2);
    expect(execFileSyncSpy).toHaveBeenNthCalledWith(
      1,
      'code',
      ['--version'],
      expect.objectContaining({ stdio: 'ignore', windowsHide: true })
    );
    expect(execFileSyncSpy).toHaveBeenNthCalledWith(
      2,
      'code',
      ['-r', filePath, '--preview'],
      expect.objectContaining({ stdio: 'ignore', windowsHide: true })
    );
  });

  it('opens the editor without preview when requested', async () => {
    const filePath = makeSpecialFilePath();
    const execFileSyncSpy = mockCodeCli();

    await openInEditor(filePath, { reuse: false });

    expect(execFileSyncSpy).toHaveBeenCalledTimes(2);
    expect(execFileSyncSpy).toHaveBeenNthCalledWith(
      1,
      'code',
      ['--version'],
      expect.objectContaining({ stdio: 'ignore', windowsHide: true })
    );
    expect(execFileSyncSpy).toHaveBeenNthCalledWith(
      2,
      'code',
      [filePath],
      expect.objectContaining({ stdio: 'ignore', windowsHide: true })
    );
  });

  it('focuses the existing VS Code window using argv directly', () => {
    const execFileSyncSpy = mockCodeCli();

    expect(focusVSCode()).toBe(true);

    expect(execFileSyncSpy).toHaveBeenCalledTimes(2);
    expect(execFileSyncSpy).toHaveBeenNthCalledWith(
      1,
      'code',
      ['--version'],
      expect.objectContaining({ stdio: 'ignore', windowsHide: true })
    );
    expect(execFileSyncSpy).toHaveBeenNthCalledWith(
      2,
      'code',
      ['-r'],
      expect.objectContaining({ stdio: 'ignore', windowsHide: true })
    );
  });

  it('returns the first line of the reported VS Code version', () => {
    const execFileSyncSpy = mockCodeCli('1.92.0\nbuild-abc\n');

    expect(getVSCodeVersion()).toBe('1.92.0');

    expect(execFileSyncSpy).toHaveBeenCalledTimes(2);
    expect(execFileSyncSpy).toHaveBeenNthCalledWith(
      1,
      'code',
      ['--version'],
      expect.objectContaining({ stdio: 'ignore', windowsHide: true })
    );
    expect(execFileSyncSpy).toHaveBeenNthCalledWith(
      2,
      'code',
      ['--version'],
      expect.objectContaining({ encoding: 'utf-8', windowsHide: true })
    );
  });

  it('reports availability through the process-safe code invocation', () => {
    const execFileSyncSpy = mockCodeCli();

    expect(isVSCodeAvailable()).toBe(true);

    expect(execFileSyncSpy).toHaveBeenCalledTimes(1);
    expect(execFileSyncSpy).toHaveBeenCalledWith(
      'code',
      ['--version'],
      expect.objectContaining({ stdio: 'ignore', windowsHide: true })
    );
  });
});
