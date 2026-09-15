import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';

type Manifest = {
  version: string;
  modules: Array<Record<string, unknown>>;
};

const {
  projectRoot,
  canonicalModuleName,
  legacyAliasName,
  canonicalModule,
  canonicalModuleJson,
  existsSyncMock,
  readFileSyncMock,
  writeFileSyncMock,
  findModuleMock,
  findProjectRootMock
} = vi.hoisted(() => {
  const projectRoot = 'test-project-root';
  const canonicalModuleName = 'writing-standards/screenplay/genres/action';
  const legacyAliasName = 'action';
  const canonicalModule = {
    fullName: canonicalModuleName,
    path: '',
    metadata: {
      name: 'screenplay-genre-action',
      version: '2.0.0',
      displayName: 'Action',
      description: 'Updated action guidance',
      type: 'writing-standards'
    },
    rules: ['action.md'],
    examples: []
  };
  const canonicalModuleJson = {
    version: '2.0.0',
    description: 'Updated action guidance',
    type: 'writing-standards'
  };

  return {
    projectRoot,
    canonicalModuleName,
    legacyAliasName,
    canonicalModule,
    canonicalModuleJson,
    existsSyncMock: vi.fn(),
    readFileSyncMock: vi.fn(),
    writeFileSyncMock: vi.fn(),
    findModuleMock: vi.fn(),
    findProjectRootMock: vi.fn()
  };
});

let currentConfig: Manifest;
const canonicalModulePath = path.join(projectRoot, 'filmbuff', canonicalModuleName);
const canonicalModuleJsonPath = path.join(canonicalModulePath, 'module.json');
const configPath = path.join(projectRoot, '.augment', 'extensions.json');

canonicalModule.path = canonicalModulePath;

vi.mock('chalk', () => {
  const passthrough = (value: string) => value;
  const bold = Object.assign(passthrough, {
    blue: passthrough,
    green: passthrough,
    red: passthrough,
    gray: passthrough,
    yellow: passthrough,
    cyan: passthrough
  });

  return {
    default: {
      blue: passthrough,
      green: passthrough,
      red: passthrough,
      gray: passthrough,
      yellow: passthrough,
      cyan: passthrough,
      bold
    },
    blue: passthrough,
    green: passthrough,
    red: passthrough,
    gray: passthrough,
    yellow: passthrough,
    cyan: passthrough,
    bold
  };
});

vi.mock('../../../cli/src/utils/module-system', async () => {
  const actual = await vi.importActual<typeof import('../../../cli/src/utils/module-system')>('../../../cli/src/utils/module-system');

  return {
    ...actual,
    findModule: findModuleMock,
    findProjectRoot: findProjectRootMock
  };
});

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');

  return {
    ...actual,
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock,
    writeFileSync: writeFileSyncMock
  };
});

import { updateCommand } from '../../../cli/src/commands/update';

describe('updateCommand linked module canonicalization', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  function setConfigEntry(entry: Record<string, unknown>): void {
    currentConfig = {
      version: '1.0.0',
      modules: [entry]
    };
  }

  beforeEach(() => {
    currentConfig = {
      version: '1.0.0',
      modules: []
    };

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    findProjectRootMock.mockReset().mockReturnValue(projectRoot);
    findModuleMock.mockReset().mockImplementation((name: string) => {
      if (name === canonicalModuleName || name === legacyAliasName) {
        return canonicalModule;
      }

      return null;
    });

    existsSyncMock.mockReset().mockImplementation((filePath: string) => {
      return filePath === configPath || filePath === canonicalModuleJsonPath;
    });

    readFileSyncMock.mockReset().mockImplementation((filePath: string) => {
      if (filePath === configPath) {
        return JSON.stringify(currentConfig);
      }

      if (filePath === canonicalModuleJsonPath) {
        return JSON.stringify(canonicalModuleJson);
      }

      throw new Error(`Unexpected read: ${filePath}`);
    });

    writeFileSyncMock.mockReset().mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('updates canonical linked modules without changing the stored name', async () => {
    setConfigEntry({
      name: canonicalModuleName,
      version: '1.0.0',
      type: 'writing-standards',
      description: 'Legacy action guidance'
    });

    await updateCommand({ module: canonicalModuleName });

    expect(processExitSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);

    const [, writtenConfigText] = writeFileSyncMock.mock.calls[0];
    const writtenConfig = JSON.parse(writtenConfigText as string) as Manifest;

    expect(writtenConfig.modules[0]).toEqual(expect.objectContaining({
      name: canonicalModuleName,
      version: '2.0.0',
      description: 'Updated action guidance',
      type: 'writing-standards'
    }));

    expect(consoleLogSpy.mock.calls.flat().join(' ')).toContain('Update complete');
    expect(consoleLogSpy.mock.calls.flat().join(' ')).toContain('Updated: 1');
  });

  it('resolves legacy alias records when targeting the canonical module name', async () => {
    setConfigEntry({
      name: legacyAliasName,
      version: '1.0.0',
      type: 'writing-standards',
      description: 'Legacy action guidance'
    });

    await updateCommand({ module: canonicalModuleName });

    expect(processExitSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);

    const [, writtenConfigText] = writeFileSyncMock.mock.calls[0];
    const writtenConfig = JSON.parse(writtenConfigText as string) as Manifest;

    expect(writtenConfig.modules[0]).toEqual(expect.objectContaining({
      name: canonicalModuleName,
      version: '2.0.0',
      description: 'Updated action guidance',
      type: 'writing-standards'
    }));

    const output = consoleLogSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Update complete');
    expect(output).toContain('Updated: 1');
  });

  it('keeps legacy alias records untouched when no local source exists', async () => {
    setConfigEntry({
      name: legacyAliasName,
      version: '1.0.0',
      type: 'writing-standards',
      description: 'Legacy action guidance'
    });

    findModuleMock.mockReset().mockReturnValue(null);
    existsSyncMock.mockReset().mockImplementation((filePath: string) => filePath === configPath);

    await updateCommand({});

    expect(processExitSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);

    const [, writtenConfigText] = writeFileSyncMock.mock.calls[0];
    const writtenConfig = JSON.parse(writtenConfigText as string) as Manifest;

    expect(writtenConfig).toEqual(currentConfig);
    expect(consoleLogSpy.mock.calls.flat().join(' ')).toContain('No local source (externally managed, skipping)');
  });
});
