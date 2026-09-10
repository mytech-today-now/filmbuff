import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';

const {
  canonicalModuleName,
  aliasModuleName,
  mockModule,
  defaultVersionMetadata,
  defaultAvailableVersions,
  defaultCompatibilityResult,
  defaultChangelog,
  existsSyncMock,
  readFileSyncMock,
  discoverModulesMock,
  findModuleMock,
  versionManagerGetVersionMock,
  moduleLoaderGetAvailableVersionsMock,
  compatibilityCheckerCheckMock
} = vi.hoisted(() => {
  const canonicalModuleName = 'writing-standards/screenplay/genres/action';
  const aliasModuleName = 'action';
  const projectRoot = 'test-project-root';
  const mockModule = {
    fullName: canonicalModuleName,
    path: `${projectRoot}/filmbuff/${canonicalModuleName}`,
    metadata: {
      name: 'screenplay-genre-action',
      version: '1.0.0',
      displayName: 'Action Genre',
      description: 'Action genre guidance',
      type: 'writing-standards'
    },
    rules: ['action.md'],
    examples: []
  };

  const defaultVersionMetadata = {
    version: '1.0.0',
    deprecated: false,
    deprecationMessage: null,
    breaking: false,
    publishedAt: '2026-01-01T00:00:00.000Z',
    changelog: 'Introduced alias-aware resolution'
  };
  const defaultAvailableVersions = ['1.0.0', '1.1.0'];
  const defaultCompatibilityResult = {
    compatible: true,
    errors: [],
    warnings: [],
    details: {}
  };
  const defaultChangelog = '# Changelog\n- Introduced alias-aware resolution';

  return {
    canonicalModuleName,
    aliasModuleName,
    mockModule,
    defaultVersionMetadata,
    defaultAvailableVersions,
    defaultCompatibilityResult,
    defaultChangelog,
    existsSyncMock: vi.fn(),
    readFileSyncMock: vi.fn(),
    discoverModulesMock: vi.fn(() => [mockModule]),
    findModuleMock: vi.fn(() => mockModule),
    versionManagerGetVersionMock: vi.fn(() => defaultVersionMetadata),
    moduleLoaderGetAvailableVersionsMock: vi.fn(() => defaultAvailableVersions),
    compatibilityCheckerCheckMock: vi.fn(() => defaultCompatibilityResult)
  };
});

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');

  return {
    ...actual,
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock
  };
});

vi.mock('../../../cli/src/utils/module-system', async () => {
  const actual = await vi.importActual<typeof import('../../../cli/src/utils/module-system')>('../../../cli/src/utils/module-system');

  return {
    ...actual,
    discoverModules: discoverModulesMock,
    findModule: findModuleMock
  };
});

vi.mock('../../../cli/src/core/version-manager', () => ({
  VersionManager: class {
    getVersion = versionManagerGetVersionMock;
  }
}));

vi.mock('../../../cli/src/core/module-loader', () => ({
  ModuleLoader: class {
    getAvailableVersions = moduleLoaderGetAvailableVersionsMock;
  }
}));

vi.mock('../../../cli/src/core/compatibility-checker', () => ({
  CompatibilityChecker: class {
    checkCompatibility = compatibilityCheckerCheckMock;
  }
}));

import { versionInfoCommand } from '../../../cli/src/commands/version-info';

describe('versionInfoCommand', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let changelogPath: string;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    discoverModulesMock.mockReset().mockReturnValue([mockModule]);
    findModuleMock.mockReset().mockReturnValue(mockModule);
    versionManagerGetVersionMock.mockReset().mockReturnValue(defaultVersionMetadata);
    moduleLoaderGetAvailableVersionsMock.mockReset().mockReturnValue(defaultAvailableVersions);
    compatibilityCheckerCheckMock.mockReset().mockReturnValue(defaultCompatibilityResult);
    changelogPath = path.join(mockModule.path, 'CHANGELOG.md');
    existsSyncMock.mockReset().mockImplementation(filePath => filePath === changelogPath);
    readFileSyncMock.mockReset().mockReturnValue(defaultChangelog);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function readJsonPayload(): Record<string, unknown> {
    const jsonCall = consoleLogSpy.mock.calls.find(([arg]) => typeof arg === 'string' && arg.trim().startsWith('{'));
    expect(jsonCall).toBeDefined();
    return JSON.parse(jsonCall![0] as string) as Record<string, unknown>;
  }

  it('routes canonical full names through the shared finder and preserves JSON shape', async () => {
    await versionInfoCommand(canonicalModuleName, { json: true });

    expect(findModuleMock).toHaveBeenCalledWith(canonicalModuleName);
    expect(discoverModulesMock).not.toHaveBeenCalled();
    expect(versionManagerGetVersionMock).toHaveBeenCalledWith(mockModule.path);
    expect(moduleLoaderGetAvailableVersionsMock).toHaveBeenCalledWith(mockModule.path);
    expect(compatibilityCheckerCheckMock).toHaveBeenCalledWith(mockModule.path);
    expect(existsSyncMock).toHaveBeenCalledWith(changelogPath);
    expect(readFileSyncMock).toHaveBeenCalledWith(changelogPath, 'utf-8');

    const payload = readJsonPayload();
    expect(payload).toMatchObject({
      module: canonicalModuleName,
      version: defaultVersionMetadata.version,
      metadata: {
        deprecated: defaultVersionMetadata.deprecated,
        deprecationMessage: defaultVersionMetadata.deprecationMessage,
        breaking: defaultVersionMetadata.breaking,
        publishedAt: defaultVersionMetadata.publishedAt,
        changelog: defaultVersionMetadata.changelog
      },
      availableVersions: defaultAvailableVersions,
      compatibility: defaultCompatibilityResult,
      changelog: defaultChangelog
    });
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('routes alias input through the shared finder and preserves JSON shape', async () => {
    await versionInfoCommand(aliasModuleName, { json: true });

    expect(findModuleMock).toHaveBeenCalledWith(aliasModuleName);
    expect(discoverModulesMock).not.toHaveBeenCalled();

    const payload = readJsonPayload();
    expect(payload).toMatchObject({
      module: aliasModuleName,
      version: defaultVersionMetadata.version,
      metadata: {
        deprecated: defaultVersionMetadata.deprecated,
        deprecationMessage: defaultVersionMetadata.deprecationMessage,
        breaking: defaultVersionMetadata.breaking,
        publishedAt: defaultVersionMetadata.publishedAt,
        changelog: defaultVersionMetadata.changelog
      },
      availableVersions: defaultAvailableVersions,
      compatibility: defaultCompatibilityResult,
      changelog: defaultChangelog
    });
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('reports missing modules with the existing not-found message', async () => {
    findModuleMock.mockReturnValue(null);

    await versionInfoCommand('missing-module', {});

    expect(findModuleMock).toHaveBeenCalledWith('missing-module');
    expect(discoverModulesMock).toHaveBeenCalledTimes(1);
    expect(processExitSpy).toHaveBeenCalledWith(1);

    const consoleErrors = consoleErrorSpy.mock.calls.flat().join(' ');
    expect(consoleErrors).toContain('✗ Module not found: missing-module');

    const consoleLogs = consoleLogSpy.mock.calls.flat().join(' ');
    expect(consoleLogs).toContain('Available modules:');
    expect(consoleLogs).toContain(canonicalModuleName);
  });
});
